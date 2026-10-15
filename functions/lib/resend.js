// 邮件传输层：console 模式打印到日志（本地/开发），resend 模式调用 Resend API。
// 尽力发送 —— 失败只记录，不抛出（不阻塞宾客操作）。

export function hostEmails(env) {
  return (env.HOST_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export async function sendEmail(env, { to, subject, html, text }) {
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length) return { ok: false, reason: 'no-recipient' };

  const mode = env.EMAIL_MODE || 'console';
  if (mode !== 'resend') {
    console.log(`[EMAIL:console] → ${toList.join(', ')}\n  Subject: ${subject}\n  ${(text || html || '').slice(0, 400)}`);
    return { ok: true, mode: 'console' };
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to: toList, subject, html, text }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[EMAIL:resend] failed ${r.status} ${t}`);
      return { ok: false, status: r.status };
    }
    return { ok: true, mode: 'resend' };
  } catch (e) {
    console.error('[EMAIL:resend] error', String(e));
    return { ok: false, error: String(e) };
  }
}
