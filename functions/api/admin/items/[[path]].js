// 后台礼物路由（主人守卫）：
//   POST   /api/admin/items              新增礼物
//   PUT    /api/admin/items/:id          编辑礼物
//   DELETE /api/admin/items/:id          删除礼物（连带清理其认领）
//   POST   /api/admin/items/:id/unclaim  取消认领
//   POST   /api/admin/items/:id/rehost   把外链图片(imgUrl)抓回 R2，存为 imgKey 并清空 imgUrl
//   PUT    /api/admin/items/:id/thanks   { received | thanked, at }  收货/致谢进度（仅主人）
import { getItems, readJSON, writeJSON, K, json } from '../../../lib/kv.js';
import { requireHost } from '../../../lib/guard.js';
import { fetchExternalImage, itemMediaKey, MediaError } from '../../../lib/media.js';

// KV 同一个键每秒只允许写一次。批量转存期间每件成功都会整键重写 items，主人这时增删改礼物很容易撞上：
// 撞上时回一句可重试的 429（errText 会原样显示），而不是让异常冒成 500、前端只能说 "Could not save item."
const BUSY = 'Saving too fast — try again in a moment.';
const kvBusy = (e) => /429|too many/i.test(String(e && e.message));
// 写 items 键：限速返回 429 响应；其他错误照旧抛出（→ 500）。返回 null 表示写成功
async function saveItems(env, items) {
  try {
    await writeJSON(env, K.items, items);
    return null;
  } catch (e) {
    if (kvBusy(e)) return json({ error: BUSY }, 429);
    throw e;
  }
}

function newId() {
  return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}
