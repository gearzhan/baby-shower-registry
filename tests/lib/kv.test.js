// functions/lib/kv.js：种子回退、getEvent 逐字段合并、getGuests 强制并入主人、getRegistryItems 的认领合并。
import { describe, it, expect } from 'vitest';
import { getGuests, getEvent, getItems, getConfig, readJSON, getRegistryItems, getClaims } from '../../functions/lib/kv.js';
import { SEED_EVENT, SEED_ITEMS, SEED_CONFIG } from '../../functions/lib/seed-data.js';
import { emailHash } from '../../functions/lib/token.js';
import { makeEnv, HOST_ID } from '../helpers/env.js';

describe('seed fallback', () => {
  it('absent keys read as the seed, as a deep clone the caller may mutate', async () => {
    const env = makeEnv();
    const items = await getItems(env);
    expect(items).toEqual(SEED_ITEMS);
    items[0].name = 'mutated';
    items.push({ id: 'x' });
    expect((await getItems(env))[0].name).toBe(SEED_ITEMS[0].name);
    expect(SEED_ITEMS[0].name).not.toBe('mutated');
    expect(await getConfig(env)).toEqual(SEED_CONFIG);
  });

  it('corrupt JSON falls back too', async () => {
    const env = makeEnv({ kv: { items: '{not json' } });
    expect(await getItems(env)).toEqual(SEED_ITEMS);
    expect(await readJSON(env, 'nope', null)).toBeNull();
  });

  it('a stored key wins over the seed', async () => {
    const env = makeEnv({ kv: { items: [] } });
    expect(await getItems(env)).toEqual([]);
  });
});

describe('getEvent', () => {
  it('merges SEED_EVENT field by field, so new fields need no KV migration', async () => {
    const env = makeEnv({ kv: { event: { hosts: 'Pat & Lee', baby: 'Baby Pip' } } });
    const e = await getEvent(env);
    expect(e.hosts).toBe('Pat & Lee');
    expect(e.baby).toBe('Baby Pip');
    expect(e.registryWelcome).toBe(SEED_EVENT.registryWelcome);
    expect(e.startsAt).toBe('');
    expect(e.tz).toBe('');
    expect(Object.keys(e).sort()).toEqual(Object.keys(SEED_EVENT).sort());
  });

  it('no event key → exactly the seed; stored empty strings are kept, not re-seeded', async () => {
    expect(await getEvent(makeEnv())).toEqual(SEED_EVENT);
    expect((await getEvent(makeEnv({ kv: { event: { welcome: '' } } }))).welcome).toBe('');
  });

  it('the seed stays generic and has no demo calendar date', () => {
    expect(SEED_EVENT.startsAt).toBe('');
    expect(SEED_EVENT.endsAt).toBe('');
    expect(SEED_EVENT.tz).toBe('');
    expect(SEED_EVENT.hosts).toBe('Alex & Sam');
  });
});

describe('getGuests', () => {
  it('a fresh KV has exactly the host rows, derived from HOST_EMAILS', async () => {
    const env = makeEnv();
    expect(await getGuests(env)).toEqual([{ id: HOST_ID, name: 'host', email: 'host@example.com', sentAt: null }]);
  });

  it('force-merges HOST_EMAILS even when the guests key exists, hosts first, without writing KV', async () => {
    const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
    const env = makeEnv({ kv: { guests: [ann] } });
    const list = await getGuests(env);
    expect(list.map((g) => g.id)).toEqual([HOST_ID, 'u1']);
    expect(list[1]).toEqual(ann);
    expect(env.BS_KV.writes).toEqual([]);
    expect(env.BS_KV.json('guests')).toEqual([ann]);
  });

  it('a persisted host row is kept as is (renamed host, mixed-case email) and not duplicated', async () => {
    const row = { id: HOST_ID, name: 'Alex', email: 'Host@Example.com', sentAt: null };
    const env = makeEnv({ kv: { guests: [row] } });
    expect(await getGuests(env)).toEqual([row]);
  });

  it('duplicate HOST_EMAILS entries (any case, any spacing) yield one row', async () => {
    const env = makeEnv({ HOST_EMAILS: 'host@example.com, HOST@example.com ,host@example.com,,' });
    const list = await getGuests(env);
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe('host@example.com');
  });

  it('two host addresses that derive the same id get a hash suffix, deterministically', async () => {
    // 两个地址的前 20 个字母数字相同 → 同一个 'host-…' id
    const a = 'averyveryverylongname@example.com';
    const b = 'averyveryverylongname@example.net';
    const env = makeEnv({ HOST_EMAILS: a + ',' + b });
    const list = await getGuests(env);
    const base = 'host-' + a.replace(/[^a-z0-9]/g, '').slice(0, 20);
    expect(list.map((g) => g.id)).toEqual([base, base + '-' + (await emailHash(b)).slice(0, 6)]);
    expect(new Set(list.map((g) => g.id)).size).toBe(2);
    // 再读一次（仍未持久化）id 不变
    expect((await getGuests(env)).map((g) => g.id)).toEqual(list.map((g) => g.id));
  });

  it('a generated id that collides with a stored row also gets the suffix', async () => {
    const stored = { id: 'host-alexsmithexampleorg', name: 'Alex', email: 'alexsmith@example.org', sentAt: null };
    const env = makeEnv({ HOST_EMAILS: 'alexsmith@example.org,alex.smith@example.org', kv: { guests: [stored] } });
    const list = await getGuests(env);
    expect(list).toHaveLength(2);
    const added = list.find((g) => g.email === 'alex.smith@example.org');
    expect(added.id).toBe('host-alexsmithexampleorg-' + (await emailHash('alex.smith@example.org')).slice(0, 6));
    expect(list.find((g) => g.email === 'alexsmith@example.org')).toEqual(stored);
  });

  it('no HOST_EMAILS → just the stored roster', async () => {
    const env = makeEnv({ HOST_EMAILS: '', kv: { guests: [] } });
    expect(await getGuests(env)).toEqual([]);
  });
});

