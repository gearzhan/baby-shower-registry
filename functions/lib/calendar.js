// "加入日历"的纯逻辑：校验 startsAt/endsAt/tz、场地本地时间 → UTC、生成 RFC 5545 .ics 与 Google Calendar 模板链接。
// 服务端（admin/event.js 用 cleanLocal/cleanTz 做保存校验）和前端（store.jsx、EventTab.jsx）共用这一份，
// 和 email-templates.js 被 EmailContentPreview 打包是同一个做法 —— 所以这里必须保持纯净：
// 不读 env、不碰 DOM、不 import 任何东西、导入时没有副作用。时区换算只用 Intl，不引时区库。

// 场地本地时间：datetime-local 输入框产出的格式 'YYYY-MM-DDTHH:MM'（可带秒，存储时去掉）
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
// IANA 时区名的形状。只靠 Intl 不够：新版 V8 的 Intl 也接受 '+05:30' 这类偏移量写法，而 Google 的 ctz= 不认
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/;

// 返回值约定（两个 clean* 一样）：'' = 没填（合法，链接隐藏）；null = 格式错误（服务端回 400）；否则为规范化后的值
export function cleanLocal(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || !LOCAL_RE.test(v)) return null;
  // 往返校验：V8 会把 2027-02-30 滚成 03-02、把 T24:00 滚成次日 —— 格式化回来对不上就是不存在的时间
  const full = v.length === 16 ? v + ':00' : v;
  const d = new Date(full + 'Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 19) !== full) return null;
  return v.slice(0, 16);
}

