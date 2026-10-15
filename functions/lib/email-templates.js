// 邮件模板：验证码、邀请函、RSVP 提醒、主人通知（RSVP / 认领）。返回 { subject, html, text }。
// 邮件客户端不跑 JS、CSS 动画支持差，故信封开合动画只存在于网站；邮件用干净静态 HTML + 按钮。
// 本模块也被前端打包（后台 EmailContentPreview 直接渲染真实模板）：必须保持纯函数 ——
// 不读 env、不引入 resend.js / kv.js 等服务端模块，只有静态文案 + 参数。

const BRAND = { bg: '#FBF8F2', card: '#FFFFFF', text: '#3D4A5C', soft: '#8A94A6', blue: '#5B84AE', border: '#EAE3D4' };

// 统一外层版式
function layout(inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:18px;overflow:hidden">
        <tr><td style="padding:30px 34px">${inner}</td></tr>
      </table>
      <div style="color:${BRAND.soft};font-size:12px;margin-top:16px">Baby Shower · with love</div>
    </td></tr>
  </table></body></html>`;
}
// 带顶部背景带的版式（邀请函用）：背景带满出卡片边缘，正文另起一格
function bannerLayout(banner, inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:18px;overflow:hidden">
        <tr><td style="padding:0">${banner}</td></tr>
        <tr><td style="padding:26px 34px 30px">${inner}</td></tr>
      </table>
      <div style="color:${BRAND.soft};font-size:12px;margin-top:16px">Baby Shower · with love</div>
    </td></tr>
  </table></body></html>`;
}
// 顶部背景带（邀请函 / 提醒共用）：eyebrow/title 为代码内静态文案（原样输出，不转义），event 值一律转义。
// 邮件客户端不跑 CSS 动画，但渐变背景 + 圆形火漆印是稳的
function banner(event, eyebrow, title) {
  return `
    <div style="background:linear-gradient(180deg,#DCE9F5,#EDF3F9);padding:26px 20px;text-align:center">
      <div style="width:54px;height:54px;line-height:54px;border-radius:50%;background:#A9C7E4;color:#FFFFFF;font-size:24px;margin:0 auto 12px">${escapeHtml(babyInitial(event.baby))}</div>
      <div style="font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#5B84AE;font-weight:700">${eyebrow}</div>
      <div style="font-size:30px;font-weight:700;margin:8px 0 2px;color:${BRAND.text}">${title}</div>
      <div style="color:#6C7889;font-size:15px">honouring ${escapeHtml(event.hosts)} · awaiting ${escapeHtml(event.baby)}</div>
    </div>`;
}
function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:${BRAND.blue};color:#FFFFFF;text-decoration:none;border-radius:999px;padding:13px 28px;font-weight:700;font-size:15px">${label}</a>`;
}

// 1) 验证码（整站登录用，不只是 RSVP）
export function verificationEmail(code, event) {
  const subject = `Your sign-in code for the Baby Shower — ${code}`;
  const html = layout(`
    <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.blue};font-weight:700">Sign-in code</div>
    <div style="font-size:22px;font-weight:700;margin:8px 0 6px">Here is your code</div>
    <p style="color:${BRAND.soft};font-size:14px;line-height:1.6;margin:0 0 18px">Enter this 6-digit code to open your invitation to ${escapeHtml(event.hosts)}'s baby shower.</p>
    <div style="font-size:34px;font-weight:800;letter-spacing:.4em;color:${BRAND.text};background:#F5F9FC;border:1px dashed #CBDDEE;border-radius:14px;padding:16px 8px;text-align:center">${code}</div>
    <p style="color:${BRAND.soft};font-size:12px;margin:16px 0 0">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`);
  const text = `Your Baby Shower sign-in code is ${code}. It expires in 10 minutes.`;
  return { subject, html, text };
}

// 2) 邀请函（信封动画只在网站上；邮件用静态 HTML：柔和背景带 + 称呼 + 打开邀请按钮）
export function invitationEmail(event, url, guest) {
  const subject = `You're invited — A Baby Shower for ${event.baby}`;
  const hi = guest && guest.name ? `<div style="font-size:15px;margin-bottom:14px">Dear ${escapeHtml(guest.name)},</div>` : '';
  // 主人的私人附言：为空则整段不渲染（邮件与从前一致）；换行转 <br> 保留段落
  const msg = event.emailMessage
    ? `<p style="font-size:15px;line-height:1.65;margin:0 0 18px">${escapeHtml(event.emailMessage).replace(/\n/g, '<br>')}</p>`
    : '';
  const html = bannerLayout(banner(event, "You're invited", 'A Baby Shower'), `
    <div style="text-align:center">
      ${hi}
      ${msg}
      <div style="font-size:15px;margin:0 0 4px"><b>${escapeHtml(event.dateLabel)}</b> · ${escapeHtml(event.timeLabel)}</div>
      <div style="color:${BRAND.soft};font-size:14px;margin-bottom:22px">${escapeHtml(event.venueName)}</div>
      ${button(url, 'Open Invitation')}
      <div style="color:${BRAND.soft};font-size:12px;margin-top:18px">Open it to RSVP and pick a gift · Kindly reply by ${escapeHtml(event.rsvpBy)}</div>
    </div>`);
  const text = `You're invited to a Baby Shower for ${event.baby}!\n${event.emailMessage ? `${event.emailMessage}\n` : ''}${event.dateLabel} · ${event.timeLabel} · ${event.venueName}\nOpen your invitation: ${url}\nKindly RSVP by ${event.rsvpBy}.`;
  return { subject, html, text };
}

