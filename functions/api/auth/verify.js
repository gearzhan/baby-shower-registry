// 登录第二步：校验验证码 → 下发 7 天会话 cookie，并回传宾客身份与已有 RSVP（供前端预填）。
import { getGuests, readJSON, K, json } from '../../lib/kv.js';
import { hostEmails } from '../../lib/resend.js';
import { emailHash, verifyToken } from '../../lib/token.js';
import { sessionCookie } from '../../lib/session.js';

const BAD_CODE = 'That code doesn’t match — please check your email.';

export async function onRequestPost({ request, env }) {
  // 未配置密钥则签不出会话 —— 提前失败，别让 signToken 抛出裸 500 把内部错误抛给宾客
  if (!env.TOKEN_SECRET) return json({ error: 'Sign-in is temporarily unavailable.' }, 500);
  const body = await request.json().catch(() => ({}));

  // 与 start 相同的两条入口：邀请令牌 或 邮箱。最终都归结为一个宾客邮箱，用它算 code 键。
  let em = '';
  if (body.inviteToken) {
    const p = await verifyToken(env, String(body.inviteToken), 'i');
    if (!p) return json({ error: 'invalid_invite' }, 400);
    const guests = await getGuests(env);
    const g = guests.find((x) => x.id === p.guestId);
    if (!g) return json({ error: 'not_found' }, 404);
    // 邀请令牌带签发时的 sv：改过邮箱的宾客，寄往旧地址的邀请链接一律作废（与 start.js 同一条规则）
    if ((p.sv || 0) !== (g.sv || 0)) return json({ error: 'invalid_invite' }, 400);
    em = (g.email || '').toLowerCase();
  } else {
    em = String(body.email ?? '').trim().toLowerCase();
  }
  const h = await emailHash(em);

  // 猜错达上限后的锁定期：直接拒绝，不再碰验证码记录
  const lockKey = K.code(h) + ':lock';
  if (await env.BS_KV.get(lockKey)) {
    return json({ error: 'Too many attempts — please request a new code in a little while.' }, 429);
  }

  const rec = await readJSON(env, K.code(h), null);
  if (!rec) return json({ error: BAD_CODE }, 400);

  // 显式判过期：KV 的 TTL 下限是 60 秒，验证码寿命不能再只靠 TTL 来限定
  const remain = Math.floor(((rec.exp || 0) - Date.now()) / 1000);
  if (remain <= 0) {
    await env.BS_KV.delete(K.code(h));
    return json({ error: BAD_CODE }, 400);
  }

  if (String(body.code) !== String(rec.code)) {
    // 限制猜测次数：达到上限即作废该验证码，并锁定该邮箱 15 分钟
    const attempts = (rec.attempts || 0) + 1;
    if (attempts >= 5) {
      await env.BS_KV.delete(K.code(h));
      await env.BS_KV.put(lockKey, '1', { expirationTtl: 900 });
    } else {
      // TTL 取下限 60（KV 拒绝更小的值）；真正的过期判断在上面的 rec.exp
      await env.BS_KV.put(K.code(h), JSON.stringify({ ...rec, attempts }), { expirationTtl: Math.max(60, remain) });
    }
    return json({ error: BAD_CODE }, 400);
  }

  const guests = await getGuests(env);
  const byId = guests.filter((x) => x.id === rec.guestId);
  if (!byId.length) return json({ error: 'not_found' }, 404);
  // 验证码绑定它被寄往的那个地址：该宾客现在的邮箱必须仍是这个地址。承重检查 ——
  // 否则主人改邮箱之前、旧地址刚要到的验证码，10 分钟内仍能换出一枚按"新" sv 签发的会话，改邮箱的吊销就白做了
  // 两边都规范化（去空格 + 小写）后再比 —— code 键的 emailHash 也是这么规范化的。
  // 按 id **和** 地址一起找：早先持久化的名单里可能有两条同 id 的主人行（getGuests 现在不再造出这种行），
  // 只按 id 找会拿到另一条、地址对不上，把第二位主人锁在门外
  const g = byId.find((x) => (x.email || '').trim().toLowerCase() === em.trim());
  if (!g) {
    await env.BS_KV.delete(K.code(h));
    return json({ error: BAD_CODE }, 400);
  }

  const rsvp = await readJSON(env, K.rsvp(g.id), null);
  const cookie = await sessionCookie(request, env, g);
  await env.BS_KV.delete(K.code(h)); // 验证码一次性

  const hosts = hostEmails(env).map((e) => e.toLowerCase());
  const isHost = hosts.includes((g.email || '').toLowerCase());
  return json({ ok: true, guest: { id: g.id, name: g.name, isHost }, rsvp }, 200, { 'set-cookie': cookie });
}
