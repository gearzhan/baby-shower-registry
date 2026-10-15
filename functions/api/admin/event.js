// 后台：保存活动详情。主人守卫（requireHost）。
import { writeJSON, K, json } from '../../lib/kv.js';
import { requireHost } from '../../lib/guard.js';
import { cleanLocal, cleanTz } from '../../lib/calendar.js';

export async function onRequestPut({ request, env }) {
  const denied = await requireHost(request, env);
  if (denied) return denied;
  const event = await request.json().catch(() => null);
  if (!event || typeof event !== 'object') return json({ error: 'bad_request' }, 400);
  // "加入日历"的三个结构化字段：与前端共用 calendar.js 的校验，两边判断永远一致。
  // 缺失 → ''（链接隐藏）；格式错误（非字符串、不存在的日期、非 IANA 时区等）→ 400。
  // 这样 CR/LF 之类的垃圾永远进不了 KV，也就不可能被折进 .ics 的某一行。
  const startsAt = cleanLocal(event.startsAt);
  const endsAt = cleanLocal(event.endsAt);
  const tz = cleanTz(event.tz);
  if (startsAt === null || endsAt === null || tz === null) {
    return json({ error: 'Please pick a valid calendar start, end and time zone.' }, 400);
  }
  // 故意不检查"结束晚于开始"：前端每次防抖按键都会把整份 event（从 dataRef 取）PUT 过来，
  // 这里若回 400，主人在改好时间之前，改其它文字标签也全都存不进去。
  // 结束不晚于开始照样保存 —— 前端 calendarTimes() 返回 null 会隐藏链接，EventTab 给出红字提示。
  const clean = { ...event, startsAt, endsAt, tz };
  await writeJSON(env, K.event, clean);
  return json({ ok: true, event: clean });
}
