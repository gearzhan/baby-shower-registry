// /api/admin/items 与 /api/admin/media：外链图转存（只抓已存的 imgUrl、竞态下不留孤儿对象）、删礼物连带清理、
// KV 写限 429、收货/致谢标记绑定认领的 at、上传路由（key 格式、拒 SVG、8 MB 上限）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onRequest as itemsRoute } from '../../functions/api/admin/items/[[path]].js';
import { onRequest as mediaRoute } from '../../functions/api/admin/media/[[path]].js';
import { MAX_IMAGE, MSG } from '../../functions/lib/media.js';
import { makeEnv, cookieFor, hostCookie, catchAll, call, KV_429 } from '../helpers/env.js';

const items = catchAll(itemsRoute, '/api/admin/items');
const BUSY = 'Saving too fast — try again in a moment.';
const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
const item = (o = {}) => ({ id: 'c1', name: 'Teddy', store: 'Shop', brand: 'B', cat: 'gift', desc: '', price: '$10', color: '', link: 'https://shop.example.com/p', imgUrl: 'https://cdn.example.com/teddy.jpg', imgKey: '', ...o });
const jpeg = (n = 4096) => {
  const u = new Uint8Array(n);
  u.set([0xff, 0xd8, 0xff, 0xe0]);
  return u;
};
const ok = (bytes, type = 'image/jpeg') => new Response(bytes, { status: 200, headers: { 'content-type': type } });

