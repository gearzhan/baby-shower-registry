// functions/lib/media.js：外链图片转存的加固抓取（全局 fetch 用替身）。
// 只认公网 https、每一跳重新校验、最多 3 跳、10 秒总超时、8 MB 流式上限、1 KB 下限、只按魔数定类型（SVG / HTML 永远不收）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_IMAGE, MIN_IMAGE, MSG, MediaError, publicHttpsUrl, sniffImageType, fetchExternalImage, itemMediaKey } from '../../functions/lib/media.js';
import { shrinkTimers } from '../helpers/env.js';

// ---------- 测试数据 ----------
const enc = new TextEncoder();
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
// 文件头 + 非零填充到 size 字节
function pad(head, size) {
  const u = new Uint8Array(size);
  u.set(head.slice(0, size));
  for (let i = head.length; i < size; i++) u[i] = (i * 31) & 0xff;
  return u;
}
const HEAD = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii('JFIF'), 0],
  png: [0x89, ...ascii('PNG\r\n\x1a\n'), ...be32(13), ...ascii('IHDR')],
  gif87: ascii('GIF87a'),
  gif89: ascii('GIF89a'),
  webp: [...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')],
  avifMajor: [...be32(28), ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avifmif1miaf')],
  avifCompat: [...be32(32), ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1miafMA1Bavif')],
  avis: [...be32(24), ...ascii('ftypavis'), 0, 0, 0, 0, ...ascii('avismsf1')],
  heic: [...be32(24), ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')],
  avifPast64: [...be32(80), ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1'.repeat(13)), ...ascii('avif')], // 'avif' 落在偏移 68
  wave: [...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')],
  bmp: ascii('BM6\x00\x00\x00'),
};
const svgBytes = pad(enc.encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 2048);
const htmlBytes = pad(enc.encode('<!doctype html><html><head><title>Just a moment...</title></head><body>challenge</body></html>'), 4096);
const jpeg = (n = 4096) => pad(HEAD.jpeg, n);

// ---------- fetch 替身 ----------
let calls;
let route; // (url, init, 第几次调用) => Response | Promise<Response>
beforeEach(() => {
  calls = [];
  route = null;
  vi.stubGlobal('fetch', async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (!route) throw new Error('unexpected fetch ' + url);
    return route(String(url), init, calls.length - 1);
  });
});
const ok = (bytes, headers = {}) => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg', ...headers } });
const redirect = (location, status = 302) => new Response(null, { status, headers: location == null ? {} : { location } });
const realSetTimeout = globalThis.setTimeout;
const delay = (ms) => new Promise((r) => realSetTimeout(r, ms));
// 只在被中止时才 reject 的 fetch（像一台卡住的服务器）
const hangUntilAbort = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
// 10 秒总超时缩成 ms 毫秒（模块在调用时才读全局 setTimeout）
const fastTimeout = (ms) => shrinkTimers((d) => (d === 10000 ? ms : d));

async function rejects(p, status, msgPart) {
  const e = await p.then(
    () => null,
    (err) => err
  );
  expect(e, 'expected a rejection').toBeInstanceOf(MediaError);
  expect(e.status).toBe(status);
  if (msgPart) expect(e.message).toContain(msgPart);
  return e;
}

// =====================================================================
describe('publicHttpsUrl', () => {
  const REJECT = [
    'http://example.com/a.jpg', 'ftp://example.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
    'file:///etc/passwd', '', '   ', 'not a url', '//example.com/a.jpg', 'https://', 'wss://example.com/a',
    // IP 字面量（WHATWG 会把十进制 / 十六进制 / 简写统一规范成点分四段）
    'https://127.0.0.1/x.jpg', 'https://2130706433/x.jpg', 'https://0x7f.1/x.jpg', 'https://127.1/x.jpg', 'https://0/x',
    'https://0177.0.0.1/x', 'https://127.0.0.1./x', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.1/', 'https://192.168.1.1/x',
    'https://8.8.8.8/x.jpg', 'https://[::1]/x.jpg', 'https://[::ffff:127.0.0.1]/x', 'https://[fd00::1]/x',
    // localhost / 单段名 / 内网后缀
    'https://localhost/x', 'https://localhost:8788/api/health', 'https://LOCALHOST./x', 'https://a.localhost/x', 'https://foo/x.jpg', 'https://foo./x',
    'https://printer.local/x', 'https://svc.internal/x', 'https://nas.lan/x', 'https://box.home.arpa/x', 'https://x.localdomain/x', 'https://corp.intranet/x',
    // 端口 / 账号密码
    'https://example.com:8443/x.jpg', 'https://example.com:80/x.jpg', 'https://user:pw@example.com/x.jpg', 'https://user@example.com/x.jpg',
  ];
  const ACCEPT = [
    'https://cafe.de/x.jpg', 'https://deadbeef.com/a.png', 'https://example.com:443/x.jpg', 'https://EXAMPLE.com./x.jpg',
    'https://cdn.shopify.com/s/files/1/x.jpg?v=17&width=800', 'https://shop.example/_next/image?url=%2Fa.jpg&w=640&q=75',
    'https://img.example.co.uk/p/x.webp?tr=w-600', 'https://xn--bcher-kva.de/x.jpg', 'https://bücher.de/x.jpg',
  ];

  it('rejects non-https, IP literals, localhost, single-label names, local suffixes, ports and userinfo', () => {
    for (const u of REJECT) expect(publicHttpsUrl(u), u).toBeNull();
  });

  it('accepts public https hosts (hex-looking names, :443, trailing dot, IDN)', () => {
    for (const u of ACCEPT) expect(publicHttpsUrl(u), u).toBeInstanceOf(URL);
    expect(publicHttpsUrl('https://example.com:443/x').port).toBe('');
  });

  it('resolves relative Locations against the base and re-applies the rules', () => {
    const b = new URL('https://shop.example.com/p/1');
    expect(publicHttpsUrl('/img/a.jpg', b).href).toBe('https://shop.example.com/img/a.jpg');
    expect(publicHttpsUrl('b.jpg', b).href).toBe('https://shop.example.com/p/b.jpg');
    expect(publicHttpsUrl('//cdn.example.net/c.jpg', b).href).toBe('https://cdn.example.net/c.jpg');
    expect(publicHttpsUrl('http://shop.example.com/a.jpg', b)).toBeNull();
    expect(publicHttpsUrl('https://127.0.0.1/a.jpg', b)).toBeNull();
  });

  it('fetchExternalImage: every rejected URL → 400 and fetch is never called', async () => {
    route = () => ok(jpeg());
    for (const u of REJECT) await rejects(fetchExternalImage(u), 400, MSG.badUrl);
    expect(calls).toHaveLength(0);
  });
});

// =====================================================================
describe('request shape', () => {
  it('redirect:manual, an abort signal, a browser UA, Accept without AVIF, no cookie / referer / auth', async () => {
    route = () => ok(jpeg());
    expect((await fetchExternalImage('https://cdn.example.com/a.jpg')).type).toBe('image/jpeg');
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://cdn.example.com/a.jpg');
    expect(init.redirect).toBe('manual');
    expect(typeof init.signal.aborted).toBe('boolean');
    const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(h['user-agent']).toMatch(/^Mozilla\/5\.0 .*Chrome\/\d+/);
    expect(h.accept).toMatch(/image\/webp/);
    expect(h.accept).not.toMatch(/avif/i);
    for (const k of ['cookie', 'referer', 'authorization']) expect(h).not.toHaveProperty(k);
  });
});

// =====================================================================
describe('redirects', () => {
  it('follows a relative redirect, resolved against the current URL', async () => {
    route = (url, _i, n) => (n === 0 ? redirect('/img/real.jpg', 301) : ok(jpeg()));
    await fetchExternalImage('https://shop.example.com/p/1');
    expect(calls.map((c) => c.url)).toEqual(['https://shop.example.com/p/1', 'https://shop.example.com/img/real.jpg']);
    expect(calls.every((c) => c.init.redirect === 'manual')).toBe(true);
  });

  it.each([301, 302, 303, 307, 308])('%i counts as a redirect', async (st) => {
    route = (url, _i, n) => (n === 0 ? redirect('https://cdn.example.net/x.jpg', st) : ok(jpeg()));
    await fetchExternalImage('https://a.example.com/x');
    expect(calls).toHaveLength(2);
  });

  it.each([
    'http://cdn.example.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a.jpg', 'https://localhost/a.jpg', 'https://nas.lan/a.jpg',
    'https://example.com:8443/a.jpg', 'https://u:p@example.com/a', 'https://2130706433/x', 'ftp://example.com/x',
  ])('a redirect to %s → 422, not followed', async (bad) => {
    route = () => redirect(bad, 307);
    await rejects(fetchExternalImage('https://shop.example.com/a.jpg'), 422, MSG.badRedirect);
    expect(calls).toHaveLength(1);
  });

  it('an allowed hop then a disallowed hop → 422 after exactly 2 fetches', async () => {
    route = (url, _i, n) => (n === 0 ? redirect('https://cdn.example.com/b') : redirect('https://10.0.0.5/c.jpg'));
    await rejects(fetchExternalImage('https://shop.example.com/a'), 422, MSG.badRedirect);
    expect(calls).toHaveLength(2);
  });

  it('a 3xx without Location → 422', async () => {
    route = () => redirect(null);
    await rejects(fetchExternalImage('https://shop.example.com/a'), 422, MSG.badRedirect);
  });

  it('exactly 3 redirects are followed (4 fetches)', async () => {
    route = (url, _i, n) => (n < 3 ? redirect(`https://hop${n + 1}.example.com/x`) : ok(jpeg()));
    expect((await fetchExternalImage('https://hop0.example.com/x')).type).toBe('image/jpeg');
    expect(calls).toHaveLength(4);
  });

  it('a 4th redirect → 422 too many (never a 5th fetch), loops included', async () => {
    route = (url, _i, n) => redirect(`https://hop${n + 1}.example.com/x`);
    await rejects(fetchExternalImage('https://hop0.example.com/x'), 422, MSG.tooManyRedirects);
    expect(calls).toHaveLength(4);
    calls.length = 0;
    route = (url) => redirect(url);
    await rejects(fetchExternalImage('https://loop.example.com/x'), 422, MSG.tooManyRedirects);
    expect(calls).toHaveLength(4);
  });

  it('redirect bodies are cancelled', async () => {
    let cancelled = 0;
    route = (url, _i, n) => {
      if (n > 0) return ok(jpeg());
      const body = new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(10)), cancel: () => void cancelled++ });
      return new Response(body, { status: 302, headers: { location: 'https://cdn.example.com/x.jpg' } });
    };
    await fetchExternalImage('https://shop.example.com/a');
    expect(cancelled).toBe(1);
  });
});

// =====================================================================
describe('upstream errors', () => {
  it.each([403, 404, 410, 500, 503])('a %i upstream → 422 naming only the status number', async (st) => {
    route = () => new Response('<html>secret upstream body</html>', { status: st, headers: { 'content-type': 'text/html', 'x-secret': 'y' } });
    const e = await rejects(fetchExternalImage('https://shop.example.com/a.jpg'), 422);
    expect(e.message).toBe(MSG.upstream(st));
    expect(e.message).not.toContain('secret');
  });

  it('a network error → 422 unreachable', async () => {
    route = () => {
      throw new TypeError('fetch failed');
    };
    await rejects(fetchExternalImage('https://down.example.com/a.jpg'), 422, MSG.unreachable);
  });
});

// =====================================================================
describe('timeout (10 s over the whole chain, shrunk for the test)', () => {
  it('the server never answers (fetch honours the signal) → 422 timeout', async () => {
    fastTimeout(80);
    route = (url, init) => hangUntilAbort(init);
    const t0 = Date.now();
    await rejects(fetchExternalImage('https://slow.example.com/a.jpg'), 422, MSG.timeout);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('fetch ignores the signal entirely → still 422 timeout (race)', async () => {
    fastTimeout(80);
    route = () => new Promise(() => {});
    await rejects(fetchExternalImage('https://slow.example.com/a.jpg'), 422, MSG.timeout);
  });

  it('the body stalls after the first chunk → 422 timeout and the body is cancelled', async () => {
    fastTimeout(80);
    let cancelled = false;
    let pulls = 0;
    route = () =>
      new Response(
        new ReadableStream({
          pull(c) {
            if (++pulls === 1) return c.enqueue(jpeg(2048));
            return new Promise(() => {});
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { 'content-type': 'image/jpeg' } }
      );
    await rejects(fetchExternalImage('https://slow.example.com/a.jpg'), 422, MSG.timeout);
    expect(cancelled).toBe(true);
  });

  it('the budget spans the redirect chain, not each hop', async () => {
    fastTimeout(150);
    // 每跳 60 ms：3 跳共 180 ms > 150 ms，虽然每一跳单独都很快
    route = async (url, init, n) => {
      await delay(60);
      if (init.signal.aborted) throw Object.assign(new Error('a'), { name: 'AbortError' });
      return n < 3 ? redirect(`https://h${n + 1}.example.com/`) : ok(jpeg());
    };
    await rejects(fetchExternalImage('https://h0.example.com/'), 422, MSG.timeout);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it('a fast success leaves no timer behind', async () => {
    fastTimeout(50);
    let sig;
    route = (url, init) => {
      sig = init.signal;
      return ok(jpeg());
    };
    await fetchExternalImage('https://fast.example.com/a.jpg');
    await delay(120);
    expect(sig.aborted).toBe(false);
  });
});

// =====================================================================
describe('8 MB cap, enforced while streaming', () => {
  const MB = () => {
    const u = new Uint8Array(1024 * 1024);
    u.set(HEAD.jpeg);
    return u;
  };

  it('Content-Length over 8 MB → 413 before reading the body', async () => {
    let pulls = 0;
    let cancelled = false;
    route = () =>
      new Response(new ReadableStream({ pull: (c) => void (pulls++, c.enqueue(new Uint8Array(1024))), cancel: () => void (cancelled = true) }, { highWaterMark: 0 }), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_IMAGE + 1) },
      });
    await rejects(fetchExternalImage('https://big.example.com/a.jpg'), 413, '8 MB');
    expect(pulls).toBe(0);
    expect(cancelled).toBe(true);
  });

  it('an endless body without Content-Length → 413 after ~8 MB and the stream is cancelled', async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = MB();
    // "无穷"在 32 MB 处截断：上限失效时断言失败，而不是吃光内存
    route = () =>
      new Response(new ReadableStream({ pull: (c) => (++pulls > 32 ? c.close() : c.enqueue(chunk)), cancel: () => void (cancelled = true) }, { highWaterMark: 0 }), { status: 200 });
    await rejects(fetchExternalImage('https://big.example.com/a.jpg'), 413, '8 MB');
    expect(pulls).toBeLessThanOrEqual(10);
    expect(cancelled).toBe(true);
  });

  it('a lying (small) Content-Length with a 9 MB body → 413', async () => {
    const chunk = MB();
    let n = 0;
    route = () => new Response(new ReadableStream({ pull: (c) => (n++ < 9 ? c.enqueue(chunk) : c.close()) }), { status: 200, headers: { 'content-length': '2000' } });
    await rejects(fetchExternalImage('https://liar.example.com/a.jpg'), 413);
  });

  it('exactly 8 MB is accepted; 8 MB + 1 byte is not', async () => {
    route = () => ok(jpeg(MAX_IMAGE));
    expect((await fetchExternalImage('https://edge.example.com/a.jpg')).bytes.byteLength).toBe(MAX_IMAGE);
    route = () => ok(jpeg(MAX_IMAGE + 1));
    await rejects(fetchExternalImage('https://edge.example.com/a.jpg'), 413);
  });

  it('a chunked body is reassembled byte for byte', async () => {
    const src = jpeg(300000);
    route = () => {
      let off = 0;
      return new Response(
        new ReadableStream({
          pull(c) {
            if (off >= src.length) return c.close();
            const end = Math.min(off + 7777, src.length);
            c.enqueue(src.slice(off, end));
            off = end;
          },
        }),
        { status: 200 }
      );
    };
    const r = await fetchExternalImage('https://chunks.example.com/a.jpg');
    expect(Buffer.from(r.bytes).equals(Buffer.from(src))).toBe(true);
  });
});

// =====================================================================
describe('magic-byte typing + 1 KB floor', () => {
  const GOOD = [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['gif87', 'image/gif'], ['gif89', 'image/gif'], ['webp', 'image/webp'], ['avifMajor', 'image/avif'], ['avifCompat', 'image/avif'], ['avis', 'image/avif']];

  it('sniffImageType recognises jpeg / png / gif / webp / avif', () => {
    for (const [k, type] of GOOD) expect(sniffImageType(pad(HEAD[k], 64)), k).toBe(type);
  });

  it('sniffImageType: svg / html / heic / wav / bmp / avif past 64 bytes / short / empty → null', () => {
    for (const k of ['heic', 'wave', 'bmp', 'avifPast64']) expect(sniffImageType(pad(HEAD[k], 128)), k).toBeNull();
    expect(sniffImageType(svgBytes)).toBeNull();
    expect(sniffImageType(htmlBytes)).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffImageType(null)).toBeNull();
  });

  it.each(GOOD)('accepts %s as %s, ignoring a wrong Content-Type', async (k, type) => {
    route = () => ok(pad(HEAD[k], 5000), { 'content-type': 'text/html; charset=utf-8' });
    expect((await fetchExternalImage('https://cdn.example.com/x')).type).toBe(type);
  });

  it('SVG bytes (even labelled image/png) → 415', async () => {
    route = () => ok(svgBytes, { 'content-type': 'image/png' });
    await rejects(fetchExternalImage('https://cdn.example.com/x.png'), 415, MSG.notImage);
  });

  it.each(['image/svg+xml', 'IMAGE/SVG+XML; charset=utf-8', 'image/svg'])('an SVG Content-Type (%s) → 415 before reading', async (ct) => {
    let pulls = 0;
    route = () => new Response(new ReadableStream({ pull: (c) => void (pulls++, c.enqueue(jpeg()), c.close()) }, { highWaterMark: 0 }), { status: 200, headers: { 'content-type': ct } });
    await rejects(fetchExternalImage('https://cdn.example.com/x'), 415, MSG.notImage);
    expect(pulls).toBe(0);
  });

  it('an HTML bot-challenge page served as 200 image/jpeg → 415', async () => {
    route = () => ok(htmlBytes, { 'content-type': 'image/jpeg' });
    await rejects(fetchExternalImage('https://cdn.example.com/x.jpg'), 415, 'may be blocking downloads');
  });

  it('HEIC → 415', async () => {
    route = () => ok(pad(HEAD.heic, 5000));
    await rejects(fetchExternalImage('https://cdn.example.com/x.heic'), 415);
  });

  it('1 KB floor: 1023 bytes → 422, a 1×1 tracking GIF → 422, an empty body → 422, 1024 bytes → ok', async () => {
    expect(MIN_IMAGE).toBe(1024);
    route = () => ok(jpeg(1023));
    await rejects(fetchExternalImage('https://cdn.example.com/x.jpg'), 422, MSG.tooSmall);
    route = () => ok(pad(HEAD.gif89, 43));
    await rejects(fetchExternalImage('https://cdn.example.com/p.gif'), 422, MSG.tooSmall);
    route = () => new Response(null, { status: 200 });
    await rejects(fetchExternalImage('https://cdn.example.com/x.jpg'), 422, MSG.tooSmall);
    route = () => ok(jpeg(1024));
    expect((await fetchExternalImage('https://cdn.example.com/x.jpg')).bytes.byteLength).toBe(1024);
  });
});

// =====================================================================
describe('itemMediaKey / MediaError', () => {
  it('item-<id ≤ 24 alnum>-<12 random UUID chars>, never the same twice', () => {
    expect(itemMediaKey('c1abc')).toMatch(/^item-c1abc-[0-9a-f-]{12}$/);
    expect(itemMediaKey('c../x!?<script>')).toMatch(/^item-cxscript-/);
    expect(itemMediaKey('')).toMatch(/^item-x-/);
    expect(itemMediaKey(undefined)).toMatch(/^item-x-/);
    expect(itemMediaKey('a'.repeat(40))).toMatch(new RegExp('^item-' + 'a'.repeat(24) + '-[0-9a-f-]{12}$'));
    expect(itemMediaKey('c1')).not.toBe(itemMediaKey('c1'));
  });

  it('MediaError carries a status', () => {
    const e = new MediaError(413, 'x');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(413);
    expect(e.message).toBe('x');
  });
});
