// Pure logic shared by the extension and the tests. No gi:// imports here.
//
// The access token is only read from Claude Code's credentials file and sent to
// the usage endpoint. It is never refreshed, logged, or written anywhere.

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const WARN_AT = 70;
export const CRIT_AT = 90;
export const COLORS = {ok: '#4caf50', warn: '#ffb300', crit: '#e53935', stale: '#9e9e9e'};

const EXPIRY_MARGIN_MS = 30_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class TokenExpired extends Error {}
export class FetchError extends Error {}

export function readCredentials(text, nowMs) {
    let oauth;
    try {
        oauth = JSON.parse(text).claudeAiOauth;
    } catch {
        throw new TokenExpired('credentials not readable');
    }
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken)
        throw new TokenExpired('no access token');
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt < nowMs + EXPIRY_MARGIN_MS)
        throw new TokenExpired('access token expired');
    return {token: oauth.accessToken, plan: oauth.subscriptionType ?? null};
}

export function parseTime(value) {
    if (typeof value !== 'string' || !value)
        return null;
    // Trim microseconds to milliseconds so every JS engine accepts it.
    const ms = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
    return Number.isNaN(ms) ? null : new Date(ms);
}

function parseWindow(data, key) {
    const raw = data?.[key];
    const pct = raw?.utilization;
    if (typeof pct !== 'number' || Number.isNaN(pct))
        throw new FetchError(`missing ${key}`);
    return {percent: Math.min(100, Math.max(0, pct)), resetsAt: parseTime(raw.resets_at)};
}

export function parseUsage(data) {
    return {session: parseWindow(data, 'five_hour'), week: parseWindow(data, 'seven_day')};
}

export function colorFor(percent) {
    if (percent >= CRIT_AT)
        return COLORS.crit;
    if (percent >= WARN_AT)
        return COLORS.warn;
    return COLORS.ok;
}

export function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

const pad = n => String(n).padStart(2, '0');

export function formatClock(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Replace %s placeholders in order. Keeps translatable strings whole.
export function fmt(template, ...args) {
    let i = 0;
    return template.replace(/%s/g, () => String(args[i++] ?? ''));
}

// `_` is the gettext function; tests pass the identity to get English.
export function formatWhen(date, now, _ = s => s) {
    if (date.toDateString() === now.toDateString())
        return formatClock(date);
    return `${_(DAYS[date.getDay()])} ${formatClock(date)}`;
}

export function formatReset(resetsAt, now, _ = s => s) {
    if (!resetsAt)
        return _('reset time unknown');
    const mins = Math.floor((resetsAt - now) / 60_000);
    if (mins <= 0)
        return _('resetting now');
    const h = Math.floor(mins / 60);
    const left = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${pad(mins % 60)}m`;
    return fmt(_('resets %s · %s left'), formatWhen(resetsAt, now, _), left);
}

// Last good result, kept on disk so a fresh login can show it (greyed out)
// before the first successful fetch. Never contains the token.
export function serializeCache({usage, plan, fetchedAt}) {
    const win = w => ({percent: w.percent, resetsAt: w.resetsAt?.toISOString() ?? null});
    return JSON.stringify({
        version: 1,
        plan: plan ?? null,
        fetchedAt: fetchedAt.toISOString(),
        session: win(usage.session),
        week: win(usage.week),
    });
}

export function parseCache(text) {
    try {
        const d = JSON.parse(text);
        const win = w => {
            if (typeof w?.percent !== 'number')
                throw new Error('bad window');
            return {percent: Math.min(100, Math.max(0, w.percent)), resetsAt: parseTime(w.resetsAt)};
        };
        const fetchedAt = parseTime(d.fetchedAt);
        if (d.version !== 1 || !fetchedAt)
            return null;
        return {
            usage: {session: win(d.session), week: win(d.week)},
            plan: typeof d.plan === 'string' ? d.plan : null,
            fetchedAt,
        };
    } catch {
        return null;
    }
}

export function nextDelay(failures, pollSeconds, maxSeconds) {
    return failures <= 0 ? pollSeconds : Math.min(pollSeconds * 2 ** failures, maxSeconds);
}