// 6) RSVP 提醒：发给已邀请但还没回复的宾客（收件人由 admin/guests 的 remind-all 决定）。
// 链接与邀请函同一种 ?i= 邀请令牌（不是登录）。故意不带主人的私人附言 emailMessage —— 那是为邀请函写的。
// 回复截止日为空（主人清掉了）就整句不提。
export function reminderEmail(event, url, guest) {
  const subject = `A gentle reminder to RSVP — A Baby Shower for ${event.baby}`;
  const hi = guest && guest.name ? `<div style="font-size:15px;margin-bottom:14px">Dear ${escapeHtml(guest.name)},</div>` : '';
  const by = String(event.rsvpBy || '').trim();
  const foot = (by ? 'Kindly reply by ' + escapeHtml(by) + ' · ' : '') + 'Already replied? Thank you — please ignore this note.';
  const html = bannerLayout(banner(event, 'A gentle reminder', 'Will you join us?'), `
    <div style="text-align:center">
      ${hi}
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px">We’d love to know if you can make it — it only takes a moment to reply.</p>
      <div style="font-size:15px;margin:0 0 4px"><b>${escapeHtml(event.dateLabel)}</b> · ${escapeHtml(event.timeLabel)}</div>
      <div style="color:${BRAND.soft};font-size:14px;margin-bottom:22px">${escapeHtml(event.venueName)}</div>
      ${button(url, 'RSVP now')}
      <div style="color:${BRAND.soft};font-size:12px;margin-top:18px">${foot}</div>
    </div>`);
  const text = `Just a gentle reminder — we'd love to know if you can make it to the Baby Shower for ${event.baby}.\n${event.dateLabel} · ${event.timeLabel} · ${event.venueName}\nRSVP here: ${url}${by ? `\nKindly reply by ${by}.` : ''}`;
  return { subject, html, text };
}

// 宝宝名首字母（与前端 babyInitialOf 同规则）
function babyInitial(baby) {
  const w = String(baby || '').trim().split(/\s+/);
  const last = w[w.length - 1] || 'B';
  return (last[0] || 'B').toUpperCase();
}

// 3) 主人通知：新的/更新的 RSVP
export function hostRsvpNotice(guest, rsvp, event) {
  const attending = rsvp.attending === 'yes';
  const head = attending
    ? `${guest.name} is coming 🎉`
    : `${guest.name} can't make it`;
  const details = attending
    ? `${rsvp.adults} adult${rsvp.adults === 1 ? '' : 's'}${rsvp.kids ? `, ${rsvp.kids} child${rsvp.kids === 1 ? '' : 'ren'}` : ''}`
    : 'Sends love, can’t attend';
  const diet = [rsvp.dietary && `Dietary: ${rsvp.dietary}`, rsvp.allergies && `Allergies: ${rsvp.allergies}`].filter(Boolean).join(' · ');
  const subject = `RSVP: ${head}`;
  const html = layout(`
    <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.blue};font-weight:700">New RSVP</div>
    <div style="font-size:22px;font-weight:700;margin:8px 0 10px">${escapeHtml(head)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.9">
      <tr><td style="color:${BRAND.soft};padding-right:14px">Guest</td><td><b>${escapeHtml(guest.name)}</b> (${escapeHtml(guest.email)})</td></tr>
      <tr><td style="color:${BRAND.soft};padding-right:14px">Party</td><td>${escapeHtml(details)}</td></tr>
      ${diet ? `<tr><td style="color:${BRAND.soft};padding-right:14px">Notes</td><td>${escapeHtml(diet)}</td></tr>` : ''}
    </table>`);
  const text = `RSVP — ${head}\nGuest: ${guest.name} (${guest.email})\nParty: ${details}${diet ? `\n${diet}` : ''}`;
  return { subject, html, text };
}

// 4) 主人通知：礼物被认领
export function hostClaimNotice(item, name) {
  const subject = `Gift claimed: ${item.name}`;
  const html = layout(`
    <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.blue};font-weight:700">Registry</div>
    <div style="font-size:22px;font-weight:700;margin:8px 0 10px">A gift was claimed 🎁</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.9">
      <tr><td style="color:${BRAND.soft};padding-right:14px">Gift</td><td><b>${escapeHtml(item.name)}</b></td></tr>
      <tr><td style="color:${BRAND.soft};padding-right:14px">Store</td><td>${escapeHtml(item.store || '')}</td></tr>
      <tr><td style="color:${BRAND.soft};padding-right:14px">By</td><td>${escapeHtml(name)}</td></tr>
    </table>`);
  const text = `Gift claimed: ${item.name}${item.store ? ` (${item.store})` : ''} by ${name}.`;
  return { subject, html, text };
}

// 5) 主人通知：认领被撤销（改主意了）—— 没有这封，收件箱会永远停在"某某认领了它"
export function hostUnclaimNotice(item, name) {
  const subject = `Gift available again: ${item.name}`;
  const html = layout(`
    <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.blue};font-weight:700">Registry</div>
    <div style="font-size:22px;font-weight:700;margin:8px 0 10px">A gift is open again</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.9">
      <tr><td style="color:${BRAND.soft};padding-right:14px">Gift</td><td><b>${escapeHtml(item.name)}</b></td></tr>
      <tr><td style="color:${BRAND.soft};padding-right:14px">Store</td><td>${escapeHtml(item.store || '')}</td></tr>
      <tr><td style="color:${BRAND.soft};padding-right:14px">Was</td><td>${escapeHtml(name)} — changed their mind</td></tr>
    </table>`);
  const text = `Gift available again: ${item.name}${item.store ? ` (${item.store})` : ''} — ${name} undid their claim.`;
  return { subject, html, text };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