export function cleanTz(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 64 || !TZ_RE.test(v)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

// 每个时区一个格式化器（构造 Intl.DateTimeFormat 很贵）。只缓存构造成功的，所以条目数以合法时区总数为上限
const fmtCache = new Map();
function fmtFor(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    // hourCycle 'h23'：有的引擎在午夜会打出 '24'，下面再 % 24 兜底
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

// 年月日时分秒（按 UTC 解读）→ 毫秒。不用 Date.UTC：它把 0-99 年当成 1900+ 年
function utcMs(y, mo, d, h, mi, s) {
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t.getTime();
}

// 时区在某一 UTC 时刻的偏移（毫秒，东区为正）：把该时刻在 tz 里的墙上时间当成 UTC 读，与原时刻相减
function offsetAt(ts, tz) {
  const p = {};
  for (const { type, value } of fmtFor(tz).formatToParts(new Date(ts))) p[type] = value;
  return utcMs(+p.year, +p.month, +p.day, +p.hour % 24, +p.minute, +p.second) - ts;
}

// 场地本地时间 + IANA 时区 → UTC 毫秒；任何一项不合法返回 null。
// 先按"本地时间就是 UTC"猜，用猜测点的偏移修正一次，再用修正后时刻的偏移复核（跨夏令时切换时两者不同）。
// 春季跳过的不存在时刻（如纽约 02:30）落到切换前的偏移（= 01:30 EST）；秋季重复的一小时取其中一个时刻。可接受。
export function zonedToUtc(local, tz) {
  try {
    const s = cleanLocal(local);
    if (!s) return null;
    const guess = Date.parse(s + ':00Z');
    const o1 = offsetAt(guess, tz);
    let t = guess - o1;
    const o2 = offsetAt(t, tz);
    if (o2 !== o1) t = guess - o2;
    return Number.isFinite(t) ? t : null;
  } catch {
    return null; // 不认识的时区：Intl 构造时抛错
  }
}

// 三个字段齐全、都合法、且结束晚于开始 → { start, end, tz }（UTC 毫秒）；否则 null（前端据此隐藏链接）。
// 结束不晚于开始的组合服务端照样保存（见 admin/event.js），只在这里被判为"不可用"
export function calendarTimes(event) {
  const e = event || {};
  const s = cleanLocal(e.startsAt);
  const en = cleanLocal(e.endsAt);
  const tz = cleanTz(e.tz);
  if (!s || !en || !tz) return null;
  const start = zonedToUtc(s, tz);
  const end = zonedToUtc(en, tz);
  if (start == null || end == null || !(end > start)) return null;
  return { start, end, tz };
}

// 墙上时间加减分钟（不涉及时区：按 UTC 算再切回 'YYYY-MM-DDTHH:MM'）。EventTab 用它把"结束"默认设成开始 + 3 小时
export function addMinutesLocal(local, min) {
  const s = cleanLocal(local);
  if (!s) return '';
  return new Date(Date.parse(s + ':00Z') + min * 60000).toISOString().slice(0, 16);
}

// UTC 毫秒 → iCalendar / Google 的基本格式 '20270314T020000Z'
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 TEXT 转义：反斜杠、分号、逗号前加反斜杠；换行写成字面 \n；其余控制字符（保留 Tab）直接删掉，
// 这样主人填的任何内容都不可能在 .ics 里另起一行、伪造出新属性
const esc = (s) =>
  String(s ?? '')
    .replace(/[\\;,]/g, (m) => '\\' + m)
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');

// 一个码点的 UTF-8 字节数（孤立代理项下载时会被编码成 U+FFFD，同为 3 字节）
const u8len = (ch) => {
  const c = ch.codePointAt(0);
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
};

// 行折叠：每个物理行不超过 75 个 UTF-8 字节（不含 CRLF），续行以一个空格开头（空格也算 1 字节）。
// 按码点遍历，所以 emoji / 中日韩字符永远不会被从中间劈开
function fold(line) {
  let out = '';
  let n = 0;
  for (const ch of line) {
    const b = u8len(ch);
    if (n + b > 75) {
      out += '\r\n ';
      n = 1;
    }
    out += ch;
    n += b;
  }
  return out;
}

// encodeURIComponent 遇到孤立代理项会抛 URIError —— 这里在渲染路径上（useMemo），不能让一个怪字符把页面打崩
const enc = (s) => {
  try {
    return encodeURIComponent(s);
  } catch {
    return encodeURIComponent(String(s).replace(/[\uD800-\uDFFF]/g, '�'));
  }
};

// .ics 与 Google 链接共用的文案。字段为空时整句省略，避免出现 'Baby Shower for ' / 'Hosted by .'。
// 地图链接只收 http(s)：它会进日历软件的备注，可能被自动识别成可点链接
function texts(event, siteUrl) {
  const t = (v) => String(v ?? '').trim();
  const baby = t(event.baby);
  const hosts = t(event.hosts);
  const venue = t(event.venueName);
  const maps = /^https?:\/\//i.test(t(event.mapsUrl)) ? t(event.mapsUrl) : '';
  const summary = 'Baby Shower' + (baby ? ' for ' + baby : '');
  const desc = [hosts && 'Hosted by ' + hosts + '.', 'Invitation, RSVP & registry: ' + siteUrl, maps && 'Map: ' + maps].filter(Boolean).join('\n');
  return { summary, desc, venue };
}

// 生成 .ics 文本（CRLF 换行、末尾带 CRLF）；三个字段不可用时返回 null。
// siteUrl 由调用方给 location.origin + '/'，绝不能用 location.href —— 那里可能带着 ?i=<邀请令牌>，
// 而 .ics 很容易被转发。UID 固定（每个站点一场活动），SEQUENCE 用当前秒数递增：
// 主人改了时间后宾客重新下载，Apple / Outlook 会更新原日程而不是再添一条
export function buildIcs(event, siteUrl, now = new Date()) {
  const t = calendarTimes(event);
  if (!t) return null;
  const { summary, desc, venue } = texts(event, siteUrl);
  const nowMs = new Date(now).getTime();
  let host = 'localhost';
  try {
    host = new URL(siteUrl).hostname || host;
  } catch {
    /* 非法 siteUrl：保留默认 UID 主机名 */
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Baby Shower//Invitation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:baby-shower@' + host,
    'SEQUENCE:' + Math.floor(nowMs / 1000),
    'DTSTAMP:' + stamp(nowMs),
    'DTSTART:' + stamp(t.start),
    'DTEND:' + stamp(t.end),
    'SUMMARY:' + esc(summary),
    venue && 'LOCATION:' + esc(venue),
    'URL:' + siteUrl,
    'DESCRIPTION:' + esc(desc),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Google Calendar "新建日程"模板链接；不可用时返回 ''。每个参数都 encodeURIComponent。
// 安卓的 Google 日历 App 导入不了 .ics，所以这条链接和 .ics 一起提供
export function googleCalendarUrl(event, siteUrl) {
  const t = calendarTimes(event);
  if (!t) return '';
  const { summary, desc, venue } = texts(event, siteUrl);
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + enc(summary) +
    '&dates=' + stamp(t.start) + '/' + stamp(t.end) +
    '&ctz=' + enc(t.tz) +
    (venue ? '&location=' + enc(venue) : '') +
    '&details=' + enc(desc)
  );
}
