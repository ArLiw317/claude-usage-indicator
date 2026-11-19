import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Lib from './lib.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const POLL_SECONDS = 180;
const BACKOFF_MAX_SECONDS = 1800;
const decoder = new TextDecoder();

function setSource(cr, hex, alpha = 1) {
    const [r, g, b] = Lib.hexToRgb(hex);
    cr.setSourceRGBA(r, g, b, alpha);
}

function setTrack(cr, actor) {
    const fg = actor.get_theme_node().get_foreground_color();
    cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.2);
}

function roundedRect(cr, w, h) {
    const r = h / 2;
    cr.newSubPath();
    cr.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
    cr.arc(r, r, r, Math.PI / 2, 3 * Math.PI / 2);
    cr.closePath();
}

// Panel icon: outer ring = current session, inner ring = this week.
const Rings = GObject.registerClass(
class Rings extends St.DrawingArea {
    _init() {
        super._init({style_class: 'claude-usage-icon', y_align: Clutter.ActorAlign.CENTER});
        this._values = [[0, Lib.COLORS.stale], [0, Lib.COLORS.stale]];
        this.connect('repaint', () => this._draw());
    }

    setValues(values) {
        this._values = values;
        this.queue_repaint();
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const size = Math.min(w, h);
        const stroke = size * 0.16;
        const radii = [size / 2 - stroke / 2, size / 2 - stroke * 1.75];
        cr.setLineWidth(stroke);
        cr.setLineCap(1); // ROUND
        radii.forEach((r, i) => {
            const [pct, color] = this._values[i];
            setTrack(cr, this);
            cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
            cr.stroke();
            if (pct > 0) {
                setSource(cr, color);
                const start = -Math.PI / 2;
                cr.arc(w / 2, h / 2, r, start, start + 2 * Math.PI * pct / 100);
                cr.stroke();
            }
        });
        cr.$dispose();
    }
});

const Bar = GObject.registerClass(
class Bar extends St.DrawingArea {
    _init() {
        super._init({style_class: 'claude-usage-bar', x_expand: true});
        this._pct = 0;
        this._color = Lib.COLORS.stale;
        this.connect('repaint', () => this._draw());
    }

    setValue(pct, color) {
        this._pct = pct;
        this._color = color;
        this.queue_repaint();
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        setTrack(cr, this);
        roundedRect(cr, w, h);
        cr.fill();
        if (this._pct > 0) {
            setSource(cr, this._color);
            roundedRect(cr, Math.max(w * this._pct / 100, h), h);
            cr.fill();
        }
        cr.$dispose();
    }
});

const UsageRow = GObject.registerClass(
class UsageRow extends PopupMenu.PopupBaseMenuItem {
    _init(title) {
        super._init({reactive: false, can_focus: false});
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'claude-usage-row',
        });
        const head = new St.BoxLayout({x_expand: true});
        head.add_child(new St.Label({text: title, x_expand: true}));
        this._pct = new St.Label({text: '–', style_class: 'claude-usage-pct'});
        head.add_child(this._pct);
        this._bar = new Bar();
        this._reset = new St.Label({text: '', style_class: 'claude-usage-dim'});
        box.add_child(head);
        box.add_child(this._bar);
        box.add_child(this._reset);
        this.add_child(box);
    }

    update(win, stale, now) {
        if (!win) {
            this._pct.text = '–';
            this._bar.setValue(0, Lib.COLORS.stale);
            this._reset.text = '';
            return;
        }
        this._pct.text = `${Math.round(win.percent)}%`;
        this._bar.setValue(win.percent, stale ? Lib.COLORS.stale : Lib.colorFor(win.percent));
        this._reset.text = Lib.formatReset(win.resetsAt, now, _);
    }
});

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(onRefresh) {
        super._init(0.0, 'Claude usage');
        this._rings = new Rings();
        this.add_child(this._rings);
        this.accessible_name = 'Claude usage';

        this._header = new PopupMenu.PopupMenuItem(_('Claude usage'), {reactive: false, can_focus: false});
        this._header.label.add_style_class_name('claude-usage-header');
        this._session = new UsageRow(_('Current session'));
        this._week = new UsageRow(_('This week'));
        this._notice = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._notice.label.add_style_class_name('claude-usage-notice');

        this._footer = new PopupMenu.PopupBaseMenuItem();
        this._status = new St.Label({text: _('Loading…'), x_expand: true, style_class: 'claude-usage-dim'});
        this._footer.add_child(this._status);
        this._footer.add_child(new St.Label({text: `⟳ ${_('Refresh')}`}));
        this._footer.connect('activate', () => onRefresh());

        for (const item of [this._header, this._session, this._week, this._notice])
            this.menu.addMenuItem(item);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._footer);
        this._notice.visible = false;

        this._state = {usage: null, error: null, plan: null};
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._render(); // keep the countdowns fresh
        });
    }

    setState(state) {
        this._state = state;
        this._render();
    }

    _render() {
        const {usage, error, plan, fetchedAt} = this._state;
        const now = new Date();
        const stale = Boolean(error) || !usage;

        this._header.label.text = plan
            ? Lib.fmt(_('Claude %s usage'), `${plan[0].toUpperCase()}${plan.slice(1)}`)
            : _('Claude usage');
        this._session.update(usage?.session, stale, now);
        this._week.update(usage?.week, stale, now);
        this._notice.visible = Boolean(error);
        this._notice.label.text = error ?? '';
        this._status.text = fetchedAt ? Lib.fmt(_('Updated %s'), Lib.formatClock(fetchedAt)) : _('Loading…');

        const s = usage?.session.percent ?? 0;
        const w = usage?.week.percent ?? 0;
        this._rings.setValues([
            [s, stale ? Lib.COLORS.stale : Lib.colorFor(s)],
            [w, stale ? Lib.COLORS.stale : Lib.colorFor(w)],
        ]);
        this.accessible_name = usage
            ? Lib.fmt(_('Claude usage: session %s%, week %s%'), Math.round(s), Math.round(w))
            : _('Claude usage');
    }
});

