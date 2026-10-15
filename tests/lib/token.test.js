// functions/lib/token.js + session.js：HMAC 令牌（typ 必填、过期、篡改、缺密钥 fail-closed）与会话 cookie。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signToken, verifyToken, emailHash, SESSION_TTL_MS, INVITE_TTL_MS } from '../../functions/lib/token.js';
import { sessionCookie, clearCookie, readCookie, needsRenew, COOKIE } from '../../functions/lib/session.js';

const env = { TOKEN_SECRET: 'test-secret' };
const enc = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 用真密钥给任意载荷签名（绕过 signToken 的 typ/exp 注入），用来构造"签名合法但载荷不合规"的令牌
async function rawSign(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return body + '.' + b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))));
}

afterEach(() => vi.useRealTimers());

describe('token.js', () => {
  it('round-trips a session token and keeps the payload', async () => {
    const t = await signToken(env, 's', { guestId: 'u1', sv: 2 }, SESSION_TTL_MS);
    const p = await verifyToken(env, t, 's');
    expect(p).toMatchObject({ guestId: 'u1', sv: 2, typ: 's' });
    expect(typeof p.exp).toBe('number');
  });

  it('typ is enforced both ways: an invite is never a session, a session is never an invite', async () => {
    const invite = await signToken(env, 'i', { guestId: 'u1' }, INVITE_TTL_MS);
    const session = await signToken(env, 's', { guestId: 'u1' }, SESSION_TTL_MS);
    expect(await verifyToken(env, invite, 's')).toBeNull();
    expect(await verifyToken(env, session, 'i')).toBeNull();
    expect(await verifyToken(env, invite, 'i')).not.toBeNull();
  });

  it('expectType is a required argument (throws rather than defaulting)', async () => {
    const t = await signToken(env, 's', { guestId: 'u1' }, SESSION_TTL_MS);
    await expect(verifyToken(env, t)).rejects.toThrow(/expectType/);
    await expect(verifyToken(env, t, '')).rejects.toThrow(/expectType/);
  });

  it('a payload cannot override typ or exp', async () => {
    const t = await signToken(env, 's', { guestId: 'u1', typ: 'i', exp: Number.MAX_SAFE_INTEGER }, 1000);
    const p = await verifyToken(env, t, 's');
    expect(p.typ).toBe('s');
    expect(p.exp).toBeLessThan(Date.now() + 2000);
  });

  it('expires: valid just before exp, null just after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    const t = await signToken(env, 's', { guestId: 'u1' }, SESSION_TTL_MS);
    vi.setSystemTime(new Date(Date.parse('2026-10-01T00:00:00Z') + SESSION_TTL_MS - 1));
    expect(await verifyToken(env, t, 's')).not.toBeNull();
    vi.setSystemTime(new Date(Date.parse('2026-10-01T00:00:00Z') + SESSION_TTL_MS + 1));
    expect(await verifyToken(env, t, 's')).toBeNull();
  });

  it('a negative TTL is already expired', async () => {
    expect(await verifyToken(env, await signToken(env, 's', { guestId: 'u1' }, -1), 's')).toBeNull();
  });

  it('rejects a tampered signature, a tampered body and a different secret', async () => {
    const t = await signToken(env, 's', { guestId: 'u1' }, SESSION_TTL_MS);
    const [body, sig] = t.split('.');
    const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    expect(await verifyToken(env, body + '.' + flip(sig, 3), 's')).toBeNull();
    const forged = b64url(enc.encode(JSON.stringify({ guestId: 'host-hostexamplecom', typ: 's', exp: Date.now() + 1e9 })));
    expect(await verifyToken(env, forged + '.' + sig, 's')).toBeNull();
    expect(await verifyToken({ TOKEN_SECRET: 'other-secret' }, t, 's')).toBeNull();
  });

  it('a correctly signed payload without a numeric exp never verifies (no immortal tokens)', async () => {
    expect(await verifyToken(env, await rawSign('test-secret', { guestId: 'u1', typ: 's' }), 's')).toBeNull();
    expect(await verifyToken(env, await rawSign('test-secret', { guestId: 'u1', typ: 's', exp: '9999999999999' }), 's')).toBeNull();
    // 同一把钥匙、合规载荷 → 通过（证明上面的 null 不是 rawSign 本身出错）
    expect(await verifyToken(env, await rawSign('test-secret', { guestId: 'u1', typ: 's', exp: Date.now() + 60000 }), 's')).not.toBeNull();
  });

  it('garbage tokens are null, never a throw', async () => {
    for (const t of ['', null, undefined, 'abc', '.', 'a.b', 'a.b.c', '!!!.###', '%%%.']) {
      expect(await verifyToken(env, t, 's')).toBeNull();
    }
  });

  it('fails closed without TOKEN_SECRET: signing throws, verifying returns null', async () => {
    const t = await signToken(env, 's', { guestId: 'u1' }, SESSION_TTL_MS);
    await expect(signToken({}, 's', { guestId: 'u1' }, SESSION_TTL_MS)).rejects.toThrow(/TOKEN_SECRET/);
    expect(await verifyToken({}, t, 's')).toBeNull();
    expect(await verifyToken({ TOKEN_SECRET: '' }, t, 's')).toBeNull();
  });

  it('emailHash is trimmed + case-folded, 20 hex chars', async () => {
    const h = await emailHash('host@example.com');
    expect(h).toMatch(/^[0-9a-f]{20}$/);
    expect(await emailHash('  HOST@Example.COM ')).toBe(h);
    expect(await emailHash('other@example.com')).not.toBe(h);
  });
});

describe('session.js', () => {
  it('cookie is HttpOnly + SameSite=Lax, 7-day Max-Age, Secure only over https', async () => {
    const guest = { id: 'u1', sv: 3 };
    const http = await sessionCookie(new Request('http://localhost:8788/api/auth/verify'), env, guest);
    const https = await sessionCookie(new Request('https://example.com/api/auth/verify'), env, guest);
    expect(http).toMatch(new RegExp('^' + COOKIE + '=[^;]+; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax$'));
    expect(https.endsWith('; Secure')).toBe(true);
    expect(http).not.toMatch(/Domain=/i);
    // 令牌里带的是 guest.sv
    const p = await verifyToken(env, http.split(';')[0].slice(COOKIE.length + 1), 's');
    expect(p).toMatchObject({ guestId: 'u1', sv: 3 });
  });

  it('a guest without sv is signed as sv 0', async () => {
    const c = await sessionCookie(new Request('http://localhost/'), env, { id: 'u1' });
    expect((await verifyToken(env, c.split(';')[0].slice(COOKIE.length + 1), 's')).sv).toBe(0);
  });

  it('clearCookie expires the cookie with the same attributes', () => {
    expect(clearCookie(new Request('https://example.com/'))).toBe(COOKIE + '=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure');
  });

  it('readCookie finds the named cookie among others', () => {
    const r = new Request('http://localhost/', { headers: { cookie: 'a=1; bs_session=tok.en; b=2' } });
    expect(readCookie(r, 'bs_session')).toBe('tok.en');
    expect(readCookie(r, 'missing')).toBe('');
    expect(readCookie(new Request('http://localhost/'), 'bs_session')).toBe('');
  });

  it('needsRenew only after the token is more than 24 h old', () => {
    const now = Date.now();
    expect(needsRenew({ exp: now + SESSION_TTL_MS })).toBe(false);
    expect(needsRenew({ exp: now + SESSION_TTL_MS - 23 * 3600e3 })).toBe(false);
    expect(needsRenew({ exp: now + SESSION_TTL_MS - 25 * 3600e3 })).toBe(true);
  });
});
