// 退出登录：清掉会话 cookie。无需校验当前会话 —— 清一个本就无效的 cookie 没有害处。
import { json } from '../../lib/kv.js';
import { clearCookie } from '../../lib/session.js';

export function onRequestPost({ request }) {
  return json({ ok: true }, 200, { 'set-cookie': clearCookie(request) });
}
