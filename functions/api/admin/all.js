// 后台聚合读：一次性返回活动、设计、配置、宾客(并入 RSVP)、礼物(并入认领 + 收货/致谢进度)。主人守卫。
import { getEvent, getDesign, getConfig, getGuests, getRegistryItems, getRsvps, json } from '../../lib/kv.js';
import { requireHost } from '../../lib/guard.js';
import { hostEmails } from '../../lib/resend.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireHost(request, env);
  if (denied) return denied;

  // withThanks：收货/致谢进度（receivedAt/thankedAt）只在这里、只给主人并入；宾客的 /api/registry 永远拿不到
  const [event, design, config, guests, items, rsvps] = await Promise.all([
    getEvent(env), getDesign(env), getConfig(env), getGuests(env), getRegistryItems(env, { withThanks: true }), getRsvps(env),
  ]);
  // 标出哪几个宾客是主人：后台据此隐藏他们的 Remove 按钮（服务端也拒绝删，见 guests 路由）
  const hosts = hostEmails(env).map((e) => e.toLowerCase());
  const guestsMerged = guests.map((g) => ({
    ...g,
    rsvp: rsvps[g.id] || null,
    isHost: hosts.includes((g.email || '').toLowerCase()),
  }));
  return json({ event, design, config, guests: guestsMerged, items });
}
