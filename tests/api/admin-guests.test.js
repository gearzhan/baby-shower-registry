// /api/admin/guests：改宾客（唯一性含主人地址、主人邮箱锁、sv 吊销、清 sentAt/remindedAt）、
// RSVP 提醒群发（资格、20 小时冷却、关闭时 423）、KV 写限 429 下的行为（发信 → 200 stampFailed；增删改 → 429）、删人连带清理。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onRequest } from '../../functions/api/admin/guests/[[path]].js';
import { requireGuest } from '../../functions/lib/guard.js';
import { makeEnv, cookieFor, hostCookie, catchAll, captureEmails, shrinkTimers, HOST_ID, HOST_EMAIL, BASE, HOUR } from '../helpers/env.js';

const api = catchAll(onRequest, '/api/admin/guests');
const BUSY = 'Saving too fast — try again in a moment.';
const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1000 };
const bo = { id: 'u2', name: 'Bo', email: 'bo@example.com', sentAt: null };

async function setup(kv = {}) {
  const env = makeEnv({ kv: { guests: [ann, bo], ...kv } });
  return { env, host: await hostCookie(env) };
}
const roster = (env) => env.BS_KV.json('guests');
const row = (env, id) => roster(env).find((g) => g.id === id);
const signedIn = async (env, cookie) => !(await requireGuest(new Request(BASE + '/api/public', { headers: { cookie } }), env)).denied;

describe('guard', () => {
  it('401 signed out, 403 for a guest', async () => {
    const { env } = await setup();
    expect((await api(env, 'POST', '/remind-all')).status).toBe(401);
    expect((await api(env, 'POST', '/remind-all', { cookie: await cookieFor(env, ann) })).status).toBe(403);
  });
});

