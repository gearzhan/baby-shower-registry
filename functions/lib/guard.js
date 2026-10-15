// 访问守卫：全站只有一套身份 —— 宾客会话 cookie。
// 主人 = 邮箱落在 HOST_EMAILS 里的宾客（不再有 Cloudflare Access）。
import { getGuests, json } from './kv.js';
import { hostEmails } from './resend.js';
import { verifyToken } from './token.js';
import { COOKIE, readCookie } from './session.js';

// 解析会话：cookie → 校验签名/类型/过期 → 回名单里重新查这个人。
// 每次都回名单查，是为了让"从名单删掉某人"或"改了他的邮箱"立刻吊销他的会话（无需会话存储）。
// 返回 { guest, isHost, payload }，未登录/已失效返回 null。
export async function resolveGuest(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const payload = await verifyToken(env, token, 's');
  if (!payload) return null;
  const guests = await getGuests(env);
  const guest = guests.find((g) => g.id === payload.guestId);
  if (!guest) return null;
  // 会话版本：改邮箱会让 guest.sv +1，旧地址那边（不管是谁）手里的会话随即失效。
  // 令牌或名单记录里没有 sv 的一律按 0 算 —— 上线这一刻谁都不会被登出
  if ((payload.sv || 0) !== (guest.sv || 0)) return null;
  const hosts = hostEmails(env).map((e) => e.toLowerCase());
  return { guest, isHost: hosts.includes((guest.email || '').toLowerCase()), payload };
}

// 宾客守卫：未登录返回 401。调用方：const auth = await requireGuest(...); if (auth.denied) return auth.denied;
export async function requireGuest(request, env) {
  const auth = await resolveGuest(request, env);
  if (!auth) return { denied: json({ error: 'unauthorized' }, 401) };
  return auth;
}

// 主人守卫：返回 null 放行，否则返回错误响应。
// 未登录/会话失效 → 401（让前端走 handle401 的登出重定向），登录但非主人 → 403。
// 两者不能都用 403：否则过期的主人会话会被当成"权限不足"，前端不登出、静默丢编辑。
export async function requireHost(request, env) {
  const auth = await resolveGuest(request, env);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (!auth.isHost) return json({ error: 'forbidden' }, 403);
  return null;
}
