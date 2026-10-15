// 主人后台的 CSV 导出：纯函数，只拼文本 —— 不碰 React、不碰 DOM（存盘交给 util.js 的 downloadFile），
// 所以能直接在 Node 里导入测试（tests/src/csv.test.js）。
// 数据源是主人守卫后的 GET /api/admin/all 原样返回的 guests / items，不经过 store 的派生值。
import { groupByStore } from './util.js';

// 单元格：一律加双引号、内部双引号写成两个。
// 公式注入防护（OWASP）：以 = + - @ TAB CR LF 开头的值前面补一个撇号，Excel/Numbers 就把它当文本而不是公式。
// 光加引号不够 —— Excel 照样会算 "=1+1"。代价是 '-$10'、'+Shop' 这类正常值也会带撇号，可以接受。
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// 整个文件：开头 UTF-8 BOM（不然 Windows/Mac 上的 Excel 会按 cp1252 解码，重音和中文全乱码），
// 行尾 CRLF（RFC 4180）。BOM 故意写成转义 \uFEFF：不可见字面量会被编辑器/格式化工具悄悄吃掉，评审也看不见。
export function toCsv(header, rows) {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const pad2 = (n) => String(n).padStart(2, '0');

// 时间戳 → 主人本地时间的 DD-MM-YYYY（withTime 时再加 24 小时制 HH:mm）。
// 必须用 getDate/getMonth… 这些本地时间读法，绝不能用 toISOString —— 那是 UTC，
// 本地刚过午夜导出时日期会差一天。空值或非法日期返回 ''（单元格留空）。
export function csvDate(ms, withTime = true) {
  if (!ms) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const day = pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '-' + d.getFullYear();
  return withTime ? day + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : day;
}

// 宾客 + RSVP。行序沿用名单顺序（与后台列表一致，自动补上的主人排最前）。
// dietary/allergies 与后台 notes 同一规则：只有 attending === 'yes' 才写，先 trim 再过公式防护。
// 不来的人一律留空：表单对谢绝者隐藏这两栏却仍会把旧值一起提交（服务端原样存、没 trim），
// 不过滤的话，先答应后改谢绝的人，旧的过敏信息会留在导出里被算进餐饮。
export function guestsCsv(guests) {
  const header = ['Name', 'Email', 'Invitation', 'Invited at', 'Reminded at', 'RSVP', 'Adults', 'Children', 'Dietary', 'Allergies', 'RSVP at'];
  const rows = (guests || []).map((g) => {
    const r = g.rsvp;
    const yes = !!r && r.attending === 'yes';
    return [
      g.name,
      g.email,
      // 主人不需要发邀请：后台列表对主人显示 'Not sent'，导出里标成 Host 更清楚
      g.isHost ? 'Host' : g.sentAt ? 'Sent' : 'Not sent',
      csvDate(g.sentAt),
      // 最近一次 RSVP 提醒（remind-all 写入）；从没提醒过留空
      csvDate(g.remindedAt),
      r ? (yes ? 'Attending' : 'Declined') : 'No reply',
      // 不来的人数记 0；没回复的留空（"还不知道"和"0 人"不是一回事）
      r ? (yes ? r.adults || 0 : 0) : '',
      r ? (yes ? r.kids || 0 : 0) : '',
      yes ? (r.dietary || '').trim() : '',
      yes ? (r.allergies || '').trim() : '',
      r ? csvDate(r.at) : '',
    ];
  });
  return toCsv(header, rows);
}

// 礼物 + 认领。行序与后台礼物页的分组一致（groupByStore：没填 store 的在前，之后按店名 A→Z），
// 每行保留自己原始的 store 写法。
// 认领者邮箱按 claimedById 去名单里查；老格式的认领 {name, at} 没有 guestId（claimedById 为 ''），
// 所以"是否已认领"要看 claimedBy || claimedById，不能用 loadAdmin 补的 claimed（那只看 claimedById）。
// 列是固定的：KV 里老条目残留的 `was` 不会进文件。
// Received at / Thanked at：主人专用的收货/致谢进度，只有 /api/admin/all（getRegistryItems 的 withThanks）才带；
// 进度挂在认领上，所以未认领的行一律留空。
export function registryCsv(items, guests) {
  const header = ['Item', 'Store', 'Brand', 'Price', 'Status', 'Claimed by', 'Claimer email', 'Claimed at', 'Received at', 'Thanked at'];
  const byId = new Map((guests || []).map((g) => [g.id, g]));
  const { ungrouped, groups } = groupByStore(items || []);
  const ordered = [...ungrouped, ...groups.flatMap((s) => s.items)];
  const rows = ordered.map((it) => {
    const claimed = !!(it.claimedBy || it.claimedById);
    const who = it.claimedById ? byId.get(it.claimedById) : null;
    return [
      it.name,
      it.store || '',
      // 后台行里 brand 不去重（与 store 同名也照写），导出同样用原始值；老条目没有 brand 键
      it.brand || '',
      it.price || '',
      claimed ? 'Claimed' : 'Available',
      claimed ? it.claimedBy || (who && who.name) || '' : '',
      (claimed && who && who.email) || '',
      claimed ? csvDate(it.claimedAt) : '',
      claimed ? csvDate(it.receivedAt) : '',
      claimed ? csvDate(it.thankedAt) : '',
    ];
  });
  return toCsv(header, rows);
}
