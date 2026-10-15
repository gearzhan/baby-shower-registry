// 提交/更新 RSVP（需登录）：身份来自会话 cookie → 写入 rsvp:<guestId> → 邮件通知主人（尽力，不阻塞）。
// 回传服务端夹紧后的记录：前端必须用它来更新本地状态，否则"改成不来"时本地还留着旧的人数。
import { getEvent, getConfig, writeJSON, K, json } from '../../lib/kv.js';
import { requireGuest } from '../../lib/guard.js';
import { sendEmail, hostEmails } from '../../lib/resend.js';
import { hostRsvpNotice } from '../../lib/email-templates.js';

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function onRequestPost({ request, env }) {
  const auth = await requireGuest(request, env);
  if (auth.denied) return auth.denied;
  // 主人关闭了 RSVP（活动后收尾）：每次请求都现读 KV 配置，服务端才是真正的闸门。
  // 主人也不豁免 —— 主人在邀请页看到的就是宾客看到的；主人改答复走 PUT /api/admin/guests/:id/rsvp（不受此限）。
  // 用 423 而不是 403/409：旧缓存前端把后两者映射成别的、会误导的提示；423 带可读的 error 文案。
  if ((await getConfig(env))?.rsvpClosed === true) {
    return json({ error: 'RSVPs are now closed — please contact the hosts if your plans have changed.' }, 423);
  }
  const g = auth.guest;

  const body = await request.json().catch(() => ({}));
  const attending = body.attending === 'yes' ? 'yes' : 'no';
  const rsvp = {
    attending,
    adults: attending === 'yes' ? clampInt(body.adults, 1, 12, 1) : 0,
    kids: attending === 'yes' ? clampInt(body.kids, 0, 12, 0) : 0,
    dietary: String(body.dietary || '').slice(0, 300),
    allergies: String(body.allergies || '').slice(0, 300),
    at: Date.now(),
  };
  await writeJSON(env, K.rsvp(g.id), rsvp);

  const event = await getEvent(env);
  await sendEmail(env, { to: hostEmails(env), ...hostRsvpNotice(g, rsvp, event) });

  return json({ ok: true, rsvp });
}