describe('PATCH /api/admin/guests/:id (edit guest)', () => {
  it('409 when the new email belongs to another guest (trimmed, case-insensitive)', async () => {
    const { env, host } = await setup();
    const r = await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Ann', email: '  BO@Example.com ' } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('That email is already on the list.');
    expect(env.BS_KV.writes).toEqual([]);
  });

  it('409 when the new email is a host address, even though no host row is stored in KV', async () => {
    const { env, host } = await setup();
    expect(roster(env).some((g) => g.email === HOST_EMAIL)).toBe(false);
    const r = await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Ann', email: 'Host@example.com' } });
    expect(r.status).toBe(409);
    expect(row(env, 'u1').email).toBe('ann@example.com');
  });

  it('403 when changing a host’s email; renaming a host is fine', async () => {
    const { env, host } = await setup();
    const r = await api(env, 'PATCH', '/' + HOST_ID, { cookie: host, body: { name: 'host', email: 'new@example.com' } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('A host’s email comes from the site settings and can’t be changed here.');
    const ok = await api(env, 'PATCH', '/' + HOST_ID, { cookie: host, body: { name: 'Alex', email: HOST_EMAIL } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, emailChanged: false, guest: { id: HOST_ID, name: 'Alex', email: HOST_EMAIL } });
    expect(row(env, HOST_ID).name).toBe('Alex');
    expect(await signedIn(env, host)).toBe(true); // 改名不吊销会话
  });

  it('403 for a former host row (host-* id, email no longer in HOST_EMAILS)', async () => {
    const old = { id: 'host-oldhostexamplecom', name: 'Old', email: 'oldhost@example.com', sentAt: null };
    const { env, host } = await setup({ guests: [ann, old] });
    expect((await api(env, 'PATCH', '/' + old.id, { cookie: host, body: { name: 'Old', email: 'x@example.com' } })).status).toBe(403);
    expect((await api(env, 'PATCH', '/' + old.id, { cookie: host, body: { name: 'Renamed', email: old.email } })).status).toBe(200);
  });

  it('an email change bumps sv, clears sentAt, removes remindedAt — and signs out the old session', async () => {
    const before = { ...ann, sentAt: 111, remindedAt: 222, sv: 1 };
    const { env, host } = await setup({ guests: [before, bo], 'rsvp:u1': { attending: 'yes', at: 1 }, 'claim:g1': { guestId: 'u1', name: 'Ann', at: 1 } });
    const oldSession = await cookieFor(env, before);
    expect(await signedIn(env, oldSession)).toBe(true);

    const r = await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Ann B', email: ' Ann.B@Example.com ' } });
    expect(r.status).toBe(200);
    expect(r.body.emailChanged).toBe(true);
    const saved = row(env, 'u1');
    expect(saved).toEqual({ id: 'u1', name: 'Ann B', email: 'ann.b@example.com', sentAt: null, sv: 2 });
    expect(r.body.guest).toEqual(saved);

    expect(await signedIn(env, oldSession)).toBe(false);
    expect(await signedIn(env, await cookieFor(env, saved))).toBe(true);
    // id 不变：RSVP 和认领原样跟着她
    expect(env.BS_KV.data.has('rsvp:u1')).toBe(true);
    expect(env.BS_KV.json('claim:g1').guestId).toBe('u1');
  });

  it('a guest without sv goes to sv 1 on the first email change', async () => {
    const { env, host } = await setup();
    await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Ann', email: 'ann2@example.com' } });
    expect(row(env, 'u1').sv).toBe(1);
  });

  it('a rename keeps sv, sentAt and remindedAt', async () => {
    const before = { ...ann, sentAt: 111, remindedAt: 222, sv: 3 };
    const { env, host } = await setup({ guests: [before] });
    const r = await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Annie', email: 'ANN@example.com' } });
    expect(r.body.emailChanged).toBe(false);
    expect(row(env, 'u1')).toEqual({ ...before, name: 'Annie' });
  });

  it('nothing changed → 200 with the same shape and no KV write', async () => {
    const { env, host } = await setup();
    const r = await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Ann', email: 'Ann@Example.com' } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, guest: ann, emailChanged: false });
    expect(env.BS_KV.writes).toEqual([]);
    // 请求体是 JSON null 也一样当作"什么都没改"，不是 500
    expect((await api(env, 'PATCH', '/u1', { cookie: host, body: 'null' })).status).toBe(200);
  });

  it('404 for an unknown guest, 400 for a bad name or email', async () => {
    const { env, host } = await setup();
    const gone = await api(env, 'PATCH', '/nope', { cookie: host, body: { name: 'X', email: 'x@example.com' } });
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe('That guest is no longer on the list.');
    for (const body of [{ name: '  ', email: 'ann@example.com' }, { name: 'Ann', email: 'ann@example' }, { name: 'Ann', email: 'a b@example.com' }]) {
      expect((await api(env, 'PATCH', '/u1', { cookie: host, body })).status).toBe(400);
    }
  });
});

describe('POST /api/admin/guests/remind-all', () => {
  // 冻结 Date：20 小时冷却的边界（恰好 20 小时 vs 差 1 毫秒）才测得准
  const now = Date.parse('2026-10-14T09:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());
  const g = (id, sentAt, extra = {}) => ({ id, name: id.toUpperCase(), email: id + '@example.com', sentAt, ...extra });
  const guests = [
    { id: HOST_ID, name: 'host', email: HOST_EMAIL, sentAt: now - 48 * HOUR }, // 主人：永远不提醒
    g('a', now - 48 * HOUR), // 到期
    g('b', now - 48 * HOUR), // 已回复
    g('c', null), // 没发过邀请
    g('d', now - 48 * HOUR, { remindedAt: now - 2 * HOUR }), // 冷却中（刚提醒过）
    g('e', now - 1 * HOUR), // 冷却中（刚发的邀请）
    g('f', now - 72 * HOUR, { remindedAt: now - 21 * HOUR }), // 到期
    g('x', now - 20 * HOUR), // 恰好 20 小时：到期（>=）
    g('y', now - 20 * HOUR + 1), // 差 1 毫秒：仍在冷却
  ];

  it('reminds exactly the invited, unreplied non-hosts outside the 20 h cooldown, and stamps them', async () => {
    const mails = captureEmails();
    const { env, host } = await setup({ guests, 'rsvp:b': { attending: 'no', at: 1 } });
    const r = await api(env, 'POST', '/remind-all', { cookie: host });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, count: 3, failed: 0, skipped: 3 });
    expect(mails.map((m) => m.to[0]).sort()).toEqual(['a@example.com', 'f@example.com', 'x@example.com']);
    const saved = Object.fromEntries(roster(env).map((x) => [x.id, x]));
    for (const id of ['a', 'f', 'x']) expect(saved[id].remindedAt).toBe(now);
    expect(saved.d.remindedAt).toBe(now - 2 * HOUR);
    for (const id of [HOST_ID, 'b', 'c', 'e', 'y']) expect(saved[id].remindedAt).toBeUndefined();

    // 立刻再点一次：刚提醒过的人都在冷却里，一封都不发
    mails.length = 0;
    const again = await api(env, 'POST', '/remind-all', { cookie: host });
    expect(again.body).toEqual({ ok: true, count: 0, failed: 0, skipped: 6 });
    expect(mails).toHaveLength(0);
  });

  it('ignores the request body — the server picks the recipients', async () => {
    const mails = captureEmails();
    const { env, host } = await setup({ guests, 'rsvp:b': { attending: 'no', at: 1 } });
    await api(env, 'POST', '/remind-all', { cookie: host, body: { ids: ['b', 'c', 'e', HOST_ID] } });
    expect(mails.map((m) => m.to[0]).sort()).toEqual(['a@example.com', 'f@example.com', 'x@example.com']);
  });

  it('423 while RSVPs are closed — no email, no write', async () => {
    const mails = captureEmails();
    const { env, host } = await setup({ guests, config: { rsvpClosed: true } });
    const r = await api(env, 'POST', '/remind-all', { cookie: host });
    expect(r.status).toBe(423);
    expect(r.body.error).toBe('RSVPs are closed — reopen them before sending reminders.');
    expect(mails).toHaveLength(0);
    expect(env.BS_KV.writes).toEqual([]);
  });

  it('sends in batches of 5 and stamps after every batch', async () => {
    shrinkTimers();
    const mails = captureEmails();
    const many = Array.from({ length: 7 }, (_, i) => g('p' + i, now - 48 * HOUR));
    const { env, host } = await setup({ guests: many });
    const r = await api(env, 'POST', '/remind-all', { cookie: host });
    expect(r.body).toMatchObject({ count: 7, failed: 0 });
    expect(mails).toHaveLength(7);
    expect(env.BS_KV.writes.filter((k) => k === 'guests')).toHaveLength(2);
    expect(roster(env).filter((x) => x.remindedAt).length).toBe(7);
  });
});

describe('busy KV (429 on the guests key)', () => {
  it('send: the invite went out, so a failed stamp is 200 { stampFailed } (after one retry), never a 500', async () => {
    shrinkTimers();
    const mails = captureEmails();
    const { env, host } = await setup();
    env.BS_KV.failPut('guests');
    const r = await api(env, 'POST', '/u2/send', { cookie: host });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, stampFailed: true });
    expect(mails.map((m) => m.to)).toEqual([['bo@example.com']]);
    expect(env.BS_KV.writes.filter((k) => k === 'guests')).toHaveLength(2);
  });

  it('send: one 429 then success → stamped, no stampFailed', async () => {
    shrinkTimers();
    captureEmails();
    const { env, host } = await setup();
    env.BS_KV.failPut('guests', 1);
    const r = await api(env, 'POST', '/u2/send', { cookie: host });
    expect(r.body).toEqual({ ok: true });
    expect(row(env, 'u2').sentAt).toBeGreaterThan(0);
  });

  it('send-all: a failed stamp is reported, not thrown', async () => {
    shrinkTimers();
    const mails = captureEmails();
    const { env, host } = await setup();
    env.BS_KV.failPut('guests');
    const r = await api(env, 'POST', '/send-all', { cookie: host });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, count: 1, failed: 0, stampFailed: true });
    expect(mails.map((m) => m.to[0])).toEqual(['bo@example.com']); // 主人和已发过的 Ann 都不在内
  });

  it('add / edit / remove → 429 with retryable copy, and nothing changes', async () => {
    const { env, host } = await setup({ 'rsvp:u1': { attending: 'yes', at: 1 }, 'claim:g1': { guestId: 'u1', name: 'Ann', at: 1 } });
    env.BS_KV.failPut('guests');
    const before = env.BS_KV.data.get('guests');
    const add = await api(env, 'POST', '', { cookie: host, body: { name: 'Cy', email: 'cy@example.com' } });
    const edit = await api(env, 'PATCH', '/u1', { cookie: host, body: { name: 'Ann', email: 'ann2@example.com' } });
    const del = await api(env, 'DELETE', '/u1', { cookie: host });
    for (const r of [add, edit, del]) {
      expect(r.status).toBe(429);
      expect(r.body).toEqual({ error: BUSY });
    }
    expect(env.BS_KV.data.get('guests')).toBe(before);
    expect(env.BS_KV.data.has('rsvp:u1')).toBe(true);
    expect(env.BS_KV.data.has('claim:g1')).toBe(true);
  });

  it('a non-429 KV failure still surfaces as an error (not swallowed as busy)', async () => {
    const { env, host } = await setup();
    env.BS_KV.put = async () => {
      throw new Error('KV PUT failed: 500 Internal Server Error');
    };
    await expect(api(env, 'POST', '', { cookie: host, body: { name: 'Cy', email: 'cy@example.com' } })).rejects.toThrow(/500/);
  });
});

