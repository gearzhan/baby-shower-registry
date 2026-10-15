// 公开媒体服务：从 R2 读取并返回，支持 Range（Safari 播放视频必需），带缓存头。

// 416：Range 无法满足时按 RFC 9110 回传总长度
function unsatisfiable(total) {
  return new Response('Range not satisfiable', {
    status: 416,
    headers: { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes' },
  });
}

export async function onRequestGet({ params, env, request }) {
  const key = params.key;
  const rangeHeader = request.headers.get('range');

  const opts = {};
  if (rangeHeader) {
    // 先取对象大小，把区间校验在本地做掉 —— 直接把非法区间丢给 R2.get 会抛异常（500）
    const meta = await env.BS_R2.head(key);
    if (!meta) return new Response('Not found', { status: 404 });
    const total = meta.size;
    // 空对象（0 字节）没有任何字节可返回，任何 Range 都不可满足
    if (total === 0) return unsatisfiable(total);

    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m || (!m[1] && !m[2])) return unsatisfiable(total);
    const start = m[1] ? parseInt(m[1], 10) : undefined;
    const end = m[2] ? parseInt(m[2], 10) : undefined;

    if (start === undefined) {
      // bytes=-N：末尾 N 字节（N 为 0 时无字节可取）
      if (!end) return unsatisfiable(total);
      opts.range = { suffix: Math.min(end, total) };
    } else {
      // 起点越界、或区间倒置（end < start）都无法满足
      if (start >= total) return unsatisfiable(total);
      if (end !== undefined && end < start) return unsatisfiable(total);
      const last = end === undefined ? total - 1 : Math.min(end, total - 1);
      opts.range = { offset: start, length: last - start + 1 };
    }
  }

  const obj = await env.BS_R2.get(key, opts);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('accept-ranges', 'bytes');
  headers.set('x-content-type-options', 'nosniff'); // 禁止浏览器嗅探类型（上传侧已拒收 SVG）

  // 命中 Range → 206 Partial Content
  if (rangeHeader && obj.range) {
    const total = obj.size;
    const start = obj.range.offset || 0;
    const length = obj.range.length != null ? obj.range.length : total - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${total}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}
