// 后台宾客路由（主人守卫 requireHost：未登录 401 / 非主人 403）：
//   POST   /api/admin/guests              新增宾客
//   PATCH  /api/admin/guests/:id          改名 / 改邮箱（改邮箱会吊销该宾客的全部会话，并重置"已发送"）
//   DELETE /api/admin/guests/:id          删除宾客（连带清理其 RSVP）
//   POST   /api/admin/guests/:id/send     发送/重发邀请邮件
//   POST   /api/admin/guests/send-all     群发所有未发送
//   POST   /api/admin/guests/remind-all   提醒已邀请但未回复的宾客（跳过主人与 20 小时内发过信的人）
//   PUT    /api/admin/guests/:id/rsvp     主人代填/修改该宾客 RSVP
import { getGuests, getEvent, getClaims, getRsvps, getConfig, writeJSON, K, json } from '../../../lib/kv.js';
import { requireHost } from '../../../lib/guard.js';
import { sendEmail, hostEmails } from '../../../lib/resend.js';
import { invitationEmail, reminderEmail } from '../../../lib/email-templates.js';
import { signToken, INVITE_TTL_MS } from '../../../lib/token.js';

// 群发节流（邀请群发 / 提醒群发共用，见 sendBatched）：Resend 默认每个团队 10 次/秒、不给突发额度，
// 而且这份额度和登录验证码（auth/start）、主人通知共用 —— 群发最多只占一半：每批 5 封并行，批与批之间停 1 秒。
// 被限流（429）的那封由 sendEmail 返回 {ok:false}：计入 failed、不打标记，主人再点一次就只重试它们。
const SEND_BATCH = 5;
const SEND_PAUSE_MS = 1000;
// 提醒冷却：距上一封邀请或提醒（max(sentAt, remindedAt)）不足 20 小时的宾客这次跳过 ——
// 足以盖住连点、两位主人同时点、KV 约 60 秒的传播延迟和刚发出的邀请；又短到不妨碍每天提醒一次。
const REMIND_COOLDOWN_MS = 20 * 60 * 60 * 1000;
// 邮箱比较一律用它（去空格 + 小写）。本模块只声明这一次 —— 以后的功能直接复用，重复声明会让整个路由模块语法错误、全部 500
const lc = (s) => String(s || '').trim().toLowerCase();
// 邮箱形状校验（Resend 能接收的最小形状），addGuest / editGuest 共用；前端 src/util.js 的 EMAIL_RE 是同一条规则
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 整键改写 guests 的增 / 改 / 删：群发（邀请 / 提醒）每批都会重写这个键，KV 同一个键每秒只允许写一次，
// 主人此时加人、改名、删人很容易撞上。撞上时回一句可重试的 429（errText 原样显示），而不是冒成 500 ——
// 与 items 路由的 saveItems 同一规则。返回 null 表示写成功。
const BUSY = 'Saving too fast — try again in a moment.';
const kvBusy = (e) => /429|too many/i.test(String(e && e.message));
async function saveGuests(env, guests) {
  try {
    await writeJSON(env, K.guests, guests);
    return null;
  } catch (e) {
    if (kvBusy(e)) return json({ error: BUSY }, 429);
    throw e;
  }
}

