// 登录第一步：认人（邮箱在宾客名单内，或凭邀请链接令牌）→ 生成 6 位验证码 → 存 KV(10min TTL) → 邮件下发。
import { getGuests, getEvent, K, json } from '../../lib/kv.js';
import { sendEmail } from '../../lib/resend.js';
import { verificationEmail } from '../../lib/email-templates.js';
import { emailHash, verifyToken } from '../../lib/token.js';

// 6 位验证码用 CSPRNG。取模偏差约 5e-5%，可以忽略；真正约束爆破的是
// 90 万取值空间 + 10 分钟有效期 + 5 次猜错锁定。
function sixDigit() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(100000 + (n % 900000));
}

// 全站每日发信上限：远高于真实宾客数，只为拦住"绕过单邮箱冷却循环刷码"耗尽共享 Resend 配额的滥用
const DAY_CAP = 200;

export async function onRequestPost({ request, env }) {
  // 未配置密钥时 verify 会 500，这里提前失败，免得白发一封永远兑不掉的验证码
  if (!env.TOKEN_SECRET) return json({ error: 'Sign-in is temporarily unavailable.' }, 500);
  const body = await request.json().catch(() => ({}));
  const guests = await getGuests(env);

  // 两条入口：邀请链接里的令牌（不构成登录，只说明"这封信是发给谁的"）或手输邮箱
  let g = null;
  if (body.inviteToken) {
    const p = await verifyToken(env, String(body.inviteToken), 'i');
    if (!p) return json({ error: 'invalid_invite' }, 400);
    g = guests.find((x) => x.id === p.guestId) || null;
    if (!g) return json({ error: 'not_found' }, 404);
    // 邀请令牌带签发时的会话版本 sv：主人改过这位宾客的邮箱（sv +1）后，寄往旧地址的邀请链接一律作废 ——
    // 否则旧地址那边仍能拿它反复给新地址发验证码（占全站当日额度）、猜码锁住真宾客。没有 sv 的老链接按 0 算，没改过邮箱的照常有效
    if ((p.sv || 0) !== (g.sv || 0)) return json({ error: 'invalid_invite' }, 400);
  } else {
    const em = String(body.email ?? '').trim().toLowerCase();
    if (!em || em.indexOf('@') < 1) return json({ error: 'Please enter a valid email address.' }, 400);
    g = guests.find((x) => (x.email || '').toLowerCase() === em) || null;
    // 如实回 404：宾客把自己的邮箱打错一个字母时必须当场知道，
    // 而不是对着一个永远不会到的验证码干等十分钟。
    if (!g) return json({ error: 'not_found' }, 404);
  }

  const h = await emailHash(g.email);
  // 每邮箱 60 秒冷却，避免验证码邮件轰炸
  const cdKey = K.code(h) + ':cd';
  if (await env.BS_KV.get(cdKey)) return json({ error: 'Please wait a moment before requesting another code.' }, 429);

  // 全站当日发信预算：换邮箱能绕开上面的单邮箱冷却，这道闸兜住全局配额
  const dayKey = 'send:' + new Date().toISOString().slice(0, 10);
  const sentToday = parseInt(await env.BS_KV.get(dayKey), 10) || 0;
  if (sentToday >= DAY_CAP) return json({ error: 'We couldn’t send the code just now — please try again later.' }, 429);

  const code = sixDigit();
  const exp = Date.now() + 600 * 1000;
  await env.BS_KV.put(K.code(h), JSON.stringify({ code, guestId: g.id, exp, attempts: 0 }), { expirationTtl: 600 });
  await env.BS_KV.put(cdKey, '1', { expirationTtl: 60 });
  // 重新申请验证码即解除猜错锁定：旧码已作废，攻击者换新码并不占便宜（仍受 60 秒冷却限速），
  // 而手滑连错 5 次的宾客不必干等 15 分钟 —— 否则 verify 那句 "request a new code" 就是骗人的。
  await env.BS_KV.delete(K.code(h) + ':lock');

  const event = await getEvent(env);
  // sendEmail 不抛异常、只回 ok:false —— 必须如实告知宾客，否则他会一直等一封发不出去的邮件。
  // 冷却键保留：失败多半是 Resend 限流，立刻放行重试只会加剧限流，等 60 秒是更便宜的代价。
  const sent = await sendEmail(env, { to: g.email, ...verificationEmail(code, event) });
  if (!sent.ok) return json({ error: 'We couldn’t send the code just now — please try again in a minute.' }, 502);
  // 只在真正发出后才计入当日预算（保留 2 天让 TTL 自然滚动）
  await env.BS_KV.put(dayKey, String(sentToday + 1), { expirationTtl: 172800 });

  const out = { ok: true };
  // 回传验证码只为本地/自动化测试，必须同时满足两个条件才放行：
  //   1) 非 resend 模式（邮件只打印到终端）
  //   2) 站点基址是 localhost
  // 只看 EMAIL_MODE 是不够的：全站（连同后台）都靠这个验证码，一旦生产上把 EMAIL_MODE
  // 配错，邮件发不出去，同时这个接口会把任何宾客的登录码直接回给匿名调用者 —— 一个环境
  // 变量的手误就等于整站认证被绕过。两把锁得同时开错才会出事。
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(env.PUBLIC_BASE_URL || '');
  if ((env.EMAIL_MODE || 'console') !== 'resend' && local) out.devCode = code;
  return json(out);
}
