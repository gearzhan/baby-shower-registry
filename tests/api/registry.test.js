// GET /api/registry：价格开关、认领者姓名开关都在服务端执行；claimedById / 收货致谢进度绝不外传；mine 标记。
import { describe, it, expect, vi } from 'vitest';
import { onRequestGet } from '../../functions/api/registry.js';
import { makeEnv, cookieFor, call } from '../helpers/env.js';

const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
const bo = { id: 'u2', name: 'Bo', email: 'bo@example.com', sentAt: 1 };
const items = [
  { id: 'g1', name: 'Storage Baskets', store: 'Baby Store', price: '$56.00', was: '$65.00' }, // was：已废弃字段，老记录里还留着
  { id: 'g2', name: 'Drying Rack', store: 'Baby Store', price: '$24.95' },
  { id: 'g3', name: 'Stacking Rings', store: 'Toy Shop', price: '$32.50', was: '$40.00' },
  { id: 'g4', name: 'Rhyme Book', store: 'Bookshop', price: '$27.50' },
];
const kv = (config) => ({
  items,
  guests: [ann, bo],
  config,
  'claim:g1': { guestId: 'u1', name: 'Ann', at: 101, receivedAt: 201, thankedAt: 301 }, // Ann 自己的
  'claim:g2': { guestId: 'u2', name: 'Bo', at: 102, receivedAt: 202 }, // 别人的
  'claim:g3': { name: 'Legacy', at: 103 }, // 老格式认领
});
async function get(config, who = ann) {
  const env = makeEnv({ kv: kv(config) });
  const r = await call(onRequestGet, env, { path: '/api/registry', cookie: await cookieFor(env, who) });
  expect(r.status).toBe(200);
  return { ...r.body, byId: Object.fromEntries(r.body.items.map((i) => [i.id, i])), raw: r.text };
}

describe('GET /api/registry', () => {
  it('401 when signed out', async () => {
    const r = await call(onRequestGet, makeEnv({ kv: kv({}) }), { path: '/api/registry' });
    expect(r.status).toBe(401);
  });

  it('showPrices false strips price and the legacy `was` from every item, claimed or not', async () => {
    const { items: out, raw } = await get({ showPrices: false, showClaimerNames: false });
    for (const it of out) {
      expect(it).not.toHaveProperty('price');
      expect(it).not.toHaveProperty('was');
    }
    expect(raw).not.toMatch(/\$\d/);
  });

  it('showPrices true (and the default when unset) keeps prices', async () => {
    expect((await get({ showPrices: true })).byId.g4.price).toBe('$27.50');
    expect((await get({})).byId.g4.price).toBe('$27.50');
  });

  it('other guests’ claims are anonymous unless showClaimerNames', async () => {
    const off = await get({ showClaimerNames: false });
    expect(off.byId.g2).toEqual({ id: 'g2', name: 'Drying Rack', store: 'Baby Store', price: '$24.95', claimed: true });
    expect(off.byId.g3).toMatchObject({ claimed: true });
    expect(off.byId.g3).not.toHaveProperty('claimedBy');
    expect(off.raw).not.toContain('"Bo"');
    expect(off.raw).not.toContain('Legacy');

    const on = await get({ showClaimerNames: true });
    expect(on.byId.g2).toMatchObject({ claimed: true, claimedBy: 'Bo', claimedAt: 102 });
    expect(on.byId.g2).not.toHaveProperty('mine');
    expect(on.byId.g3).toMatchObject({ claimed: true, claimedBy: 'Legacy', claimedAt: 103 });
  });

  it('marks your own claim `mine` and always shows your own name', async () => {
    const { byId } = await get({ showClaimerNames: false });
    expect(byId.g1).toMatchObject({ claimed: true, mine: true, claimedBy: 'Ann', claimedAt: 101 });
    expect(byId.g4).not.toHaveProperty('claimed');
    expect(byId.g4).not.toHaveProperty('mine');
    // 同一份数据，换 Bo 来看：g1 不再是 mine，g2 才是
    const asBo = await get({ showClaimerNames: false }, bo);
    expect(asBo.byId.g1).toEqual({ id: 'g1', name: 'Storage Baskets', store: 'Baby Store', price: '$56.00', was: '$65.00', claimed: true });
    expect(asBo.byId.g2.mine).toBe(true);
  });

  it('never returns claimedById, receivedAt, thankedAt or any email', async () => {
    for (const config of [{ showClaimerNames: true, showPrices: true }, { showClaimerNames: false, showPrices: false }]) {
      const { raw } = await get(config);
      for (const k of ['claimedById', 'receivedAt', 'thankedAt', '@example.com', 'u1', 'u2']) expect(raw).not.toContain(k);
    }
  });

  it('second gate: strips receivedAt / thankedAt even if the merge layer ever passed them through', async () => {
    // 让 getRegistryItems 照主人的方式（withThanks）并入进度，再看 registry.js 自己那道显式解构还挡不挡得住
    vi.resetModules();
    vi.doMock('../../functions/lib/kv.js', async (importOriginal) => {
      const real = await importOriginal();
      return { ...real, getRegistryItems: (env) => real.getRegistryItems(env, { withThanks: true }) };
    });
    try {
      const { onRequestGet: leaky } = await import('../../functions/api/registry.js');
      const env = makeEnv({ kv: kv({ showClaimerNames: true }) });
      const r = await call(leaky, env, { path: '/api/registry', cookie: await cookieFor(env, ann) });
      expect(r.status).toBe(200);
      expect(r.text).not.toMatch(/receivedAt|thankedAt|claimedById/);
    } finally {
      vi.doUnmock('../../functions/lib/kv.js');
      vi.resetModules();
    }
  });

  it('echoes the config the server enforced', async () => {
    const { config } = await get({ showPrices: false, showClaimerNames: true, rsvpClosed: false, registryClosed: true });
    expect(config).toEqual({ showPrices: false, showClaimerNames: true, rsvpClosed: false, registryClosed: true });
  });
});
