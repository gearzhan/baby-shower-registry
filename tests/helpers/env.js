// 测试共用的运行时替身：内存 KV / 内存 R2 / env 工厂 / 会话 cookie / 调用 Pages Function 处理器 / 抓邮件 / 缩短计时器。
// 全部是纯 Node：不起 wrangler、不连网。处理器拿到的 context 与 Pages Functions 一致：{ request, env, params, waitUntil }。
import { vi } from 'vitest';
import { sessionCookie } from '../../functions/lib/session.js';
import { getGuests } from '../../functions/lib/kv.js';

export const HOST_EMAIL = 'host@example.com';
// getGuests() 由 HOST_EMAILS 现造主人行时导出的 id（'host-' + 邮箱里的字母数字，前 20 个）
export const HOST_ID = 'host-hostexamplecom';
export const BASE = 'http://localhost:8788';

// 线上 KV 撞"同键每秒一次"写限时抛出的错误文案（路由里的 kvBusy 正则认的就是 429 / too many）
export const KV_429 = 'KV PUT failed: 429 Too Many Requests';

// 内存 KV：get / put / delete / list({ prefix })，值一律存字符串（与真 KV 一致，读出来要自己 JSON.parse）。
// 测试钩子：
//   kv.data                 底层 Map（键 → 原始字符串）
//   kv.json(key) / kv.set(key, v)   直接读写（对象自动 JSON 化），不计入调用记录
//   kv.reads / kv.writes / kv.deletes   每次调用的键（断言"没碰过某个键"用；writes 也记失败的 put）
//   kv.failPut(match, times)  让匹配的 put 抛出线上同款 429 错误；match 是键名或 (key) => bool，times 省略则一直失败
export function memKV(init = {}) {
  const data = new Map();
  const enc = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  for (const [k, v] of Object.entries(init || {})) data.set(k, enc(v));
  const failures = [];
  const kv = {
    data,
    reads: [],
    writes: [],
    deletes: [],
    ttl: new Map(),
    async get(key, opt) {
      kv.reads.push(key);
      const v = data.has(key) ? data.get(key) : null;
      const type = typeof opt === 'string' ? opt : opt && opt.type;
      return v != null && type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts = {}) {
      kv.writes.push(key);
      const f = failures.find((x) => x.times > 0 && (typeof x.match === 'function' ? x.match(key) : x.match === key));
      if (f) {
        f.times--;
        throw new Error(KV_429);
      }
      data.set(key, String(value));
      if (opts && opts.expirationTtl) kv.ttl.set(key, opts.expirationTtl);
    },
    async delete(key) {
      kv.deletes.push(key);
      data.delete(key);
    },
    async list({ prefix = '' } = {}) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
    json(key) {
      const v = data.get(key);
      return v == null ? undefined : JSON.parse(v);
    },
    set(key, v) {
      data.set(key, enc(v));
    },
    failPut(match, times = Infinity) {
      failures.push({ match, times });
    },
  };
  return kv;
}

// 任意 body（Uint8Array / ArrayBuffer / Blob / ReadableStream / 字符串）→ Uint8Array 副本
async function toBytes(v) {
  if (v == null) return new Uint8Array(0);
  if (typeof v === 'string') return new TextEncoder().encode(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v.slice(0));
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  return new Uint8Array(await new Response(v).arrayBuffer());
}

