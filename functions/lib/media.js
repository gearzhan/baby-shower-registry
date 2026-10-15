// 媒体共用工具（仅服务端）：
//   - MAX_IMAGE / itemMediaKey：上传路由与"外链图转存"共用的唯一来源，两处写 R2 的格式不会各走各的
//   - fetchExternalImage：主人把礼物的外链图片(imgUrl)抓回 R2 时用的加固版抓取
//
// 抓取的加固要点（生产上 Pages Functions 的 fetch 只出公网，这些是纵深防御）：
//   只认 https + 默认端口、不带账号密码；主机名必须是"公网域名"——拒 IP 字面量、单段主机名、
//   localhost/.local/.internal 等内网后缀；redirect:'manual' 逐跳重新校验，最多 3 跳；
//   10 秒总超时覆盖整条跳转链；8MB 上限在流式读取时就卡住（不信 Content-Length）；
//   存储类型只看魔数（JPEG/PNG/GIF/WebP/AVIF），绝不信对方的 Content-Type —— SVG/HTML 永远存不进来。

export const MAX_IMAGE = 8 * 1024 * 1024; // 8MB
export const MIN_IMAGE = 1024; // 1KB 以下多半是 1×1 跟踪像素或"图片缺失"小 GIF
export const FETCH_TIMEOUT_MS = 10000; // 整条跳转链共用的总超时
export const MAX_REDIRECTS = 3;

// 礼物图的 R2 key：item-<清洗后的礼物 id，≤24 位>-<12 位随机>。
// 随机段来自 crypto.randomUUID（不是时间戳）：/api/media 不设登录门槛，key 必须猜不出来。
export function itemMediaKey(itemId) {
  const rid = String(itemId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'x';
  return `item-${rid}-${crypto.randomUUID().slice(0, 12)}`;
}

// 带 HTTP 状态码的业务错误：路由层捕获后原样回给主人（message 是给人看的英文文案）
export class MediaError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MediaError';
    this.status = status;
  }
}

// 面向主人的英文文案（集中放，单测也按这些断言）
export const MSG = {
  badUrl: 'Only https:// links to a public website can be saved.',
  tooManyRedirects: 'The image link redirects too many times.',
  badRedirect: 'The image link redirects somewhere that can’t be saved.',
  timeout: 'The store took too long to respond — try again later.',
  unreachable: 'Could not reach the store’s server.',
  upstream: (status) => `The store’s server answered ${status} — upload a photo instead.`,
  tooBig: 'That image is over 8 MB — upload a smaller photo instead.',
  tooSmall: 'That link returned an empty or placeholder image.',
  notImage: 'That link didn’t return a JPEG, PNG, GIF, WebP or AVIF image — the store may be blocking downloads.',
};

// 内网/本机常见后缀：单段名（无点）另行拒绝
const LOCAL_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|localdomain|home\.arpa)$/;
// WHATWG URL 解析器会把 2130706433、0x7f.1、127.1 之类统一规范成点分十进制，这一条正则就能兜住；
// 别再加"全是十六进制字符"之类的判断 —— 会误伤 cafe.de 这种真实域名。
const IPV4 = /^\d+(\.\d+){3}$/;

