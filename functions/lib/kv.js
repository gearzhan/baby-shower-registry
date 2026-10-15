// KV 数据访问层：JSON 读写 + 种子回退 + 认领/RSVP 合并。
import { SEED_EVENT, SEED_DESIGN, SEED_CONFIG, SEED_ITEMS } from './seed-data.js';
import { hostEmails } from './resend.js';
import { emailHash } from './token.js';

export const K = {
  event: 'event',
  design: 'design',
  config: 'config',
  guests: 'guests',
  items: 'items',
  rsvp: (id) => 'rsvp:' + id,
  claim: (id) => 'claim:' + id,
  code: (hash) => 'code:' + hash,
};

// 读 JSON，缺失时返回 fallback 的深拷贝（避免调用方就地改写模块级种子常量）
export async function readJSON(env, key, fallback = null) {
  const raw = await env.BS_KV.get(key);
  if (raw == null) return fallback == null ? fallback : JSON.parse(JSON.stringify(fallback));
  try { return JSON.parse(raw); } catch { return fallback == null ? fallback : JSON.parse(JSON.stringify(fallback)); }
}

export async function writeJSON(env, key, val) {
  await env.BS_KV.put(key, JSON.stringify(val));
}

// 主人可编辑的三块：缺失时回退到种子默认
// event 额外做逐字段合并：老数据里没有的新字段（如 registryWelcome/emailMessage）取种子默认，
// 这样加字段永远不需要迁移 KV，前端与邮件模板也不用到处判 undefined
export const getEvent = async (env) => ({ ...SEED_EVENT, ...(await readJSON(env, K.event, {})) });
export const getDesign = (env) => readJSON(env, K.design, SEED_DESIGN);
export const getConfig = (env) => readJSON(env, K.config, SEED_CONFIG);
export const getItems = (env) => readJSON(env, K.items, SEED_ITEMS);
// 宾客名单：始终保证 HOST_EMAILS 里的主人在册。
//
// 不能只把主人放进"种子回退"—— 种子只在键缺失时生效，而生产上 guests 键早就被写过了：
// 于是主人不在名单里 → 登录接口 404 → 没人能拿到会话 → 没人能进后台 → 没人能把主人加回名单。
// 我们就是这么在生产上把自己锁在门外的。后台入口认的是这份名单，所以主人必须无条件在册。
//
// 只在内存里补齐，不主动写 KV；下一次后台写名单（加宾客/发邀请）会顺手把它们持久化。
// HOST_EMAILS 是主人的唯一来源（种子里没有主人）：缺谁就现造一条，id 由邮箱稳定导出，
// 名字先取邮箱前缀 —— 已持久化的主人行（含主人改过的名字）原样保留，不会被这里覆盖。
//
// id 必须唯一：只取邮箱前 20 个字母数字，两个主人地址（如同一前缀的 gmail / outlook）会导出同一个 id ——
// 而登录、会话、改名、认领者姓名全都按 id 找人，撞了就会把第二位主人锁在门外或认成第一位。
// 所以导出的 id 已被占用（已存的行，或本轮先造的行）时，追加该邮箱哈希的前 6 位作后缀。
// 哈希是确定的，未持久化前每次读到的 id 也不变；没撞的 id 保持原样，已有的 rsvp:/claim: 记录都不受影响。
export async function getGuests(env) {
  const list = await readJSON(env, K.guests, []);
  const have = new Set(list.map((g) => (g.email || '').toLowerCase()));
  const taken = new Set(list.map((g) => g.id));
  const missing = [];
  for (const raw of hostEmails(env)) {
    const em = raw.toLowerCase();
    if (have.has(em)) continue;
    have.add(em); // HOST_EMAILS 里重复写了同一个邮箱也只补一条
    let id = 'host-' + em.replace(/[^a-z0-9]/g, '').slice(0, 20);
    if (taken.has(id)) id += '-' + (await emailHash(em)).slice(0, 6);
    taken.add(id);
    missing.push({ id, name: em.split('@')[0], email: em, sentAt: null });
  }
  return missing.length ? [...missing, ...list] : list;
}

// 认领表：claim:* 逐键读取，返回 { itemId: {guestId, name, at, receivedAt?, thankedAt?} }
// （receivedAt/thankedAt 是主人专用的收货/致谢进度，见 getRegistryItems 的 withThanks）
export async function getClaims(env) {
  const list = await env.BS_KV.list({ prefix: 'claim:' });
  const entries = await Promise.all(
    list.keys.map(async (k) => {
      const v = await readJSON(env, k.name, null);
      return [k.name.slice('claim:'.length), v];
    })
  );
  const out = {};
  for (const [id, v] of entries) if (v) out[id] = v;
  return out;
}

// RSVP 表：rsvp:* 逐键读取，返回 { guestId: {attending,adults,kids,dietary,allergies,at} }
export async function getRsvps(env) {
  const list = await env.BS_KV.list({ prefix: 'rsvp:' });
  const entries = await Promise.all(
    list.keys.map(async (k) => {
      const v = await readJSON(env, k.name, null);
      return [k.name.slice('rsvp:'.length), v];
    })
  );
  const out = {};
  for (const [id, v] of entries) if (v) out[id] = v;
  return out;
}

// 礼物 + 认领合并：每件礼物带上 claimedBy/claimedAt/claimedById。
// claimedById 只供服务端判断"是不是本人认领的"，绝不能直接回给公开接口 ——
// api/registry.js 靠显式解构剥掉它，往这里加字段前先去看那一处。
// 收货/致谢进度（receivedAt/thankedAt）只给主人：必须显式传 { withThanks: true } 才并入，
// 目前只有后台聚合读 admin/all.js 这么传。宾客走的 api/registry.js 不传，而且那里的显式解构还会再剥一遍（第二道闸）。
// 认领者姓名按 guestId 回名单现查：主人给宾客改名（包括主人自己那个默认的邮箱前缀名）立刻处处生效。
// claim 里存的 name 只是兜底 —— 老格式认领 {name, at} 没有 guestId，只能用它；认领记录本身从不改写。
// 这里只取姓名、不取邮箱。
export async function getRegistryItems(env, { withThanks = false } = {}) {
  const [items, claims, guests] = await Promise.all([getItems(env), getClaims(env), getGuests(env)]);
  const nameOf = new Map(guests.map((g) => [g.id, g.name]));
  return items.map((it) => {
    const c = claims[it.id];
    if (!c) return it;
    const out = { ...it, claimedBy: (c.guestId && nameOf.get(c.guestId)) || c.name, claimedAt: c.at, claimedById: c.guestId || '' };
    if (withThanks) {
      out.receivedAt = c.receivedAt || null;
      out.thankedAt = c.thankedAt || null;
    }
    return out;
  });
}

// 统一 JSON 响应（禁缓存，避免认领/RSVP 状态陈旧）
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}