// 邀请链接：?i=<令牌> 只说明"这封信是发给谁的"，点开它不构成登录 ——
// 落地页拿它去要验证码，验证码仍然只发到该宾客自己的邮箱。转发出去也无从冒充。
// 令牌带上宾客当前的会话版本 sv：改邮箱会让 sv +1，寄往旧（错）地址的链接随即作废（auth/start、auth/verify 比对）
async function inviteUrl(env, guest) {
  const token = await signToken(env, 'i', { guestId: guest.id, sv: guest.sv || 0 }, INVITE_TTL_MS);
  const base = env.PUBLIC_BASE_URL || '';
  return `${base}/?i=${token}`;
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function newId() {
  return 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

// 群发（邀请 / 提醒）要跑好几秒（每批之间停 1 秒）。客户端中途断开（刷新、关页、手机断网）时，
// Workers 会取消本请求的全部任务 —— 包括批间计时器和后面的标记写回：已寄出的人没记上，主人再点一次就重复发信。
// 交给 waitUntil：断开后"发信 + 打标记"继续跑完（最多再续 30 秒，够 20 多批）。.catch 只为不让 waitUntil 报未处理的拒绝，
// 响应仍走原 promise（出错照旧 500）
function keepAlive(context, p) {
  context.waitUntil(p.catch(() => {}));
  return p;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const denied = await requireHost(request, env);
  if (denied) return denied;

  const seg = params.path || [];
  const m = request.method;

  if (m === 'POST' && seg.length === 0) return addGuest(request, env);
  if (m === 'POST' && seg.length === 1 && seg[0] === 'send-all') return keepAlive(context, sendAll(env));
  // 宾客 id 是 'u…' 或 'host-…'，不会和 remind-all 撞名
  if (m === 'POST' && seg.length === 1 && seg[0] === 'remind-all') return keepAlive(context, remindAll(env));
  if (m === 'PATCH' && seg.length === 1) return editGuest(request, env, seg[0]);
  if (m === 'DELETE' && seg.length === 1) return removeGuest(env, seg[0]);
  if (m === 'POST' && seg.length === 2 && seg[1] === 'send') return sendInvite(env, seg[0]);
  if (m === 'PUT' && seg.length === 2 && seg[1] === 'rsvp') return recordRsvp(request, env, seg[0]);
  return json({ error: 'not_found' }, 404);
}

async function addGuest(request, env) {
  const { name, email } = await request.json().catch(() => ({}));
  const n = (name || '').trim(), em = (email || '').trim().toLowerCase();
  // 邮箱形状校验（Resend 能接收的最小形状）：拦住 a@b / anne@ / "john smith@x.com"，
  // 否则这些地址会持久化成一条永远发不出去、又被 send-all 反复重试的死行
  if (!n || !EMAIL_RE.test(em)) return json({ error: 'A name and a valid email are needed.' }, 400);
  const guests = await getGuests(env);
  if (guests.some((g) => (g.email || '').toLowerCase() === em)) return json({ error: 'That email is already on the list.' }, 409);
  const guest = { id: newId(), name: n, email: em, sentAt: null };
  guests.push(guest);
  const busy = await saveGuests(env, guests);
  if (busy) return busy;
  return json({ ok: true, guest });
}

// 改名 / 改错邮箱。id 不变，所以 RSVP（rsvp:<id>）和认领（claim:* 里的 guestId）都原样跟着这位宾客。
// 字段缺省即保持原值（前端总是两个都传）。返回 { ok, guest, emailChanged }；什么都没变时同样形状、不写 KV。
async function editGuest(request, env, id) {
  // 请求体是 JSON null / 非对象时也按"空"处理，别让 null.name 变成一个裸 500
  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === 'object' ? raw : {};
  const guests = await getGuests(env);
  const g = guests.find((x) => x.id === id);
  // 4xx 的 error 文案会被前端 errText 原样显示，所以这里也给人话（不是 'not_found'）
  if (!g) return json({ error: 'That guest is no longer on the list.' }, 404);

  const n = String(body.name ?? g.name ?? '').trim();
  const em = lc(body.email ?? g.email);
  if (!n || !EMAIL_RE.test(em)) return json({ error: 'A name and a valid email are needed.' }, 400);

  const emailChanged = em !== lc(g.email);
  if (emailChanged) {
    // 主人的邮箱不许在这里改：HOST_EMAILS 是主人的唯一来源，改掉等于把他从主人里摘掉；
    // 而且 getGuests 会按原邮箱再注入一条新的主人行 —— 同一个人分裂成两行，他的 RSVP / 认领留在旧行上。
    // 已不在 HOST_EMAILS 里、但 id 仍是 host-* 的旧主人行也锁住：邮箱哪天被加回 HOST_EMAILS 时同样会分裂。改名不受限。
    if (hostEmails(env).map(lc).includes(lc(g.email)) || String(g.id).startsWith('host-')) {
      return json({ error: 'A host’s email comes from the site settings and can’t be changed here.' }, 403);
    }
    // 唯一性必须对照 getGuests()（它总是并入了全部 HOST_EMAILS）—— 承重检查，别删、别换成直接读 KV：
    // 否则可以把某位宾客改成主人的邮箱，他手里现有的会话随即被 isHost 判成主人（主人权限按邮箱认）。
    if (guests.some((x) => x.id !== id && lc(x.email) === em)) {
      return json({ error: 'That email is already on the list.' }, 409);
    }
  }

  if (n === g.name && !emailChanged) return json({ ok: true, guest: g, emailChanged: false });

  g.name = n;
  if (emailChanged) {
    g.email = em;
    // 信是寄去旧地址的：新地址还没收到邀请，标回"未发送"；提醒记录同理清掉（否则会显示从未寄出过的 "Reminded …"）
    g.sentAt = null;
    delete g.remindedAt;
    // 会话版本 +1：旧地址那边签出的所有会话立即失效（guard.js 的 resolveGuest 比对 sv）
    g.sv = (g.sv || 0) + 1;
  }
  const busy = await saveGuests(env, guests);
  if (busy) return busy;
  return json({ ok: true, guest: g, emailChanged });
}

async function removeGuest(env, id) {
  const guests = await getGuests(env);
  const g = guests.find((x) => x.id === id);
  if (!g) return json({ ok: true });
  // 主人不能被移出名单：后台入口就认这份名单，删掉自己等于把自己永久锁在门外
  const hosts = hostEmails(env).map((e) => e.toLowerCase());
  if (hosts.includes((g.email || '').toLowerCase())) {
    return json({ error: 'Hosts can’t be removed from the guest list.' }, 403);
  }
  // 先删名单行：撞限速就整个不做（RSVP、认领都还在），不留半删的状态
  const busy = await saveGuests(env, guests.filter((x) => x.id !== id));
  if (busy) return busy;
  await env.BS_KV.delete(K.rsvp(id));
  // 连带清掉他名下的礼物认领 —— 否则礼物会永远停在"已被某个已不在名单上的人认领"，
  // 没人能再认领，本人的会话也已吊销无法自撤（与上面清 RSVP 对称）
  const claims = await getClaims(env);
  await Promise.all(
    Object.entries(claims)
      .filter(([, c]) => c.guestId === id)
      .map(([itemId]) => env.BS_KV.delete(K.claim(itemId)))
  );
  return json({ ok: true });
}

async function sendInvite(env, id) {
  if (!env.TOKEN_SECRET) return json({ error: 'TOKEN_SECRET is not configured — invitations can’t be signed.' }, 500);
  const guests = await getGuests(env);
  const g = guests.find((x) => x.id === id);
  if (!g) return json({ error: 'not_found' }, 404);

  // 先发信、再落 sentAt：发失败就不标记，否则该宾客会被 send-all 永久跳过
  const event = await getEvent(env);
  const sent = await sendEmail(env, { to: g.email, ...invitationEmail(event, await inviteUrl(env, g), g) });
  if (!sent.ok) return json({ error: 'Could not send the invitation — please try again.' }, 502);

  // 发信期间名单可能已被改动，重新读取后再写回，避免用陈旧快照覆盖
  const fresh = await getGuests(env);
  const fg = fresh.find((x) => x.id === id);
  if (!fg) return json({ error: 'not_found' }, 404);
  // 与 sendAll 同一条规则：信寄去的是发信时的地址；期间邮箱被改过，就不能给新地址记"已发送"
  if (lc(fg.email) !== lc(g.email)) return json({ error: 'The email changed while sending — please send again.' }, 409);
  // 信已经寄出：标记 sentAt 用永不抛错的 stampGuests（重读 + 撞限速重试一次）。
  // 写失败也绝不能回 500 —— 那会让主人以为没发出去、再点一次，宾客就收到第二封
  const stamped = await stampGuests(env, new Map([[id, lc(g.email)]]), (x) => { x.sentAt = Date.now(); });
  return json({ ok: true, ...(stamped ? {} : { stampFailed: true }) });
}

// 分批并行发信（邀请群发 / 提醒群发共用）：压缩墙钟时间，同时不撑爆 Worker 的子请求预算；
// 批与批之间停 SEND_PAUSE_MS（最后一批之后不停），守住 Resend 的限速。
// 等计时器不耗 Worker 的 CPU 时间；console 模式也照样停，本地测试与线上同一节奏。
// render(g, url) 返回 { subject, html, text }。返回 Map<宾客 id, 实际寄往的邮箱（lc 后）>，只含真正发送成功的 ——
// 调用方写回时必须在重新读取的名单上核对 sent.get(g.id) === lc(g.email)：邮箱在发信期间被改过的不打标记。
// onBatch(sent)（可选）：每批有新的成功就调用一次、传入"到目前为止"的累计 Map —— 调用方借它每批落一次标记（见 stampGuests），
// 万一整个调用还是被掐断，最多只丢正在发的那一批的标记，而不是全部（全部丢了，主人再点就会给已收到的人重复发信）。
// 每批写一次不会撞 KV 同键每秒一次的写限：两次写之间至少隔着 SEND_PAUSE_MS + 一批发信耗时。
async function sendBatched(env, list, render, onBatch) {
  const sent = new Map();
  for (let i = 0; i < list.length; i += SEND_BATCH) {
    if (i) await new Promise((r) => setTimeout(r, SEND_PAUSE_MS));
    const batch = list.slice(i, i + SEND_BATCH);
    const results = await Promise.all(
      batch.map(async (g) => sendEmail(env, { to: g.email, ...render(g, await inviteUrl(env, g)) }))
    );
    let ok = 0;
    results.forEach((r, k) => { if (r.ok) { sent.set(batch[k].id, lc(batch[k].email)); ok++; } });
    if (ok && onBatch) await onBatch(sent);
  }
  return sent;
}

// 把群发标记写回名单：重读最新名单（不能拿发信前的快照覆盖期间新增/删除的宾客），
// 只给"现在的邮箱仍是寄出的那个地址"的宾客调用 mark(g)。每次都套用累计的全部成功（不只是这一批）：
// KV 最终一致，重读可能还看不到上一批刚写的标记，套用累计结果是幂等的，陈旧读也丢不了标记。
// 写失败（多半是另一位主人同一秒也在写 guests，KV 回 429）就停 1.1 秒重读重写一次；仍失败返回 false、绝不抛 ——
// 信已经寄出，不能让一次写失败中断后面的批次，或变成一个看不懂的 500 让主人整轮重发。
async function stampGuests(env, sent, mark) {
  for (let attempt = 0; ; attempt++) {
    try {
      const fresh = await getGuests(env);
      fresh.forEach((g) => { if (sent.get(g.id) === lc(g.email)) mark(g); });
      await writeJSON(env, K.guests, fresh);
      return true;
    } catch (e) {
      if (attempt) return false;
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
}

async function sendAll(env) {
  // signToken 在缺密钥时抛错，而这里包在 Promise.all 里，会变成一个看不懂的 500 —— 提前拦掉
  if (!env.TOKEN_SECRET) return json({ error: 'TOKEN_SECRET is not configured — invitations can’t be signed.' }, 500);
  const guests = await getGuests(env);
  const event = await getEvent(env);
  // 主人是被强制并入名单的（sentAt 为 null），别把邀请群发给主人自己
  const hosts = hostEmails(env).map(lc);
  const unsent = guests.filter((g) => !g.sentAt && !hosts.includes(lc(g.email)));

  // 每批发完就落一次 sentAt（见 sendBatched / stampGuests）；stamped 记最近一次写回是否成功 ——
  // 每次写都套用累计结果，所以只看最后一次
  let stamped = true;
  const sent = await sendBatched(env, unsent, (g, url) => invitationEmail(event, url, g), async (s) => {
    stamped = await stampGuests(env, s, (g) => { if (!g.sentAt) g.sentAt = Date.now(); });
  });
  // 一封都没发出去时照旧写回一次（同从前）：只为持久化内存里补上的主人行，失败无妨。
  // 发出过的就不再补这次写 —— 最后一批刚写过 guests，紧跟着再写同一个键会撞 KV 每秒一次的写限
  if (!sent.size) await stampGuests(env, sent, () => {});

  // stampFailed：信寄出了但没能记进名单 —— 前端据此提示主人别马上重发
  return json({ ok: true, count: sent.size, failed: unsent.length - sent.size, ...(stamped ? {} : { stampFailed: true }) });
}

// RSVP 提醒群发。收件人完全由服务端决定（请求体一概不读）：已发过邀请（sentAt）、还没有 rsvp:<id>
// （主人代填的、回复"不来"的都算已回复）、不是主人，且距上一封邀请/提醒已满 20 小时。
// 先发信、后打标记、写回前重读名单 —— 与 sendAll / sendInvite 同一顺序；发失败的不打 remindedAt，下次再点会重试。
// 标记每批落一次（不是全部发完才写）：请求中途被掐断也最多丢一批的标记，20 小时冷却才真的挡得住重复提醒。
async function remindAll(env) {
  if (!env.TOKEN_SECRET) return json({ error: 'TOKEN_SECRET is not configured — invitations can’t be signed.' }, 500);
  const [guests, rsvps, event, config] = await Promise.all([getGuests(env), getRsvps(env), getEvent(env), getConfig(env)]);
  // RSVP 已关闭：不再催宾客回复（他们此时也回复不了 —— rsvp/submit 同样 423）
  if (config?.rsvpClosed === true) return json({ error: 'RSVPs are closed — reopen them before sending reminders.' }, 423);
  const hosts = hostEmails(env).map(lc);
  const now = Date.now();
  const pending = guests.filter((g) => g.sentAt && !rsvps[g.id] && !hosts.includes(lc(g.email)));
  const due = pending.filter((g) => now - Math.max(g.sentAt, g.remindedAt || 0) >= REMIND_COOLDOWN_MS);

  // 一封都没发出去就不写 KV（onBatch 只在有新的成功时才调用）。整轮用同一个时间戳 now，每批重复套用也幂等
  let stamped = true;
  const sent = await sendBatched(env, due, (g, url) => reminderEmail(event, url, g), async (s) => {
    stamped = await stampGuests(env, s, (g) => { g.remindedAt = now; });
  });
  // failed：该发却发失败（如 Resend 429）；skipped：未回复但还在 20 小时冷却内；
  // stampFailed：信寄出了但没能记进名单（冷却挡不住下一次）—— 前端据此提示主人今天别再点
  return json({ ok: true, count: sent.size, failed: due.length - sent.size, skipped: pending.length - due.length, ...(stamped ? {} : { stampFailed: true }) });
}

async function recordRsvp(request, env, id) {
  const body = await request.json().catch(() => ({}));
  const guests = await getGuests(env);
  const g = guests.find((x) => x.id === id);
  if (!g) return json({ error: 'not_found' }, 404);
  const attending = body.attending === 'yes' ? 'yes' : 'no';
  const rsvp = {
    attending,
    adults: attending === 'yes' ? clampInt(body.adults, 1, 12, 1) : 0,
    kids: attending === 'yes' ? clampInt(body.kids, 0, 12, 0) : 0,
    dietary: String(body.dietary || '').slice(0, 300),
    allergies: String(body.allergies || '').slice(0, 300),
    at: Date.now(),
    byHost: true,
  };
  await writeJSON(env, K.rsvp(id), rsvp);
  return json({ ok: true, rsvp });
}
