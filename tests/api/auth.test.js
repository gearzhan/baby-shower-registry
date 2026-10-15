// 登录流程：/api/auth/start → /api/auth/verify → /api/me。devCode 只在本地 console 模式出现；
// 验证码一次性、猜错锁定、重新要码解锁；邀请令牌不构成登录；/api/me 未登录只给 teaser。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost as start } from '../../functions/api/auth/start.js';
import { onRequestPost as verify } from '../../functions/api/auth/verify.js';
import { onRequestGet as me } from '../../functions/api/me.js';
import { signToken, emailHash, INVITE_TTL_MS, SESSION_TTL_MS } from '../../functions/lib/token.js';
import { makeEnv, call, captureEmails, HOST_EMAIL, HOST_ID } from '../helpers/env.js';

const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
const post = (fn, env, body) => call(fn, env, { method: 'POST', path: '/api/auth/x', body });
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
const getMe = (env, cookie) => call(me, env, { path: '/api/me', cookie });

afterEach(() => vi.useRealTimers());

describe('sign-in', () => {
  it('host signs in for real: start → devCode → verify → cookie → /api/me says isHost', async () => {
    const mails = captureEmails();
    const env = makeEnv();
    const s = await post(start, env, { email: '  HOST@example.com ' });
    expect(s.status).toBe(200);
    expect(s.body.devCode).toMatch(/^\d{6}$/);
    expect(mails.map((m) => m.to)).toEqual([[HOST_EMAIL]]);
    const v = await post(verify, env, { email: HOST_EMAIL, code: s.body.devCode });
    expect(v.status).toBe(200);
    expect(v.body.guest).toEqual({ id: HOST_ID, name: 'host', isHost: true });
    const c = cookieOf(v);
    expect(c).toMatch(/^bs_session=/);
    expect(v.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax$/);
    const m = await getMe(env, c);
    expect(m.body.guest).toEqual({ id: HOST_ID, name: 'host', isHost: true });
  });

  it('devCode never comes back in resend mode or on a non-localhost base URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const resend = makeEnv({ EMAIL_MODE: 'resend', RESEND_API_KEY: 'k', RESEND_FROM: 'a@example.com' });
    const r1 = await post(start, resend, { email: HOST_EMAIL });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
    captureEmails();
    const prodUrl = makeEnv({ PUBLIC_BASE_URL: 'https://example.com' });
    expect((await post(start, prodUrl, { email: HOST_EMAIL })).body).toEqual({ ok: true });
    const lookalike = makeEnv({ PUBLIC_BASE_URL: 'https://localhost.example.com' });
    expect((await post(start, lookalike, { email: HOST_EMAIL })).body).toEqual({ ok: true });
  });

  it('a Resend failure is reported (502), not a silent success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const env = makeEnv({ EMAIL_MODE: 'resend' });
    expect((await post(start, env, { email: HOST_EMAIL })).status).toBe(502);
  });

  it('an unknown email is a 404 (so a typo is noticed), a malformed one a 400', async () => {
    const env = makeEnv();
    expect((await post(start, env, { email: 'nobody@example.com' })).status).toBe(404);
    expect((await post(start, env, { email: 'nope' })).status).toBe(400);
  });

  it('60 s cooldown per address', async () => {
    captureEmails();
    const env = makeEnv();
    expect((await post(start, env, { email: HOST_EMAIL })).status).toBe(200);
    expect((await post(start, env, { email: HOST_EMAIL })).status).toBe(429);
  });

  it('the code is single use, and a wrong code is a 400', async () => {
    captureEmails();
    const env = makeEnv({ kv: { guests: [ann] } });
    const { devCode } = (await post(start, env, { email: ann.email })).body;
    const wrong = devCode === '123456' ? '654321' : '123456';
    expect((await post(verify, env, { email: ann.email, code: wrong })).status).toBe(400);
    expect((await post(verify, env, { email: ann.email, code: devCode })).status).toBe(200);
    expect((await post(verify, env, { email: ann.email, code: devCode })).status).toBe(400);
  });

  it('5 wrong guesses void the code and lock the address; a fresh code request lifts the lock', async () => {
    captureEmails();
    const env = makeEnv({ kv: { guests: [ann] } });
    const h = await emailHash(ann.email);
    const { devCode } = (await post(start, env, { email: ann.email })).body;
    const wrong = devCode === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect((await post(verify, env, { email: ann.email, code: wrong })).status).toBe(400);
    expect(env.BS_KV.data.has('code:' + h)).toBe(false);
    expect((await post(verify, env, { email: ann.email, code: devCode })).status).toBe(429);
    env.BS_KV.data.delete('code:' + h + ':cd'); // 模拟 60 秒冷却已过
    const again = await post(start, env, { email: ann.email });
    expect(again.status).toBe(200);
    expect((await post(verify, env, { email: ann.email, code: again.body.devCode })).status).toBe(200);
  });

  it('an expired code is refused even if KV still holds it', async () => {
    captureEmails();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    const env = makeEnv({ kv: { guests: [ann] } });
    const { devCode } = (await post(start, env, { email: ann.email })).body;
    vi.setSystemTime(new Date('2026-10-01T00:10:01Z'));
    expect((await post(verify, env, { email: ann.email, code: devCode })).status).toBe(400);
  });

  it('a code mailed to an old address dies when the host changes the email', async () => {
    captureEmails();
    const env = makeEnv({ kv: { guests: [ann] } });
    const { devCode } = (await post(start, env, { email: ann.email })).body;
    env.BS_KV.set('guests', [{ ...ann, email: 'ann.new@example.com', sv: 1 }]);
    expect((await post(verify, env, { email: ann.email, code: devCode })).status).toBe(400);
  });

  it('an invite token names the guest (code goes to their own address) but is not a session', async () => {
    const mails = captureEmails();
    const env = makeEnv({ kv: { guests: [ann] } });
    const invite = await signToken(env, 'i', { guestId: 'u1', sv: 0 }, INVITE_TTL_MS);
    const s = await post(start, env, { inviteToken: invite });
    expect(s.status).toBe(200);
    expect(mails.map((m) => m.to)).toEqual([[ann.email]]);
    expect((await getMe(env, 'bs_session=' + invite)).body.guest).toBeNull();
    const v = await post(verify, env, { inviteToken: invite, code: s.body.devCode });
    expect(v.status).toBe(200);
    expect(v.body.guest).toEqual({ id: 'u1', name: 'Ann', isHost: false });
  });

  it('an invite issued before an email change (stale sv) is invalid; a session token is not an invite', async () => {
    const env = makeEnv({ kv: { guests: [{ ...ann, sv: 1 }] } });
    const stale = await signToken(env, 'i', { guestId: 'u1', sv: 0 }, INVITE_TTL_MS);
    expect((await post(start, env, { inviteToken: stale })).body).toEqual({ error: 'invalid_invite' });
    const session = await signToken(env, 's', { guestId: 'u1', sv: 1 }, SESSION_TTL_MS);
    expect((await post(start, env, { inviteToken: session })).body).toEqual({ error: 'invalid_invite' });
  });

  it('fails closed without TOKEN_SECRET', async () => {
    const env = makeEnv({ TOKEN_SECRET: '' });
    expect((await post(start, env, { email: HOST_EMAIL })).status).toBe(500);
    expect((await post(verify, env, { email: HOST_EMAIL, code: '123456' })).status).toBe(500);
  });
});

describe('GET /api/me', () => {
  it('signed out: 200 with only the teaser — no date, time or venue', async () => {
    const env = makeEnv({ kv: { event: { hosts: 'Alex & Sam', baby: 'Baby Bean', dateLabel: 'Sat', venueName: 'Secret Hall' } } });
    const r = await getMe(env);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ guest: null, rsvp: null, teaser: { hosts: 'Alex & Sam', baby: 'Baby Bean' } });
    expect(r.text).not.toContain('Secret Hall');
  });

  it('slides the session: a fresh token is not re-issued, a day-old one is (with the current sv)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    const env = makeEnv({ kv: { guests: [{ ...ann, sv: 2 }] } });
    const c = 'bs_session=' + (await signToken(env, 's', { guestId: 'u1', sv: 2 }, SESSION_TTL_MS));
    expect((await getMe(env, c)).headers.get('set-cookie')).toBeNull();
    vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));
    const r = await getMe(env, c);
    expect(r.body.guest.id).toBe('u1');
    expect(r.headers.get('set-cookie')).toMatch(/^bs_session=.+; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/);
  });
});
