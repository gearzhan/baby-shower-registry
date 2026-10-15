// 前端 API 客户端：封装对 Pages Functions 的调用。
// 身份靠 HttpOnly 的会话 cookie，fetch 默认就是 credentials:'same-origin'，会自动带上 —— 不要加 'include'。

// jget 必须和 jsend 一样把 status 挂到错误上：全站的 401（会话过期）判断都依赖 e.status，
// 而 /api/public、/api/registry 都是 GET。少了它，401 和断网就分不出来了。
async function jget(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || url + ' → ' + r.status), { status: r.status, data: d });
  return d;
}

async function jsend(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || url + ' → ' + r.status), { status: r.status, data: d });
  return d;
}

// 给用户看的错误文案：只有 4xx 且带服务端 error 才可信。5xx / 断网可能是非 JSON 的
// Cloudflare 拦截页，此时 e.message 会是 "/api/x → 500" 这种调试串（留给 console，别塞给用户）——
// 一律回落到通用文案。
export function errText(e, fallback = 'Something went wrong — please try again.') {
  return e && e.status && e.status < 500 && e.data && e.data.error ? e.data.error : fallback;
}

export const api = {
  // 身份 / 登录
  getMe: () => jget('/api/me'),
  authStart: (body) => jsend('/api/auth/start', 'POST', body), // { email } | { inviteToken }
  authVerify: (body) => jsend('/api/auth/verify', 'POST', body), // { email|inviteToken, code }
  signOut: () => jsend('/api/auth/signout', 'POST'),

  // 需登录的读
  getPublic: () => jget('/api/public'),
  getRegistry: () => jget('/api/registry'),

  // 认领：身份来自 cookie，不再传姓名
  claim: (itemId) => jsend('/api/claim', 'POST', { itemId }),
  unclaim: (itemId) => jsend('/api/claim/' + itemId, 'DELETE'),

  // RSVP：身份来自 cookie，不再传令牌
  rsvpSubmit: (form) => jsend('/api/rsvp/submit', 'POST', form),

  // 后台（主人 = 邮箱在 HOST_EMAILS 里的宾客）
  admin: {
    getAll: () => jget('/api/admin/all'),
    putEvent: (event) => jsend('/api/admin/event', 'PUT', event),
    putDesign: (design) => jsend('/api/admin/design', 'PUT', design),
    putConfig: (config) => jsend('/api/admin/config', 'PUT', config),
    addGuest: (name, email) => jsend('/api/admin/guests', 'POST', { name, email }),
    removeGuest: (id) => jsend('/api/admin/guests/' + id, 'DELETE'),
    editGuest: (id, body) => jsend('/api/admin/guests/' + id, 'PATCH', body), // { name, email } 改名 / 改邮箱 → { guest, emailChanged }
    sendInvite: (id) => jsend('/api/admin/guests/' + id + '/send', 'POST'),
    sendAll: () => jsend('/api/admin/guests/send-all', 'POST'),
    remindAll: () => jsend('/api/admin/guests/remind-all', 'POST'), // RSVP 提醒群发：无请求体，收件人由服务端决定 → {count, failed, skipped}
    recordRsvp: (id, form) => jsend('/api/admin/guests/' + id + '/rsvp', 'PUT', form),
    saveItem: (item) => (item.id ? jsend('/api/admin/items/' + item.id, 'PUT', item) : jsend('/api/admin/items', 'POST', item)),
    removeItem: (id) => jsend('/api/admin/items/' + id, 'DELETE'),
    unclaimItem: (id) => jsend('/api/admin/items/' + id + '/unclaim', 'POST'),
    setThanks: (id, body) => jsend('/api/admin/items/' + id + '/thanks', 'PUT', body), // { received | thanked: bool, at: 屏幕上那条认领的 at } 收货/致谢进度；认领被换过 → 409
    rehostItemImg: (id) => jsend('/api/admin/items/' + id + '/rehost', 'POST'), // 外链图转存 R2（服务端读已存的 imgUrl，不传 URL）
    // 媒体上传（multipart）：slot='bg'|'item'
    uploadMedia: async (file, slot, itemId) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('slot', slot);
      if (itemId) fd.append('itemId', itemId);
      const r = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || r.status), { status: r.status, data: d });
      return d;
    },
    deleteMedia: (key) => jsend('/api/admin/media/' + key, 'DELETE'),
  },
};
