// 会话 cookie：签发 / 清除 / 判断是否需要滑动续期。
import { signToken, SESSION_TTL_MS } from './token.js';

export const COOKIE = 'bs_session';
const MAX_AGE = Math.floor(SESSION_TTL_MS / 1000); // 604800

// 只有 https 才加 Secure —— 本地 wrangler pages dev 跑在 http://localhost:8788，
// Safari 会直接丢弃 http 上的 Secure cookie。不设 Domain：cookie 不区分端口，
// vite(:5173) 代理到 :8788 时共用 localhost 这一个 cookie 罐。
function attrs(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

// 签发会话 cookie（值里的 exp 与 Max-Age 同源于一次 Date.now()，两者不会互相超期）。
// 载荷 { guestId, sv }：sv 是会话版本 —— 主人改了这位宾客的邮箱就 +1，于是他名下所有已签出的会话一起失效
// （guard.js 的 resolveGuest 比对）。缺 sv 按 0 算，所以上线前签的老令牌照常有效。
// 参数收整个 guest 对象而不是 id：调用方没法"忘了传 sv" —— 忘了就会签出 sv=0 的令牌，改过邮箱的人登录后立刻又被踢出去。
export async function sessionCookie(request, env, guest) {
  const token = await signToken(env, 's', { guestId: guest.id, sv: guest.sv || 0 }, SESSION_TTL_MS);
  return `${COOKIE}=${token}; Max-Age=${MAX_AGE}; ${attrs(request)}`;
}

export function clearCookie(request) {
  return `${COOKIE}=; Max-Age=0; ${attrs(request)}`;
}

export function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// 滑动续期：令牌签发超过 24 小时才重新下发，避免每个请求都带一个 Set-Cookie。
// 唯一的续期点是 GET /api/me（SPA 每次挂载都会调它），别在其它处理器里补发 ——
// 尤其别挂在没有 no-store 的响应上，那会把某个人的 cookie 缓存给所有人。
export function needsRenew(payload) {
  const age = SESSION_TTL_MS - (payload.exp - Date.now());
  return age > 24 * 60 * 60 * 1000;
}