describe('add / remove', () => {
  it('add: 409 for an address already on the list, hosts included', async () => {
    const { env, host } = await setup();
    expect((await api(env, 'POST', '', { cookie: host, body: { name: 'X', email: 'HOST@example.com' } })).status).toBe(409);
    expect((await api(env, 'POST', '', { cookie: host, body: { name: 'X', email: 'ann@example.com' } })).status).toBe(409);
    const ok = await api(env, 'POST', '', { cookie: host, body: { name: ' Cy ', email: ' CY@example.com ' } });
    expect(ok.body.guest).toMatchObject({ name: 'Cy', email: 'cy@example.com', sentAt: null });
  });

  it('remove cascades: drops rsvp:<id> and every claim the guest holds, keeps everyone else’s', async () => {
    const { env, host } = await setup({
      'rsvp:u1': { attending: 'yes', at: 1 },
      'rsvp:u2': { attending: 'no', at: 1 },
      'claim:g1': { guestId: 'u1', name: 'Ann', at: 1 },
      'claim:g2': { guestId: 'u1', name: 'Ann', at: 2 },
      'claim:g3': { guestId: 'u2', name: 'Bo', at: 3 },
    });
    const annSession = await cookieFor(env, ann);
    const r = await api(env, 'DELETE', '/u1', { cookie: host });
    expect(r.status).toBe(200);
    expect(roster(env).map((x) => x.id)).not.toContain('u1');
    expect([...env.BS_KV.data.keys()].filter((k) => k.startsWith('rsvp:') || k.startsWith('claim:')).sort()).toEqual(['claim:g3', 'rsvp:u2']);
    expect(await signedIn(env, annSession)).toBe(false);
  });

  it('a host can’t be removed', async () => {
    const { env, host } = await setup();
    const r = await api(env, 'DELETE', '/' + HOST_ID, { cookie: host });
    expect(r.status).toBe(403);
    expect(await signedIn(env, host)).toBe(true);
  });
});