// 校验并返回 URL 对象（base 用于解析跳转的相对 Location）；不合格返回 null
export function publicHttpsUrl(raw, base) {
  let u;
  try {
    u = base ? new URL(String(raw), base) : new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null; // 也顺带拒掉 https→http 的降级跳转
  if (u.port !== '') return null; // :443 已被规范成 ''，其余端口一律不认
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.')) return null; // 单段主机名（内网机器名）
  if (host.startsWith('[')) return null; // IPv6 字面量
  if (IPV4.test(host)) return null; // IPv4 字面量（含各种变体，见上）
  if (LOCAL_SUFFIX.test(host)) return null;
  return u;
}

// 魔数判定图片类型；不认识（含 SVG/HTML/HEIC）返回 null
export function sniffImageType(u8) {
  if (!u8 || u8.length < 12) return null;
  const at = (off, s) => {
    if (off + s.length > u8.length) return false;
    for (let i = 0; i < s.length; i++) if (u8[off + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  if (u8[0] === 0x89 && at(1, 'PNG\r\n\x1a\n')) return 'image/png';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp')) {
    // ISO-BMFF：ftyp 盒 = 大端 4 字节长度 + 'ftyp' + 主品牌 + 版本 + 兼容品牌列表。
    // 从偏移 8 起每 4 字节找 avif/avis（版本字段顺带扫过，无害），不超过盒长与 64 字节
    const size = ((u8[0] << 24) >>> 0) + (u8[1] << 16) + (u8[2] << 8) + u8[3];
    const end = Math.min(size, 64, u8.length);
    for (let off = 8; off + 4 <= end; off += 4) {
      if (at(off, 'avif') || at(off, 'avis')) return 'image/avif';
    }
  }
  return null;
}

// 抓取时发的请求头：
// - accept 优先 WebP/PNG/JPEG、故意不列 AVIF：Shopify CDN、Next.js /_next/image、?tr= 这类图床按 Accept
//   协商格式，而 AVIF 要 iOS 16+；对方若仍回 AVIF，照样收（只是不主动要）
// - 浏览器式 UA：很多 CDN/机器人规则会 403 空 UA 或脚本 UA；这和宾客浏览器直接外链时发的一样
// - 不带 Cookie、不带 Referer（空 Referer 能过大多数防盗链）
const FETCH_HEADERS = {
  accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8',
  'accept-language': 'en',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// 一个在 signal 中止时 reject 的 promise：与 fetch / reader.read() 竞速，
// 这样即使运行时没把 signal 接到响应体流上，10 秒总超时也一定生效
function abortRace(signal) {
  let off = () => {};
  const p = new Promise((_, reject) => {
    const fail = () => reject(new MediaError(422, MSG.timeout));
    if (signal.aborted) return fail();
    signal.addEventListener('abort', fail, { once: true });
    off = () => signal.removeEventListener('abort', fail);
  });
  p.catch(() => {}); // 没人等它时也别变成未处理的 rejection
  return { p, off };
}

// 丢弃不需要的响应体，释放连接（失败无所谓）
async function discard(res) {
  try { if (res.body) await res.body.cancel(); } catch { /* 忽略 */ }
}

// 流式读取响应体，超过 max 立即取消并报 413；先看 Content-Length 快速拒绝，但不信它
async function readCapped(res, max, aborted) {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) {
    await discard(res);
    throw new MediaError(413, MSG.tooBig);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > max) throw new MediaError(413, MSG.tooBig);
      chunks.push(chunk);
    }
  } catch (e) {
    try { await reader.cancel(); } catch { /* 忽略 */ }
    if (e instanceof MediaError) throw e;
    // 读到一半断了：AbortError 已在上面被 aborted 竞速成超时文案；其余当作连不上
    throw new MediaError(422, e && e.name === 'AbortError' ? MSG.timeout : MSG.unreachable);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

// 抓取外链图片：返回 { bytes: Uint8Array, type }，任何不合格都抛 MediaError（4xx）。
// 绝不把对方的响应体/响应头/最终 URL 回给调用方 —— 唯一透出的上游细节是数字状态码。
export async function fetchExternalImage(raw) {
  let u = publicHttpsUrl(String(raw || '').trim());
  if (!u) throw new MediaError(400, MSG.badUrl);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  const race = abortRace(ctl.signal);
  try {
    let res;
    for (let hop = 0; ; hop++) {
      try {
        res = await Promise.race([
          fetch(u.href, { redirect: 'manual', signal: ctl.signal, headers: FETCH_HEADERS }),
          race.p,
        ]);
      } catch (e) {
        if (e instanceof MediaError) throw e;
        throw new MediaError(422, ctl.signal.aborted ? MSG.timeout : MSG.unreachable);
      }
      if (!REDIRECTS.has(res.status)) break;
      // Workers 下 redirect:'manual' 会拿到真实的 3xx 和可读的 Location（浏览器里拿不到）
      await discard(res);
      if (hop >= MAX_REDIRECTS) throw new MediaError(422, MSG.tooManyRedirects);
      const loc = res.headers.get('location');
      const next = loc ? publicHttpsUrl(loc, u) : null; // 每一跳都按同一套规则重新校验
      if (!next) throw new MediaError(422, MSG.badRedirect);
      u = next;
    }

    if (!res.ok) {
      await discard(res);
      throw new MediaError(422, MSG.upstream(res.status));
    }
    // 与上传路由同一条规则：声明是 SVG 的直接拒（魔数判定本来也过不了，这里省得读完再拒）
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('svg')) {
      await discard(res);
      throw new MediaError(415, MSG.notImage);
    }

    const bytes = await readCapped(res, MAX_IMAGE, race.p);
    if (bytes.byteLength < MIN_IMAGE) throw new MediaError(422, MSG.tooSmall);
    const type = sniffImageType(bytes);
    if (!type) throw new MediaError(415, MSG.notImage);
    return { bytes, type };
  } finally {
    clearTimeout(timer);
    race.off();
  }
}
