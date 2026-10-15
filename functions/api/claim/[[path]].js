// 礼物认领（需登录）：
//   POST   /api/claim            { itemId }   认领 —— 认的是"当前登录的这个人"，不再手输姓名
//   DELETE /api/claim/:itemId                 撤销自己的认领（改主意了）；主人已标记"收到"的礼物不能自撤（409）
// 主人关闭礼物清单（registryClosed）后，认领和撤销都冻结（423）；主人仍可走 POST /api/admin/items/:id/unclaim 代为撤销。
import { getItems, getConfig, readJSON, writeJSON, K, json } from '../../lib/kv.js';
import { requireGuest } from '../../lib/guard.js';
import { sendEmail, hostEmails } from '../../lib/resend.js';
import { hostClaimNotice, hostUnclaimNotice } from '../../lib/email-templates.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const auth = await requireGuest(request, env);
  if (auth.denied) return auth.denied;

  const seg = params.path || [];
  const m = request.method;

  // 检查顺序：401 → 423（清单已关闭）→ 各自的 400/404/403/409。
  // 关闭检查放在读任何礼物/认领记录之前，所以 423 不会泄露"这件礼物存不存在、被谁认领了"。
  // 以后在这里加的其它检查（如"已收到"的 409）都必须排在它后面。未匹配的方法直接 404，不读配置。
  if (m === 'POST' && seg.length === 0) return (await closed(env)) || claim(request, env, auth.guest);
  if (m === 'DELETE' && seg.length === 1) return (await closed(env)) || unclaim(env, auth.guest, seg[0]);
  return json({ error: 'not_found' }, 404);
}

// 礼物清单已关闭 → 423 + 可读文案（前端 errText 原样显示）；未关闭 → null，继续走正常流程。
// 每次现读 KV 配置；主人也不豁免（主人走后台的代为撤销接口）。
async function closed(env) {
  return (await getConfig(env))?.registryClosed === true
    ? json({ error: 'The registry is now closed — gifts can no longer be claimed or changed.' }, 423)
    : null;
}

async function claim(request, env, guest) {
  const { itemId } = await request.json().catch(() => ({}));
  const id = String(itemId ?? '').trim();
  if (!id) return json({ error: 'bad_request' }, 400);

  const items = await getItems(env);
  const item = items.find((x) => x.id === id);
  if (!item) return json({ error: 'not_found' }, 404);

  const existing = await readJSON(env, K.claim(id), null);
  if (existing) {
    // 本人重复认领 → 幂等返回 200。别回 409：另一个标签页里的旧快照重复提交时，
    // 409 会让前端把这件礼物画成"被别人抢走了"，宾客于是又去认领第二件（两个婴儿浴盆）。
    // 只回 {guestId, name, at}：KV 里的记录可能还带着主人专用的 receivedAt/thankedAt，绝不能原样回给宾客
    if (existing.guestId === guest.id) return json({ ok: true, claim: { guestId: existing.guestId, name: existing.name, at: existing.at } });
    // 已被他人认领：不回传认领者姓名（避免绕过 showClaimerNames 泄露）
    return json({ error: 'already_claimed' }, 409);
  }

  const rec = { guestId: guest.id, name: guest.name, at: Date.now() };
  await writeJSON(env, K.claim(id), rec);
  await sendEmail(env, { to: hostEmails(env), ...hostClaimNotice(item, guest.name) });

  return json({ ok: true, claim: rec });
}

async function unclaim(env, guest, itemId) {
  const id = String(itemId ?? '').trim();
  const rec = await readJSON(env, K.claim(id), null);
  if (!rec) return json({ error: 'not_found' }, 404);
  if (rec.guestId !== guest.id) return json({ error: 'not_yours' }, 403);
  // 主人已标记"收到"：礼物都到了，宾客不能再自撤（否则会重新开放认领，还把收货/致谢进度一起删掉）。
  // 排在 403 之后，非本人什么也探不到；文案中性，不透露时间也不透露是否已致谢。拒绝时不发通知邮件。
  if (rec.receivedAt) return json({ error: 'This one’s locked in — please contact the hosts to change it.' }, 409);

  await env.BS_KV.delete(K.claim(id));

  // 主人也要收到通知 —— 否则收件箱里永远停在"Ann 认领了婴儿浴盆"，而她两天前就反悔了
  const items = await getItems(env);
  const item = items.find((x) => x.id === id);
  if (item) await sendEmail(env, { to: hostEmails(env), ...hostUnclaimNotice(item, guest.name) });

  return json({ ok: true });
}
