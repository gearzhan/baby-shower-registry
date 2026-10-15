// HMAC-SHA256 签名令牌，两种用途靠 typ 区分，互不通用：
//   typ 's' = 宾客会话（7 天，写在 HttpOnly cookie 里）
//   typ 'i' = 邀请链接（90 天，只指明"这封邮件发给谁"，本身不构成登录凭证）
// verifyToken 的 expectType 是必填位置参数 —— 若给默认值，某个调用点忘了传就会
// 让邀请令牌冒充会话令牌，那正是 typ 要堵的洞。
const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
export const INVITE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天（邀请提前两个月发也要还有效）

function b64url(bytes) {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// 签发令牌：typ + payload 一起签名。未配置 TOKEN_SECRET 时抛错（fail-closed），
// 绝不用可预测的常量签名。
export async function signToken(env, typ, payload, ttlMs) {
  if (!env.TOKEN_SECRET) throw new Error('TOKEN_SECRET not configured');
  const body = b64url(enc.encode(JSON.stringify({ ...payload, typ, exp: Date.now() + ttlMs })));
  const key = await hmacKey(env.TOKEN_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return body + '.' + b64url(sig);
}

// 校验令牌：未配置密钥、签名不符、类型不符、已过期一律返回 null（fail-closed）。
// exp 必须是数字 —— 否则一个没有 exp 的载荷将永不过期。
export async function verifyToken(env, token, expectType) {
  if (!expectType) throw new Error('verifyToken: expectType is required');
  if (!env.TOKEN_SECRET) return null;
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const key = await hmacKey(env.TOKEN_SECRET);
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let p;
  try { p = JSON.parse(dec.decode(b64urlToBytes(body))); } catch { return null; }
  if (p.typ !== expectType) return null;
  if (typeof p.exp !== 'number' || Date.now() > p.exp) return null;
  return p;
}

// 邮箱哈希（用作 code:<hash> 键，避免把明文邮箱作键）
export async function emailHash(email) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode((email || '').trim().toLowerCase()));
  return [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}