export default class ClaudeUsageExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this.initTranslations();
    }

    enable() {
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 15, user_agent: 'claude-usage-gnome/0.2'});
        this._credFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']));
        this._state = {usage: null, error: null, plan: null, fetchedAt: null};
        this._failures = 0;
        this._busy = false;
        this._timer = null;

        this._indicator = new Indicator(() => this._refresh());
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        this._refresh();
    }

    disable() {
        this._cancellable.cancel();
        this._session.abort();
        if (this._timer)
            GLib.source_remove(this._timer);
        this._indicator.destroy();
        this._indicator = null;
        this._timer = null;
        this._session = null;
        this._cancellable = null;
        this._credFile = null;
    }

    async _readCredentials() {
        try {
            const [bytes] = await this._credFile.load_contents_async(this._cancellable);
            return Lib.readCredentials(decoder.decode(bytes), Date.now());
        } catch (e) {
            if (e instanceof Lib.TokenExpired || this._cancellable.is_cancelled())
                throw e;
            throw new Lib.TokenExpired('credentials not readable');
        }
    }

    async _fetch(token) {
        const msg = Soup.Message.new('GET', Lib.USAGE_URL);
        const headers = msg.get_request_headers();
        headers.append('Authorization', `Bearer ${token}`);
        headers.append('anthropic-beta', 'oauth-2025-04-20');
        headers.append('Content-Type', 'application/json');
        let bytes;
        try {
            bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable);
        } catch (e) {
            if (this._cancellable.is_cancelled())
                throw e;
            throw new Lib.FetchError('network');
        }
        const status = msg.get_status();
        if (status === 401 || status === 403)
            throw new Lib.TokenExpired(`HTTP ${status}`);
        if (status !== 200)
            throw new Lib.FetchError(`HTTP ${status}`);
        try {
            return Lib.parseUsage(JSON.parse(decoder.decode(bytes.get_data())));
        } catch (e) {
            throw e instanceof Lib.FetchError ? e : new Lib.FetchError('bad response');
        }
    }

    async _refresh() {
        if (this._busy || !this._indicator)
            return;
        this._busy = true;
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        const cancellable = this._cancellable;

        let tokenProblem = false;
        try {
            const {token, plan} = await this._readCredentials();
            const usage = await this._fetch(token);
            this._state = {usage, plan, error: null, fetchedAt: new Date()};
            this._failures = 0;
        } catch (e) {
            if (cancellable.is_cancelled())
                return; // disabled while in flight
            this._failures++;
            tokenProblem = e instanceof Lib.TokenExpired;
            const msg = tokenProblem
                ? _('Stale data · run claude to refresh the token')
                : Lib.fmt(_('Could not fetch data (%s)'), e instanceof Lib.FetchError ? e.message : 'error');
            this._state = {...this._state, error: msg};
        } finally {
            this._busy = false;
        }
        if (cancellable.is_cancelled())
            return;

        this._indicator.setState(this._state);
        // Token problems clear once Claude Code refreshes the file, so keep the
        // normal cadence; network/API errors back off.
        const delay = tokenProblem
            ? POLL_SECONDS
            : Lib.nextDelay(this._failures, POLL_SECONDS, BACKOFF_MAX_SECONDS);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timer = null;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }
}