// 内存 R2：put / get(key, { range }) / head / delete，对象形状够 /api/media 与上传、转存路由用。
// r2.data：键 → { bytes, httpMetadata }
export function memR2() {
  const data = new Map();
  const meta = (key, o) => ({
    key,
    size: o.bytes.byteLength,
    httpEtag: '"' + key + '"',
    httpMetadata: o.httpMetadata,
    writeHttpMetadata(h) {
      if (o.httpMetadata && o.httpMetadata.contentType) h.set('content-type', o.httpMetadata.contentType);
    },
  });
  return {
    data,
    async put(key, value, opts = {}) {
      const bytes = await toBytes(value);
      data.set(key, { bytes, httpMetadata: (opts && opts.httpMetadata) || {} });
      return { key, size: bytes.byteLength };
    },
    async head(key) {
      const o = data.get(key);
      return o ? meta(key, o) : null;
    },
    async get(key, opts = {}) {
      const o = data.get(key);
      if (!o) return null;
      let slice = o.bytes;
      let range;
      if (opts && opts.range) {
        const r = opts.range;
        if (r.suffix != null) range = { offset: Math.max(0, o.bytes.byteLength - r.suffix), length: Math.min(r.suffix, o.bytes.byteLength) };
        else range = { offset: r.offset || 0, length: r.length != null ? r.length : o.bytes.byteLength - (r.offset || 0) };
        slice = o.bytes.slice(range.offset, range.offset + range.length);
      }
      return { ...meta(key, o), range, body: new Response(slice).body };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

// env 工厂：与 .dev.vars 同样的本地值。overrides.kv 是 KV 的初始内容（对象值自动 JSON 化），其余键直接覆盖 env
export function makeEnv(overrides = {}) {
  const { kv, ...rest } = overrides;
  return {
    TOKEN_SECRET: 'test-secret',
    HOST_EMAILS: HOST_EMAIL,
    EMAIL_MODE: 'console',
    PUBLIC_BASE_URL: BASE,
    BS_KV: memKV(kv),
    BS_R2: memR2(),
    ...rest,
  };
}

// 给某位宾客签一枚会话 cookie：走 session.js 的真实签发路径（sv 取 guest.sv），返回可直接放进 cookie 头的 'bs_session=…'
export async function cookieFor(env, guest) {
  const set = await sessionCookie(new Request(BASE + '/'), env, guest);
  return set.split(';')[0];
}

// 主人的会话 cookie：主人行从 getGuests() 取（KV 里没有也会被现造出来，与线上一致）
export async function hostCookie(env, email = HOST_EMAIL) {
  const g = (await getGuests(env)).find((x) => (x.email || '').toLowerCase() === email.toLowerCase());
  if (!g) throw new Error('not on the roster: ' + email);
  return cookieFor(env, g);
}

// 调用一个 Pages Function 处理器，返回 { status, body(已解析的 JSON | undefined), text, headers }。
// body 是对象时按 JSON 发送；字符串 / FormData 原样发送。waitUntil 收集的任务在返回前全部等完。
export async function call(handler, env, { method = 'GET', path = '/', body, cookie, params = {}, headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof FormData) payload = body;
    else {
      payload = JSON.stringify(body);
      h.set('content-type', 'application/json');
    }
  }
  const request = new Request(BASE + path, { method, headers: h, body: payload });
  const waits = [];
  const res = await handler({ request, env, params, waitUntil: (p) => waits.push(p), data: {} });
  await Promise.allSettled(waits);
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

// [[path]] 捕获全部路由的调用器：catchAll(handler, '/api/admin/guests')(env, 'POST', '/u1/send', { cookie })
// 自动把 base 之后的路径拆成 params.path 段（Pages 的捕获全部参数就是这个形状）
export function catchAll(handler, base) {
  return (env, method, rest = '', opts = {}) =>
    call(handler, env, { ...opts, method, path: base + rest, params: { path: rest.split('/').filter(Boolean) } });
}

// 抓 console 模式发出的邮件（同时吞掉打印）：返回数组，每项 { to: [收件人…], subject }
export function captureEmails() {
  const sent = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    const m = /^\[EMAIL:console\] → (.*)\n\s+Subject: (.*)/.exec(args.map(String).join(' '));
    if (m) sent.push({ to: m[1].split(', '), subject: m[2] });
  });
  return sent;
}

// 缩短 setTimeout 的延迟（群发批间 1 秒、KV 429 后 1.1 秒重试、抓图 10 秒总超时……），逻辑不变、用例跑得快。
// map(原延迟) → 实际延迟；用例结束由 unstubGlobals 自动还原
export function shrinkTimers(map = (ms) => Math.min(ms || 0, 5)) {
  const real = globalThis.setTimeout;
  vi.stubGlobal('setTimeout', (cb, ms, ...a) => real(cb, map(ms), ...a));
}

// 一小时的毫秒数，免得到处写 60 * 60 * 1000
export const HOUR = 60 * 60 * 1000;
