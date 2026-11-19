// Run with: TZ=Asia/Bangkok gjs -m tests/test_lib.js
import * as Lib from '../extension/claude-usage@local/lib.js';

let failed = 0, passed = 0;
function test(name, fn) {
    try { fn(); passed++; } catch (e) { failed++; print(`FAIL ${name}: ${e.message}`); }
}
function eq(a, b) {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function throws(fn, cls) {
    try { fn(); } catch (e) { if (e instanceof cls) return; throw new Error(`wrong error ${e}`); }
    throw new Error('did not throw');
}
const creds = o => JSON.stringify({claudeAiOauth: o});
const NOW = 1_800_000_000_000;

test('valid token', () => eq(Lib.readCredentials(creds({accessToken: 't', expiresAt: NOW + 3600e3, subscriptionType: 'pro'}), NOW), {token: 't', plan: 'pro'}));
test('expired token', () => throws(() => Lib.readCredentials(creds({accessToken: 't', expiresAt: NOW - 1}), NOW), Lib.TokenExpired));
test('expiring within margin', () => throws(() => Lib.readCredentials(creds({accessToken: 't', expiresAt: NOW + 10e3}), NOW), Lib.TokenExpired));
test('bad json', () => throws(() => Lib.readCredentials('{', NOW), Lib.TokenExpired));
test('no oauth', () => throws(() => Lib.readCredentials('{"x":1}', NOW), Lib.TokenExpired));
test('error message has no token', () => {
    try { Lib.readCredentials(creds({accessToken: 'SECRET', expiresAt: 1}), NOW); } catch (e) { if (e.message.includes('SECRET')) throw new Error('leak'); }
});

test('parse usage', () => {
    const u = Lib.parseUsage({
        five_hour: {utilization: 41, resets_at: '2026-11-19T11:19:59.726206+00:00'},
        seven_day: {utilization: 93.5, resets_at: '2026-11-21T13:00:00+00:00'},
    });
    eq(u.session.percent, 41);
    eq(u.week.percent, 93.5);
    eq(u.session.resetsAt.toISOString(), '2026-11-19T11:19:59.726Z');
});
test('clamp and missing reset', () => {
    const u = Lib.parseUsage({five_hour: {utilization: 130}, seven_day: {utilization: -2}});
    eq([u.session.percent, u.week.percent, u.session.resetsAt], [100, 0, null]);
});
test('missing window', () => throws(() => Lib.parseUsage({five_hour: null, seven_day: {utilization: 1}}), Lib.FetchError));

test('colors', () => eq([Lib.colorFor(10), Lib.colorFor(70), Lib.colorFor(90)], [Lib.COLORS.ok, Lib.COLORS.warn, Lib.COLORS.crit]));
test('hexToRgb', () => eq(Lib.hexToRgb('#ff0080').map(x => Math.round(x * 255)), [255, 0, 128]));

// These assume TZ=Asia/Bangkok
const now = new Date('2026-11-19T09:30:00Z'); // 16:30 BKK
test('reset same day', () => eq(Lib.formatReset(new Date('2026-11-19T11:20:00Z'), now), 'resets 18:20 · 1h 50m left'));
test('reset other day', () => eq(Lib.formatReset(new Date('2026-11-21T13:00:00Z'), now), 'resets Sat 20:00 · 2d 3h left'));
test('reset past/unknown', () => eq([Lib.formatReset(new Date(now - 60e3), now), Lib.formatReset(null, now)], ['resetting now', 'reset time unknown']));

test('reset is translated', () => {
    const th = {'resets %s · %s left': 'reset %s · อีก %s', Sat: 'ส.'};
    const _ = k => th[k] ?? k;
    eq(Lib.formatReset(new Date('2026-11-21T13:00:00Z'), now, _), 'reset ส. 20:00 · อีก 2d 3h');
});
test('fmt', () => eq(Lib.fmt('a %s b %s%', 1, 2), 'a 1 b 2%'));

test('backoff', () => eq([0, 1, 2, 5, 9].map(f => Lib.nextDelay(f, 180, 1800)), [180, 360, 720, 1800, 1800]));

print(`${passed} passed, ${failed} failed`);
if (failed) imports.system.exit(1);