async function setup(list, kv = {}) {
  const env = makeEnv({ kv: { items: list, guests: [ann], ...kv } });
  return { env, host: await hostCookie(env) };
}
const kvItems = (env) => env.BS_KV.json('items');

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => {
    throw new Error('unexpected fetch');
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/admin/items/:id/rehost', () => {
  it('401 signed out, 403 for a guest — no fetch, nothing stored', async () => {
    const { env } = await setup([item()]);
    expect((await items(env, 'POST', '/c1/rehost')).status).toBe(401);
    expect((await items(env, 'POST', '/c1/rehost', { cookie: await cookieFor(env, ann) })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.BS_R2.data.size).toBe(0);
  });

  it('stores the sniffed type in R2, sets imgKey, clears imgUrl, keeps the rest; idempotent', async () => {
    const { env, host } = await setup([item(), item({ id: 'c2', name: 'Other' })], { 'claim:c1': { guestId: 'u1', name: 'Ann', at: 1 } });
    const webp = new Uint8Array(5000);
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    webp.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    fetchMock.mockImplementation(async () => ok(webp, 'application/octet-stream'));
    const r = await items(env, 'POST', '/c1/rehost', { cookie: host, body: { url: 'https://evil.example.com/x.jpg' } });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['item', 'ok']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/teddy.jpg'); // 抓的是已存的 imgUrl，不是请求里的
    expect(r.body.item.imgKey).toMatch(/^item-c1-[0-9a-f-]{12}$/);
    expect(r.body.item.imgUrl).toBe('');
    const obj = env.BS_R2.data.get(r.body.item.imgKey);
    expect(obj.httpMetadata.contentType).toBe('image/webp');
    expect(obj.bytes.byteLength).toBe(5000);
    expect(kvItems(env)[0]).toMatchObject({ imgKey: r.body.item.imgKey, imgUrl: '', price: '$10' });
    expect(kvItems(env)[1].name).toBe('Other');
    expect(env.BS_KV.data.has('claim:c1')).toBe(true);
    expect(r.text).not.toContain('RIFF');

    fetchMock.mockClear();
    const again = await items(env, 'POST', '/c1/rehost', { cookie: host });
    expect(again.body).toMatchObject({ ok: true, already: true, item: { imgKey: r.body.item.imgKey } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.BS_R2.data.size).toBe(1);
  });

  it('404 unknown item, 400 no link, 400 http or private link — without fetching', async () => {
    const { env, host } = await setup([item({ id: 'c3', imgUrl: '' }), item({ id: 'c4', imgUrl: 'http://cdn.example.com/a.jpg' }), item({ id: 'c5', imgUrl: 'https://127.0.0.1/a.jpg' })]);
    expect((await items(env, 'POST', '/nope/rehost', { cookie: host })).status).toBe(404);
    expect((await items(env, 'POST', '/c3/rehost', { cookie: host })).status).toBe(400);
    const h = await items(env, 'POST', '/c4/rehost', { cookie: host });
    expect(h.status).toBe(400);
    expect(h.body.error).toBe(MSG.badUrl);
    expect((await items(env, 'POST', '/c5/rehost', { cookie: host })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upstream failures map to 4xx copy; the item is untouched and R2 stays empty', async () => {
    const cases = [
      [() => new Response('x', { status: 404 }), 422],
      [() => ok(jpeg(), 'image/svg+xml'), 415],
      [() => ok(new TextEncoder().encode('<!doctype html>' + ' '.repeat(3000))), 415],
      [() => ok(jpeg(200)), 422],
      [() => ok(jpeg(MAX_IMAGE + 10)), 413],
      [() => new Response(null, { status: 302, headers: { location: 'http://cdn.example.com/a.jpg' } }), 422],
    ];
    for (const [fn, st] of cases) {
      const { env, host } = await setup([item()]);
      fetchMock.mockImplementation(async () => fn());
      const r = await items(env, 'POST', '/c1/rehost', { cookie: host });
      expect(r.status).toBe(st);
      expect(r.body.error.length).toBeGreaterThan(10);
      expect(env.BS_R2.data.size).toBe(0);
      expect(kvItems(env)).toEqual([item()]);
    }
  });

  it('races: item removed → 404, photo uploaded → already, link changed → 409 — our R2 object is always deleted', async () => {
    let s = await setup([item()]);
    fetchMock.mockImplementation(async () => (s.env.BS_KV.set('items', []), ok(jpeg())));
    expect((await items(s.env, 'POST', '/c1/rehost', { cookie: s.host })).status).toBe(404);
    expect(s.env.BS_R2.data.size).toBe(0);

    s = await setup([item()]);
    s.env.BS_R2.data.set('item-c1-theirs000000', { bytes: new Uint8Array(1), httpMetadata: {} });
    fetchMock.mockImplementation(async () => (s.env.BS_KV.set('items', [item({ imgKey: 'item-c1-theirs000000', imgUrl: '' })]), ok(jpeg())));
    const up = await items(s.env, 'POST', '/c1/rehost', { cookie: s.host });
    expect(up.body).toMatchObject({ ok: true, already: true, item: { imgKey: 'item-c1-theirs000000' } });
    expect([...s.env.BS_R2.data.keys()]).toEqual(['item-c1-theirs000000']);

    s = await setup([item()]);
    fetchMock.mockImplementation(async () => (s.env.BS_KV.set('items', [item({ imgUrl: 'https://cdn.example.com/new.jpg' })]), ok(jpeg())));
    expect((await items(s.env, 'POST', '/c1/rehost', { cookie: s.host })).status).toBe(409);
    expect(s.env.BS_R2.data.size).toBe(0);
    expect(kvItems(s.env)[0]).toMatchObject({ imgUrl: 'https://cdn.example.com/new.jpg', imgKey: '' });
  });

  it('edits made during the fetch are kept (re-read, not the opening snapshot)', async () => {
    const { env, host } = await setup([item()]);
    fetchMock.mockImplementation(async () => (env.BS_KV.set('items', [item({ price: '$99', name: 'Teddy XL' }), item({ id: 'c9', name: 'New' })]), ok(jpeg())));
    expect((await items(env, 'POST', '/c1/rehost', { cookie: host })).status).toBe(200);
    const saved = kvItems(env);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ price: '$99', name: 'Teddy XL', imgUrl: '' });
    expect(saved[0].imgKey).toMatch(/^item-c1-/);
  });

  it('a KV 429 on the final write → 429 (other errors 500); the R2 object is deleted either way', async () => {
    for (const [msg, st] of [[KV_429, 429], ['boom', 500]]) {
      const { env, host } = await setup([item()]);
      env.BS_KV.put = async () => {
        throw new Error(msg);
      };
      fetchMock.mockImplementation(async () => ok(jpeg()));
      const r = await items(env, 'POST', '/c1/rehost', { cookie: host });
      expect(r.status).toBe(st);
      expect(r.body.error).toBe(st === 429 ? BUSY : 'server_error');
      expect(env.BS_R2.data.size).toBe(0);
    }
  });
});

describe('items CRUD', () => {
  it('remove cascades: drops the claim and the R2 image', async () => {
    const { env, host } = await setup([item({ imgKey: 'item-c1-abc', imgUrl: '' }), item({ id: 'c2' })], { 'claim:c1': { guestId: 'u1', name: 'Ann', at: 1 }, 'claim:c2': { guestId: 'u1', name: 'Ann', at: 2 } });
    env.BS_R2.data.set('item-c1-abc', { bytes: new Uint8Array(1), httpMetadata: {} });
    expect((await items(env, 'DELETE', '/c1', { cookie: host })).status).toBe(200);
    expect(kvItems(env).map((x) => x.id)).toEqual(['c2']);
    expect(env.BS_KV.data.has('claim:c1')).toBe(false);
    expect(env.BS_KV.data.has('claim:c2')).toBe(true);
    expect(env.BS_R2.data.has('item-c1-abc')).toBe(false);
  });

  it('add / edit / remove under a KV 429 → 429 and nothing changes (claim and image kept)', async () => {
    const { env, host } = await setup([item({ imgKey: 'item-c1-abc', imgUrl: '' })], { 'claim:c1': { guestId: 'u1', name: 'Ann', at: 1 } });
    env.BS_R2.data.set('item-c1-abc', { bytes: new Uint8Array(1), httpMetadata: {} });
    env.BS_KV.failPut('items');
    for (const [m, p, body] of [['POST', '', { name: 'New' }], ['PUT', '/c1', { name: 'Renamed', imgKey: '' }], ['DELETE', '/c1']]) {
      const r = await items(env, m, p, { cookie: host, body });
      expect(r.status).toBe(429);
      expect(r.body).toEqual({ error: BUSY });
    }
    expect(kvItems(env)).toEqual([item({ imgKey: 'item-c1-abc', imgUrl: '' })]);
    expect(env.BS_KV.data.has('claim:c1')).toBe(true);
    expect(env.BS_R2.data.has('item-c1-abc')).toBe(true);
  });

  it('edit merges, so a stored legacy `was` survives (that is why /api/registry still strips it)', async () => {
    const { env, host } = await setup([item({ was: '$20' })]);
    const r = await items(env, 'PUT', '/c1', { cookie: host, body: { ...item(), name: 'Teddy 2', was: undefined } });
    expect(r.status).toBe(200);
    expect(kvItems(env)[0]).toMatchObject({ name: 'Teddy 2', was: '$20' });
  });
});

describe('PUT /api/admin/items/:id/thanks', () => {
  const claim = { guestId: 'u1', name: 'Ann', at: 100 };

  it('marks received / thanked on the claim the host is looking at (at must match)', async () => {
    const { env, host } = await setup([item()], { 'claim:c1': claim });
    const stale = await items(env, 'PUT', '/c1/thanks', { cookie: host, body: { received: true, at: 99 } });
    expect(stale.status).toBe(409);
    expect((await items(env, 'PUT', '/c1/thanks', { cookie: host, body: { received: true } })).status).toBe(409);
    const r = await items(env, 'PUT', '/c1/thanks', { cookie: host, body: { thanked: true, at: 100 } });
    expect(r.status).toBe(200);
    expect(r.body.receivedAt).toBeGreaterThan(0); // thanked 顺带补上 received
    expect(env.BS_KV.json('claim:c1')).toMatchObject({ ...claim, receivedAt: r.body.receivedAt, thankedAt: r.body.thankedAt });
    const un = await items(env, 'PUT', '/c1/thanks', { cookie: host, body: { received: false, at: 100 } });
    expect(un.body).toMatchObject({ receivedAt: null, thankedAt: null });
    expect(env.BS_KV.json('claim:c1')).toEqual(claim);
  });

  it('400 for anything but exactly one boolean key; 409 when unclaimed', async () => {
    const { env, host } = await setup([item()], { 'claim:c1': claim });
    for (const body of [{}, { received: true, thanked: true, at: 100 }, { received: 'yes', at: 100 }, { received: true, at: '100' }]) {
      expect((await items(env, 'PUT', '/c1/thanks', { cookie: host, body })).status).toBe(400);
    }
    expect((await items(env, 'PUT', '/c2/thanks', { cookie: host, body: { received: true, at: 100 } })).status).toBe(409);
  });
});

describe('POST /api/admin/media (upload)', () => {
  async function upload(env, cookie, slot, itemId, type = 'image/jpeg', size = 2048) {
    const fd = new FormData();
    fd.append('file', new File([jpeg(size)], 'a.jpg', { type }));
    fd.append('slot', slot);
    if (itemId != null) fd.append('itemId', itemId);
    return call(mediaRoute, env, { method: 'POST', path: '/api/admin/media', body: fd, cookie, params: { path: [] } });
  }

  it('item keys via itemMediaKey, bg keys random; svg 415; over 8 MB 413; guests 403', async () => {
    const { env, host } = await setup([]);
    const a = await upload(env, host, 'item', 'c1../x');
    expect(a.status).toBe(200);
    expect(a.body.key).toMatch(/^item-c1x-[0-9a-f-]{12}$/);
    expect(env.BS_R2.data.get(a.body.key).httpMetadata.contentType).toBe('image/jpeg');
    expect((await upload(env, host, 'item', null)).body.key).toMatch(/^item-x-[0-9a-f-]{12}$/);
    expect((await upload(env, host, 'bg', null)).body.key).toMatch(/^bg-[0-9a-f-]{12}$/);
    expect((await upload(env, host, 'item', 'c1', 'image/svg+xml')).status).toBe(415);
    expect((await upload(env, host, 'item', 'c1', 'IMAGE/SVG+XML; charset=utf-8')).status).toBe(415);
    expect((await upload(env, host, 'item', 'c1', 'text/html')).status).toBe(415);
    expect((await upload(env, host, 'item', 'c1', 'image/jpeg', MAX_IMAGE + 1)).status).toBe(413);
    expect((await upload(env, await cookieFor(env, ann), 'item', 'c1')).status).toBe(403);
  });
});
