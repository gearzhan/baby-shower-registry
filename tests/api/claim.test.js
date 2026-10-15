// /api/claim：认领 / 自撤。检查顺序 401 → 423（清单关闭）→ 400/404/403/409；幂等重认领只回 {guestId, name, at}。
import { describe, it, expect } from 'vitest';
import { onRequest } from '../../functions/api/claim/[[path]].js';
import { makeEnv, cookieFor, catchAll, captureEmails, HOST_EMAIL } from '../helpers/env.js';

const claimApi = catchAll(onRequest, '/api/claim');
const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
const bo = { id: 'u2', name: 'Bo', email: 'bo@example.com', sentAt: 1 };
const items = [
  { id: 'g1', name: 'Storage Baskets', price: '$1' },
  { id: 'g2', name: 'Drying Rack', price: '$2' },
];
const setup = async (extra = {}, who = ann) => {
  const env = makeEnv({ kv: { items, guests: [ann, bo], ...extra } });
  return { env, cookie: await cookieFor(env, who) };
};
const CLOSED = 'The registry is now closed — gifts can no longer be claimed or changed.';

describe('POST /api/claim', () => {
  it('401 when signed out', async () => {
    const { env } = await setup();
    expect((await claimApi(env, 'POST', '', { body: { itemId: 'g1' } })).status).toBe(401);
  });

  it('claims as the signed-in guest, stores {guestId, name, at} and notifies the hosts', async () => {
    const mails = captureEmails();
    const { env, cookie } = await setup();
    const r = await claimApi(env, 'POST', '', { cookie, body: { itemId: 'g1', name: 'Typed name is ignored' } });
    expect(r.status).toBe(200);
    expect(r.body.claim).toMatchObject({ guestId: 'u1', name: 'Ann' });
    expect(env.BS_KV.json('claim:g1')).toEqual(r.body.claim);
    expect(Object.keys(r.body.claim).sort()).toEqual(['at', 'guestId', 'name']);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([HOST_EMAIL]);
  });

  it('400 without an itemId, 404 for an unknown item', async () => {
    const { env, cookie } = await setup();
    expect((await claimApi(env, 'POST', '', { cookie, body: {} })).status).toBe(400);
    expect((await claimApi(env, 'POST', '', { cookie, body: { itemId: '  ' } })).status).toBe(400);
    expect((await claimApi(env, 'POST', '', { cookie, body: { itemId: 'nope' } })).status).toBe(404);
  });

  it('409 already_claimed for someone else’s claim, without the claimer’s name', async () => {
    const { env, cookie } = await setup({ 'claim:g1': { guestId: 'u2', name: 'Bo', at: 5 } });
    const r = await claimApi(env, 'POST', '', { cookie, body: { itemId: 'g1' } });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'already_claimed' });
    expect(env.BS_KV.json('claim:g1').guestId).toBe('u2');
  });

  it('an idempotent re-claim echoes only {guestId, name, at} — never the host’s received/thanked marks', async () => {
    const rec = { guestId: 'u1', name: 'Ann', at: 5, receivedAt: 6, thankedAt: 7 };
    const { env, cookie } = await setup({ 'claim:g1': rec });
    const mails = captureEmails();
    const r = await claimApi(env, 'POST', '', { cookie, body: { itemId: 'g1' } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, claim: { guestId: 'u1', name: 'Ann', at: 5 } });
    expect(env.BS_KV.json('claim:g1')).toEqual(rec); // 原记录不动
    expect(mails).toHaveLength(0); // 不重复通知主人
  });

  it('423 when the registry is closed — before any item or claim lookup, even for an unknown item', async () => {
    const { env, cookie } = await setup({ config: { registryClosed: true } });
    env.BS_KV.reads.length = 0;
    const r = await claimApi(env, 'POST', '', { cookie, body: { itemId: 'nope' } });
    expect(r.status).toBe(423);
    expect(r.body.error).toBe(CLOSED);
    expect(env.BS_KV.reads.filter((k) => k === 'items' || k.startsWith('claim:'))).toEqual([]);
    expect(env.BS_KV.writes).toEqual([]);
  });

  it('only registryClosed === true closes it', async () => {
    const { env, cookie } = await setup({ config: { registryClosed: 'yes' } });
    expect((await claimApi(env, 'POST', '', { cookie, body: { itemId: 'g1' } })).status).toBe(200);
  });

  it('unknown routes are 404', async () => {
    const { env, cookie } = await setup();
    expect((await claimApi(env, 'GET', '', { cookie })).status).toBe(404);
    expect((await claimApi(env, 'DELETE', '', { cookie })).status).toBe(404);
    expect((await claimApi(env, 'POST', '/g1', { cookie })).status).toBe(404);
  });
});

describe('DELETE /api/claim/:itemId', () => {
  it('undoes your own claim and notifies the hosts', async () => {
    const mails = captureEmails();
    const { env, cookie } = await setup({ 'claim:g1': { guestId: 'u1', name: 'Ann', at: 5 } });
    const r = await claimApi(env, 'DELETE', '/g1', { cookie });
    expect(r.status).toBe(200);
    expect(env.BS_KV.data.has('claim:g1')).toBe(false);
    expect(mails).toHaveLength(1);
  });

  it('404 when there is no claim', async () => {
    const { env, cookie } = await setup();
    expect((await claimApi(env, 'DELETE', '/g1', { cookie })).status).toBe(404);
  });

  it('403 not_yours for someone else’s claim — checked before the received 409, so nothing leaks', async () => {
    const { env, cookie } = await setup({ 'claim:g1': { guestId: 'u2', name: 'Bo', at: 5, receivedAt: 9 } });
    const r = await claimApi(env, 'DELETE', '/g1', { cookie });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'not_yours' });
    expect(env.BS_KV.data.has('claim:g1')).toBe(true);
  });

  it('a legacy claim without guestId is nobody’s to undo', async () => {
    const { env, cookie } = await setup({ 'claim:g1': { name: 'Ann', at: 5 } });
    expect((await claimApi(env, 'DELETE', '/g1', { cookie })).status).toBe(403);
  });

  it('409 with neutral copy once the host marked it received; the claim and marks stay', async () => {
    const rec = { guestId: 'u1', name: 'Ann', at: 5, receivedAt: 9, thankedAt: 10 };
    const { env, cookie } = await setup({ 'claim:g1': rec });
    const mails = captureEmails();
    const r = await claimApi(env, 'DELETE', '/g1', { cookie });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('This one’s locked in — please contact the hosts to change it.');
    expect(r.text).not.toMatch(/received|thanked|\b9\b/i);
    expect(env.BS_KV.json('claim:g1')).toEqual(rec);
    expect(mails).toHaveLength(0);
  });

  it('423 when the registry is closed, before the ownership check', async () => {
    const { env, cookie } = await setup({ config: { registryClosed: true }, 'claim:g1': { guestId: 'u2', name: 'Bo', at: 5 } });
    env.BS_KV.reads.length = 0;
    const r = await claimApi(env, 'DELETE', '/g1', { cookie });
    expect(r.status).toBe(423);
    expect(env.BS_KV.reads.filter((k) => k.startsWith('claim:'))).toEqual([]);
    expect(env.BS_KV.data.has('claim:g1')).toBe(true);
  });
});