describe('getRegistryItems', () => {
  const items = [
    { id: 'g1', name: 'Storage Baskets', price: '$1' },
    { id: 'g2', name: 'Drying Rack', price: '$2' },
    { id: 'g3', name: 'Night Light', price: '$3' },
    { id: 'g4', name: 'Rhyme Book', price: '$4' },
  ];
  const guests = [
    { id: 'u1', name: 'Ann Renamed', email: 'ann@example.com' },
    { id: 'u2', name: 'Bo', email: 'bo@example.com' },
  ];
  const claims = {
    'claim:g1': { guestId: 'u1', name: 'Ann (name at claim time)', at: 100, receivedAt: 200, thankedAt: 300 },
    'claim:g2': { name: 'Legacy Claimer', at: 110 }, // 老格式：没有 guestId
    'claim:g3': { guestId: 'gone', name: 'Deleted Guest', at: 120 }, // 认领者已不在名单
  };
  const env = () => makeEnv({ kv: { items, guests, ...claims } });

  it('claimer names are looked up live from the roster by guestId', async () => {
    const [g1] = await getRegistryItems(env());
    expect(g1).toMatchObject({ claimedBy: 'Ann Renamed', claimedAt: 100, claimedById: 'u1' });
  });

  it('a legacy {name, at} claim (no guestId) falls back to the stored name with an empty claimedById', async () => {
    const g2 = (await getRegistryItems(env()))[1];
    expect(g2).toMatchObject({ claimedBy: 'Legacy Claimer', claimedAt: 110, claimedById: '' });
  });

  it('a claim whose guest left the roster falls back to the stored name', async () => {
    expect((await getRegistryItems(env()))[2]).toMatchObject({ claimedBy: 'Deleted Guest', claimedById: 'gone' });
  });

  it('unclaimed items come through untouched', async () => {
    expect((await getRegistryItems(env()))[3]).toEqual(items[3]);
  });

  it('receivedAt / thankedAt only with { withThanks: true }, null when unset', async () => {
    const plain = await getRegistryItems(env());
    for (const it of plain) {
      expect(it).not.toHaveProperty('receivedAt');
      expect(it).not.toHaveProperty('thankedAt');
    }
    const host = await getRegistryItems(env(), { withThanks: true });
    expect(host[0]).toMatchObject({ receivedAt: 200, thankedAt: 300 });
    expect(host[1]).toMatchObject({ receivedAt: null, thankedAt: null });
    expect(host[3]).not.toHaveProperty('receivedAt');
  });

  it('never carries an email', async () => {
    expect(JSON.stringify(await getRegistryItems(env(), { withThanks: true }))).not.toMatch(/@example\.com/);
  });

  it('getClaims ignores unparseable claim records', async () => {
    const e = makeEnv({ kv: { 'claim:g1': '{broken', 'claim:g2': { guestId: 'u1', name: 'A', at: 1 } } });
    expect(Object.keys(await getClaims(e))).toEqual(['g2']);
  });
});
