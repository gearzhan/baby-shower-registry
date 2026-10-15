// 后台：保存站点配置。主人守卫（requireHost：未登录 401 / 非主人 403）。
// 四个布尔键：showPrices / showClaimerNames（礼物清单展示开关）+ rsvpClosed / registryClosed（活动后收尾开关）。
// 语义是"按键合并"：前端只发改动的那一个键，没发的键保留 KV 里的当前值 ——
// 否则另一个主人的旧标签页切 Show prices 时，会把整份旧配置写回去，悄悄重新打开 RSVP / 礼物清单。
// 白名单：config 会被 /api/public 与 /api/registry 原样回传给每位宾客，所以 COERCE 之外的键一律丢弃、绝不入库。
// 以后新增配置键，必须加进 COERCE。
import { getConfig, writeJSON, K, json } from '../../lib/kv.js';
import { requireHost } from '../../lib/guard.js';

// 每个键的强制转换：showPrices 缺省为开（!== false），其余缺省为关（=== true）——
// "yes"、1 之类的脏值既关不上也打不开任何东西
const COERCE = {
  showPrices: (v) => v !== false,
  showClaimerNames: (v) => v === true,
  rsvpClosed: (v) => v === true,
  registryClosed: (v) => v === true,
};

export async function onRequestPut({ request, env }) {
  const denied = await requireHost(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_request' }, 400);

  // 读-合并-写：请求里有的键用请求值，没有的沿用当前值；最后统一过一遍 COERCE
  const cur = (await getConfig(env)) || {};
  const next = {};
  for (const [k, f] of Object.entries(COERCE)) next[k] = f(Object.hasOwn(body, k) ? body[k] : cur[k]);
  await writeJSON(env, K.config, next);
  return json({ ok: true, config: next });
}
