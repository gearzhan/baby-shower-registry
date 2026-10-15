// 后台媒体上传/删除（主人守卫）：
//   POST   /api/admin/media           multipart: file + slot('bg'|'item') + itemId? → 存 R2，返回 key
//   DELETE /api/admin/media/:key      删除 R2 对象
import { json } from '../../../lib/kv.js';
import { requireHost } from '../../../lib/guard.js';
import { MAX_IMAGE, itemMediaKey } from '../../../lib/media.js'; // 与"外链图转存"共用上限和 key 格式

const MAX_VIDEO = 30 * 1024 * 1024; // 30MB（短循环视频）

export async function onRequest(context) {
  const { request, env, params } = context;
  const denied = await requireHost(request, env);
  if (denied) return denied;

  const seg = params.path || [];
  const m = request.method;

  if (m === 'POST' && seg.length === 0) return upload(request, env);
  if (m === 'DELETE' && seg.length === 1) {
    await env.BS_R2.delete(seg[0]);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}

async function upload(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'bad_request' }, 400);
  const file = form.get('file');
  const slot = form.get('slot') || 'item';
  const itemId = (form.get('itemId') || '').toString().replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  if (!file || typeof file === 'string') return json({ error: 'no_file' }, 400);

  // 归一化：小写并剥掉参数（如 "image/svg+xml; charset=utf-8"）与首尾空白后再比对
  const type = (file.type || 'application/octet-stream').toLowerCase().split(';')[0].trim();
  const isVideo = type.indexOf('video/') === 0;
  const isImage = type.indexOf('image/') === 0;
  if (!isVideo && !isImage) return json({ error: 'unsupported_type' }, 415);
  // SVG 里可以内嵌脚本，而 /api/media/* 是同源内联提供的 —— 拒收，避免成为存储型 XSS 载体。
  // 用 includes('svg') 兜住 image/svg+xml 及各种带参数/大小写的变体，别用精确匹配（可绕过）。
  if (type.includes('svg')) return json({ error: 'unsupported_type' }, 415);
  if (file.size > (isVideo ? MAX_VIDEO : MAX_IMAGE)) return json({ error: 'too_large' }, 413);

  // 随机 key（不是时间戳）：/api/media 不设登录门槛，key 只在已登录才能拿到的
  // /api/public、/api/registry 里出现 —— 猜不出 key 就打不开图，别让它可枚举。
  const rnd = crypto.randomUUID().slice(0, 12);
  const key = slot === 'bg' ? `bg-${rnd}` : itemMediaKey(itemId);
  const buf = await file.arrayBuffer();
  await env.BS_R2.put(key, buf, { httpMetadata: { contentType: type } });

  return json({ ok: true, key, contentType: type, isVideo });
}
