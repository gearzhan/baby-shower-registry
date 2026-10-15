// POST /api/rsvp/submit：身份来自 cookie、人数夹紧、RSVP 关闭时 423（主人也不豁免）。
import { describe, it, expect } from 'vitest';
import { onRequestPost } from '../../functions/api/rsvp/submit.js';
import { makeEnv, cookieFor, hostCookie, call, captureEmails, HOST_EMAIL } from '../helpers/env.js';

const ann = { id: 'u1', name: 'Ann', email: 'ann@example.com', sentAt: 1 };
const submit = (env, body, cookie) => call(onRequestPost, env, { method: 'POST', path: '/api/rsvp/submit', body, cookie });

describe('POST /api/rsvp/submit', () => {
  it('401 when signed out', async () => {
    expect((await submit(makeEnv({ kv: { guests: [ann] } }), { attending: 'yes' })).status).toBe(401);
  });

  it('stores the clamped record under rsvp:<guestId>, returns it and notifies the hosts', async () => {
    const mails = captureEmails();
    const env = makeEnv({ kv: { guests: [ann] } });
    const r = await submit(env, { attending: 'yes', adults: 99, kids: -3, dietary: 'veg', allergies: 'x'.repeat(400), guestId: 'someone-else' }, await cookieFor(env, ann));
    expect(r.status).toBe(200);
    expect(r.body.rsvp).toMatchObject({ attending: 'yes', adults: 12, kids: 0, dietary: 'veg' });
    expect(r.body.rsvp.allergies).toHaveLength(300);
    expect(env.BS_KV.json('rsvp:u1')).toEqual(r.body.rsvp);
    expect(env.BS_KV.data.has('rsvp:someone-else')).toBe(false);
    expect(mails.map((m) => m.to)).toEqual([[HOST_EMAIL]]);
  });

  it('declining zeroes the headcount', async () => {
    const env = makeEnv({ kv: { guests: [ann] } });
    const r = await submit(env, { attending: 'no', adults: 3, kids: 2 }, await cookieFor(env, ann));
    expect(r.body.rsvp).toMatchObject({ attending: 'no', adults: 0, kids: 0 });
  });

  it('423 when RSVPs are closed — nothing written, no email, hosts included', async () => {
    const mails = captureEmails();
    const env = makeEnv({ kv: { guests: [ann], config: { rsvpClosed: true } } });
    for (const cookie of [await cookieFor(env, ann), await hostCookie(env)]) {
      const r = await submit(env, { attending: 'yes', adults: 2 }, cookie);
      expect(r.status).toBe(423);
      expect(r.body.error).toBe('RSVPs are now closed — please contact the hosts if your plans have changed.');
    }
    expect([...env.BS_KV.data.keys()].filter((k) => k.startsWith('rsvp:'))).toEqual([]);
    expect(mails).toHaveLength(0);
  });
});
