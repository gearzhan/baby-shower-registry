// 活动/设计/配置（需登录）：全站已围起来，未登录只有落地页
import { getEvent, getDesign, getConfig, json } from '../lib/kv.js';
import { requireGuest } from '../lib/guard.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireGuest(request, env);
  if (auth.denied) return auth.denied;

  const [event, design, config] = await Promise.all([getEvent(env), getDesign(env), getConfig(env)]);
  return json({ event, design, config });
}
