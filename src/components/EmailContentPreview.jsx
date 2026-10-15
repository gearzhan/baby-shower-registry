import { useStore } from '../store.jsx';
import { invitationEmail } from '../../functions/lib/email-templates.js';

// 邀请邮件的忠实预览：直接调用后端发信用的同一份 invitationEmail() 模板，
// 主题行与正文都来自同一次调用 —— 预览与真实邮件零漂移（这正是旧手写 mock 的病根）。
// 模板是纯函数（模板字符串 + escapeHtml，无 Cloudflare/env 依赖），Vite 按需打包安全。
export default function EmailContentPreview() {
  const { event, me } = useStore();

  // 预览署名给当前登录的主人自己看（真实发送时每位宾客收到的是自己的名字）；
  // CTA 链接用 '#' 占位，iframe sandbox 会拦掉点击导航
  const { subject, html } = invitationEmail(event, '#', { name: me?.name || 'Guest' });

  return (
    <div style={{ border: '1px solid #E2DCCE', borderRadius: '14px', overflow: 'hidden', background: '#FFFFFF', boxShadow: '0 10px 26px rgba(61,74,92,.10)' }}>
      {/* 邮件客户端信头：From/Subject 与正文同源，Subject 随 event 实时变化 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #EFEAE0', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ font: '600 12px ui-monospace,Menlo,monospace', color: '#93A0B4', overflowWrap: 'anywhere' }}>From: {event.hosts}</div>
        <div style={{ font: '600 12px ui-monospace,Menlo,monospace', color: '#93A0B4', overflowWrap: 'anywhere' }}>Subject: {subject}</div>
      </div>
      {/* 真实邮件 HTML：sandbox 隔离邮件自带的 body 样式并禁掉链接导航；长附言在框内滚动 */}
      <iframe
        title="Invitation email preview"
        sandbox=""
        srcDoc={html}
        style={{ width: '100%', height: '520px', border: '0', display: 'block', background: '#FBF8F2' }}
      />
    </div>
  );
}
