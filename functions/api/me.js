// 身份探针：前端挂载时必调。永远 200 —— "没登录"是一个正常答案，不是错误。
// 未登录时只回 teaser（主人名 + 宝宝名），落地页就靠这两个字段渲染，不需要第二个接口。
// 全站唯一的会话滑动续期点也在这里。
import { getEvent, readJSON, K, json } from '../lib/kv.js';
import { resolveGuest } from '../lib/guard.js';
import { sessionCookie, needsRenew } from '../lib/session.js';

export async function onRequestGet({ request, env }) {
  const event = await getEvent(env);
  const teaser = { hosts: event.hosts, baby: event.baby };

  const auth = await resolveGuest(request, env);
  if (!auth) return json({ guest: null, rsvp: null, teaser });

  const { guest, isHost, payload } = auth;
  const rsvp = await readJSON(env, K.rsvp(guest.id), null);
  const out = { guest: { id: guest.id, name: guest.name, isHost }, rsvp, teaser };

  // 续期：令牌签发已超 24 小时才重发 cookie（json() 已带 no-store，不会被缓存串号）。
  // guest 来自 resolveGuest，sv 已比对通过，所以续期签的永远是当前 sv —— 续期复活不了已吊销的会话
  if (needsRenew(payload)) {
    return json(out, 200, { 'set-cookie': await sessionCookie(request, env, guest) });
  }
  return json(out);
}