// 只保留礼物应有的字段，避免脏数据
function cleanItem(f, id) {
  return {
    id,
    name: String(f.name || '').trim(),
    store: String(f.store || '').trim(),
    brand: String(f.brand || '').trim(),
    cat: String(f.cat || 'gift').trim() || 'gift',
    desc: String(f.desc || '').trim(),
    price: String(f.price || '').trim(),
    color: String(f.color || '').trim(),
    link: String(f.link || '').trim(),
    imgUrl: String(f.imgUrl || '').trim(),
    imgKey: String(f.imgKey || '').trim(),
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const denied = await requireHost(request, env);
  if (denied) return denied;

  const seg = params.path || [];
  const m = request.method;

  if (m === 'POST' && seg.length === 0) return addItem(request, env);
  if (m === 'PUT' && seg.length === 1) return updateItem(request, env, seg[0]);
  if (m === 'DELETE' && seg.length === 1) return removeItem(env, seg[0]);
  if (m === 'POST' && seg.length === 2 && seg[1] === 'unclaim') return unclaim(env, seg[0]);
  if (m === 'POST' && seg.length === 2 && seg[1] === 'rehost') return rehost(env, seg[0]);
  if (m === 'PUT' && seg.length === 2 && seg[1] === 'thanks') return setThanks(request, env, seg[0]);
  return json({ error: 'not_found' }, 404);
}

async function addItem(request, env) {
  const f = await request.json().catch(() => ({}));
  if (!String(f.name || '').trim()) return json({ error: 'The item needs a name.' }, 400);
  const items = await getItems(env);
  const item = cleanItem(f, newId());
  items.push(item);
  const busy = await saveItems(env, items);
  if (busy) return busy;
  return json({ ok: true, item });
}

async function updateItem(request, env, id) {
  const f = await request.json().catch(() => ({}));
  if (!String(f.name || '').trim()) return json({ error: 'The item needs a name.' }, 400);
  const items = await getItems(env);
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return json({ error: 'not_found' }, 404);
  const oldKey = items[i].imgKey;
  items[i] = { ...items[i], ...cleanItem(f, id) };
  const busy = await saveItems(env, items);
  if (busy) return busy; // 没写成：旧图也不能删
  // 换图后清理被替换的旧对象；放在 KV 写成功之后，避免记录还指向已删对象
  if (oldKey && oldKey !== items[i].imgKey) await env.BS_R2.delete(oldKey);
  return json({ ok: true, item: items[i] });
}

async function removeItem(env, id) {
  const items = await getItems(env);
  const it = items.find((x) => x.id === id);
  const busy = await saveItems(env, items.filter((x) => x.id !== id));
  if (busy) return busy; // 礼物还在：认领和图片都不能动
  await env.BS_KV.delete(K.claim(id));
  if (it && it.imgKey) await env.BS_R2.delete(it.imgKey); // 连带清理该礼物的 R2 图片
  return json({ ok: true });
}

async function unclaim(env, id) {
  await env.BS_KV.delete(K.claim(id));
  return json({ ok: true });
}

// 外链图转存 R2。请求不带 URL：抓的永远是该礼物在 KV 里已存的 imgUrl（主人自己保存过的），
// 伪造的请求挑不了目标。抓回的字节绝不回给调用方，只回 {ok,item} 或一句错误文案。
async function rehost(env, id) {
  const items = await getItems(env);
  const it = items.find((x) => x.id === id);
  if (!it) return json({ error: 'This item no longer exists.' }, 404);
  // 已有 R2 图：幂等，不抓（重复跑批量也安全）
  if (it.imgKey) return json({ ok: true, item: it, already: true });
  const url = String(it.imgUrl || '').trim();
  if (!url) return json({ error: 'This item has no image link to save.' }, 400);

  let img;
  try {
    img = await fetchExternalImage(url);
  } catch (e) {
    if (e instanceof MediaError) return json({ error: e.message }, e.status);
    throw e;
  }

  const key = itemMediaKey(id);
  try {
    await env.BS_R2.put(key, img.bytes, { httpMetadata: { contentType: img.type } });
  } catch {
    return json({ error: 'server_error' }, 500);
  }
  // 从这里起任何失败都要删掉刚放进去的对象（没有任何 KV 记录指向它）
  const drop = () => env.BS_R2.delete(key).catch(() => {});

  // 重新读一次 items：抓取可能花了好几秒，期间主人可能改过这件礼物 ——
  // 绝不能把开头那份快照写回去盖掉主人的修改
  let fresh;
  try {
    fresh = await getItems(env);
  } catch {
    await drop();
    return json({ error: 'server_error' }, 500);
  }
  const i = fresh.findIndex((x) => x.id === id);
  if (i < 0) {
    await drop();
    return json({ error: 'This item no longer exists.' }, 404);
  }
  if (fresh[i].imgKey) {
    // 抓取期间主人上传了照片，或另一个并发转存先赢了：保留现状，丢掉我们这份
    await drop();
    return json({ ok: true, item: fresh[i], already: true });
  }
  if (String(fresh[i].imgUrl || '').trim() !== url) {
    await drop();
    return json({ error: 'The image link changed while saving — please try again.' }, 409);
  }

  // 必须清空 imgUrl：前端 saveItem 把非空 imgUrl 当作"用 URL 顶替照片"（会发 imgKey:''），
  // updateItem 随即删掉旧 key —— 不清的话，下一次普通的编辑保存就会把这份 R2 图删掉、退回外链。
  fresh[i] = { ...fresh[i], imgKey: key, imgUrl: '' };
  try {
    // KV 引用只在 R2 写成功之后才落库：存下来的 imgKey 永远不会指向不存在的对象
    await writeJSON(env, K.items, fresh);
  } catch (e) {
    await drop();
    // KV 同键每秒只允许写一次：批量转存撞上时给可重试的 429（前端会自动重试一次）
    return kvBusy(e) ? json({ error: BUSY }, 429) : json({ error: 'server_error' }, 500);
  }
  return json({ ok: true, item: fresh[i] });
}

// 收货/致谢进度：只存在 claim:<id> 上（receivedAt?/thankedAt?，毫秒时间戳），随认领记录同生同灭 ——
// 所以 removeItem / 主人 unclaim / removeGuest / 宾客自撤 都不用改：删掉 claim:<id> 就连进度一起删了，
// 下一个认领者也不可能"继承"别人的 Received。
// 请求体恰好一个布尔键：{ received: bool } 或 { thanked: bool }；时间戳一律取服务端 Date.now()。
// 另带 at = 主人屏幕上那条认领的 at（毫秒）：和 KV 里现存认领的 at 不一致就 409，不写。
// 否则一个开了几天的后台标签页（屏幕上还是 Ann 的认领，其实 Ann 早撤了、Bo 重新认领了）
// 会把 Received/Thanked 记到 Bo 的认领上 —— 主人照着屏幕去谢 Ann，Bo 反倒被锁住不能自撤。
// 前端遇到 409 会回滚并静默 loadAdmin，那一行随即变成 Bo。老格式认领 {name, at} 一样有 at。
// 规则（与前端乐观更新一致，保证 thankedAt ⇒ receivedAt）：
//   received:true  → 没有才记 receivedAt（重复调用保留原时间，幂等）
//   received:false → receivedAt、thankedAt 一起清掉
//   thanked:true   → 没有才记 thankedAt，顺带补上 receivedAt
//   thanked:false  → 只清 thankedAt
// 只改这两个键，认领记录的其它字段（guestId/name/at…）原样保留；老格式认领 {name, at} 没有 guestId 也照常工作。
// 读-改-写不是原子的：同一传播窗口内宾客刚自撤的认领可能被这里写回来（README 里记着的"KV 无 CAS"取舍）。
async function setThanks(request, env, id) {
  const b = await request.json().catch(() => null);
  const body = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  const keys = Object.keys(body).filter((k) => k === 'received' || k === 'thanked');
  if (keys.length !== 1 || typeof body[keys[0]] !== 'boolean') return json({ error: 'bad_request' }, 400);
  if (body.at !== undefined && typeof body.at !== 'number') return json({ error: 'bad_request' }, 400);

  const rec = await readJSON(env, K.claim(id), null);
  if (!rec || typeof rec !== 'object') return json({ error: 'That gift isn’t claimed any more — refresh to see the latest.' }, 409);
  // 不是主人看到的那条认领（撤了又被认领过）。缺 at 的请求同样对不上 → 绑定是强制的，不是可选的
  if ((rec.at ?? null) !== (body.at ?? null)) return json({ error: 'That gift’s claim has changed — refresh to see the latest.' }, 409);

  let receivedAt = rec.receivedAt || null;
  let thankedAt = rec.thankedAt || null;
  const now = Date.now();
  const want = body[keys[0]];
  if (keys[0] === 'received') {
    if (want) receivedAt = receivedAt || now;
    else { receivedAt = null; thankedAt = null; }
  } else if (want) {
    thankedAt = thankedAt || now;
    receivedAt = receivedAt || now;
  } else {
    thankedAt = null;
  }

  const next = { ...rec };
  delete next.receivedAt;
  delete next.thankedAt;
  if (receivedAt) next.receivedAt = receivedAt;
  if (thankedAt) next.thankedAt = thankedAt;
  try {
    await writeJSON(env, K.claim(id), next);
  } catch (e) {
    // 同一件礼物连点 Received → Thanked 会在一秒内写同一个 claim 键两次：撞限速给可重试的 429，不冒成 500
    if (kvBusy(e)) return json({ error: BUSY }, 429);
    throw e;
  }
  return json({ ok: true, receivedAt, thankedAt });
}
