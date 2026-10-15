// 后台：保存邀请函设计（主题 + 背景参数）。Access 守卫。
import { writeJSON, K, json } from '../../lib/kv.js';
import { requireHost } from '../../lib/guard.js';

export async function onRequestPut({ request, env }) {
  const denied = await requireHost(request, env);
  if (denied) return denied;
  const design = await request.json().catch(() => null);
  if (!design || typeof design !== 'object') return json({ error: 'bad_request' }, 400);
  await writeJSON(env, K.design, design);
  return json({ ok: true, design });
}
