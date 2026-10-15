// functions/lib/guard.js：cookie → 校验 → 回名单重查。401 / 403 的分界、删人即吊销、sv 会话版本。
import { describe, it, expect } from 'vitest';
import { resolveGuest, requireGuest, requireHost } from '../../functions/lib/guard.js';
import { signToken, SESSION_TTL_MS, INVITE_TTL_MS } from '../../functions/lib/token.js';
import { makeEnv, cookieFor, hostCookie, BASE, HOST_ID } from '../helpers/env.js';

const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: null };
const req = (cookie) => new Request(BASE + '/api/public', cookie ? { headers: { cookie } } : {});
// 直接签一枚会话令牌（可以故意不带 sv，模拟 sv 上线前签出的老令牌）
const rawCookie = async (env, payload, typ = 's') => 'bs_session=' + (await signToken(env, typ, payload, typ === 's' ? SESSION_TTL_MS : INVITE_TTL_MS));

describe('guard.js', () => {
  it('no cookie → resolveGuest null, requireGuest 401, requireHost 401', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    expect(await resolveGuest(req(), env)).toBeNull();
    const g = await requireGuest(req(), env);
    expect(g.denied.status).toBe(401);
    expect(await g.denied.json()).toEqual({ error: 'unauthorized' });
    expect((await requireHost(req(), env)).status).toBe(401);
  });

  it('a guest passes requireGuest but gets 403 from requireHost', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    const c = await cookieFor(env, ann);
    const auth = await requireGuest(req(c), env);
    expect(auth.denied).toBeUndefined();
    expect(auth.guest.id).toBe('u1');
    expect(auth.isHost).toBe(false);
    const denied = await requireHost(req(c), env);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
  });

  it('a host (email in HOST_EMAILS, even with no guests key yet) passes requireHost', async () => {
    const env = makeEnv();
    const c = await hostCookie(env);
    expect(await requireHost(req(c), env)).toBeNull();
    const auth = await resolveGuest(req(c), env);
    expect(auth.isHost).toBe(true);
    expect(auth.guest.id).toBe(HOST_ID);
  });

  it('host check is case-insensitive on both sides', async () => {
    const env = makeEnv({ HOST_EMAILS: ' Host@Example.COM ', kv: { guests: [{ id: 'h1', name: 'H', email: 'HOST@example.com' }] } });
    expect(await requireHost(req(await cookieFor(env, { id: 'h1' })), env)).toBeNull();
  });

  it('a signed-out host (expired or missing session) gets 401, not 403', async () => {
    const env = makeEnv();
    const expired = 'bs_session=' + (await signToken(env, 's', { guestId: HOST_ID }, -1));
    expect((await requireHost(req(expired), env)).status).toBe(401);
  });

  it('a deleted guest is signed out at once (re-resolved from the roster)', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    const c = await cookieFor(env, ann);
    expect(await resolveGuest(req(c), env)).not.toBeNull();
    env.BS_KV.set('guests', []);
    expect(await resolveGuest(req(c), env)).toBeNull();
    expect((await requireGuest(req(c), env)).denied.status).toBe(401);
  });

  it('sv mismatch → null (an email change revokes every older session)', async () => {
    const env = makeEnv({ kv: { guests: [{ ...ann, sv: 1 }] } });
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1', sv: 0 })), env)).toBeNull();
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1' })), env)).toBeNull();
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1', sv: 2 })), env)).toBeNull();
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1', sv: 1 })), env)).not.toBeNull();
  });

  it('a token without sv and a record without sv both count as 0 (backward compatible)', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1' })), env)).not.toBeNull();
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1', sv: 0 })), env)).not.toBeNull();
    env.BS_KV.set('guests', [{ ...ann, sv: 0 }]);
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1' })), env)).not.toBeNull();
  });

  it('an invite token in the session cookie is not a session', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    expect(await resolveGuest(req(await rawCookie(env, { guestId: 'u1' }, 'i')), env)).toBeNull();
  });

  it('a tampered cookie or a missing TOKEN_SECRET → null', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    const c = await cookieFor(env, ann);
    // 改签名中段的一个字符（末位字符的低位是 base64 填充位，改它可能根本不改变签名字节）
    const i = c.length - 10;
    const bad = c.slice(0, i) + (c[i] === 'A' ? 'B' : 'A') + c.slice(i + 1);
    expect(await resolveGuest(req(bad), env)).toBeNull();
    expect(await resolveGuest(req(c), { ...env, TOKEN_SECRET: '' })).toBeNull();
  });

  it('a former host (email no longer in HOST_EMAILS) is just a guest', async () => {
    const env = makeEnv({ HOST_EMAILS: 'new-host@example.com', kv: { guests: [{ id: HOST_ID, name: 'Old', email: 'host@example.com' }] } });
    const c = await cookieFor(env, { id: HOST_ID });
    expect((await requireHost(req(c), env)).status).toBe(403);
  });
});
