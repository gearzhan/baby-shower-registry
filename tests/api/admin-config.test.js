// PUT /api/admin/config：主人守卫、COERCE 白名单（未知键丢弃、绝不入库）、按键合并（只改请求里带的键）。
import { describe, it, expect } from 'vitest';
import { onRequestPut } from '../../functions/api/admin/config.js';
import { makeEnv, cookieFor, hostCookie, call } from '../helpers/env.js';

const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
const put = (env, body, cookie) => call(onRequestPut, env, { method: 'PUT', path: '/api/admin/config', body, cookie });
const KEYS = ['registryClosed', 'rsvpClosed', 'showClaimerNames', 'showPrices'];

describe('PUT /api/admin/config', () => {
  it('401 signed out, 403 for a guest — nothing written', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    expect((await put(env, { showPrices: false })).status).toBe(401);
    expect((await put(env, { showPrices: false }, await cookieFor(env, ann))).status).toBe(403);
    expect(env.BS_KV.writes).toEqual([]);
  });

  it('drops unknown keys: only the four COERCE keys are ever stored', async () => {
    const env = makeEnv();
    // 字符串请求体：让 "__proto__" 作为真正的自有键送到服务端（对象字面量里写 __proto__ 只会改原型）
    const body = '{"showPrices":false,"evil":"<script>","hostEmails":"x@y.z","__proto__":{"polluted":true}}';
    const r = await put(env, body, await hostCookie(env));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.config).sort()).toEqual(KEYS);
    expect(Object.keys(env.BS_KV.json('config')).sort()).toEqual(KEYS);
    expect(env.BS_KV.data.get('config')).not.toMatch(/evil|script|hostEmails|polluted/);
  });

  it('merges per key: keys missing from the request keep their stored values', async () => {
    const env = makeEnv({ kv: { config: { showPrices: false, showClaimerNames: true, rsvpClosed: true, registryClosed: false } } });
    const r = await put(env, { registryClosed: true }, await hostCookie(env));
    expect(r.body.config).toEqual({ showPrices: false, showClaimerNames: true, rsvpClosed: true, registryClosed: true });
    expect(env.BS_KV.json('config')).toEqual(r.body.config);
  });

  it('with no stored config, missing keys take the seed defaults', async () => {
    const env = makeEnv();
    const r = await put(env, { showClaimerNames: true }, await hostCookie(env));
    expect(r.body.config).toEqual({ showPrices: true, showClaimerNames: true, rsvpClosed: false, registryClosed: false });
  });

  it('coerces dirty values: showPrices stays on unless === false, the rest stay off unless === true', async () => {
    const env = makeEnv();
    const c = await hostCookie(env);
    const r = await put(env, { showPrices: 'no', showClaimerNames: 'yes', rsvpClosed: 1, registryClosed: 'true' }, c);
    expect(r.body.config).toEqual({ showPrices: true, showClaimerNames: false, rsvpClosed: false, registryClosed: false });
  });

  it('a stray key already in KV is dropped on the next write', async () => {
    const env = makeEnv({ kv: { config: { showPrices: true, legacy: 'x' } } });
    await put(env, { rsvpClosed: true }, await hostCookie(env));
    expect(env.BS_KV.json('config')).not.toHaveProperty('legacy');
  });

  it('400 for a non-object body', async () => {
    const env = makeEnv();
    const c = await hostCookie(env);
    for (const body of ['null', '[]', '"x"', 'not json']) {
      expect((await put(env, body, c)).status).toBe(400);
    }
    expect(env.BS_KV.writes).toEqual([]);
  });
});
