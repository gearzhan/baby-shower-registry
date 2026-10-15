import { useStore } from '../store.jsx';
import { Hover, FocusInput, useEscClose } from './ui.jsx';
import { FONT } from '../theme.js';

// 宾客编辑弹窗：改名 / 改错邮箱（壳子照抄 ItemEditModal，宽度同 RsvpModal）。仅在 guestEditOpen 时渲染。
// 保存途中遮罩 / ✕ / Cancel / Escape 一律不响应（closeGuestEdit 自己也会挡）。
// 主人行（含 host-* 行）的邮箱输入框禁用 —— 只是外观，服务端同样 403。
export default function GuestEditModal() {
  const { guestEditOpen, gf, onGuestField, saveGuest, closeGuestEdit, guestErr, savingGuest } = useStore();

  // Escape 关闭（须在提前返回之前调用 —— Rules of Hooks）；保存中不响应
  useEscClose(guestEditOpen && !savingGuest, closeGuestEdit);

  if (!guestEditOpen) return null;

  const f = gf || {};
  // 阻止内层点击冒泡到遮罩
  const swallow = (e) => e.stopPropagation();

  const labelSpan = { font: `700 11px ${FONT.sans}`, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A94A6' };
  const inputStyle = { width: '100%', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: `600 14px ${FONT.sans}`, outline: 'none', background: '#FFFFFF' };
  const focusRing = { borderColor: '#A9C7E4' };

  // 只有邮箱真的变了（去空格 + 小写后）才出提示：大小写 / 空格的差别服务端也当作没改
  const emailChanging = !f.emailLocked && (f.email || '').trim().toLowerCase() !== f.origEmail;
  // 旧地址那边已经有人以这位宾客的身份回复过 / 认领过：提醒主人先核对（数据按主人的决定保留）
  const used = [f.rsvpBySelf && 'RSVPed', f.claims && 'claimed ' + f.claims + (f.claims === 1 ? ' gift' : ' gifts')].filter(Boolean);

  return (
    <div data-screen-label="Guest editor" onClick={closeGuestEdit} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(30,40,55,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', animation: 'bsFadeIn .25s' }}>
      <div role="dialog" aria-modal="true" aria-label="Edit guest" onClick={swallow} style={{ position: 'relative', width: 'min(460px,100%)', maxHeight: '94vh', overflow: 'auto', background: '#FFFDF8', borderRadius: '22px', boxShadow: '0 30px 90px rgba(20,32,48,.35)', animation: 'bsPopUp .3s', padding: 'clamp(20px,4vw,30px)' }}>
        <Hover as="button" aria-label="Close" onClick={closeGuestEdit} disabled={savingGuest} style={{ position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px', borderRadius: '50%', border: '1px solid #E7E0D2', background: '#FFFFFF', color: '#8A94A6', font: `700 15px ${FONT.sans}`, cursor: savingGuest ? 'default' : 'pointer' }} hover={savingGuest ? null : { color: '#3D4A5C' }}>✕</Hover>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '18px' }}>Edit guest</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={labelSpan}>Name</span>
            <FocusInput as="input" value={f.name || ''} onChange={(e) => onGuestField('name', e.currentTarget.value)} style={inputStyle} focus={focusRing} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={labelSpan}>Email</span>
            <FocusInput as="input" value={f.email || ''} disabled={f.emailLocked} onChange={(e) => onGuestField('email', e.currentTarget.value)} style={{ ...inputStyle, ...(f.emailLocked ? { opacity: 0.6 } : null) }} focus={focusRing} />
          </label>
        </div>

        {/* 主人行：邮箱来自站点配置（HOST_EMAILS），这里只能改名 */}
        {f.emailLocked && (
          <div style={{ font: `600 11.5px ${FONT.sans}`, color: '#A5AEBC', marginTop: '8px' }}>A host’s email comes from the site settings and can’t be changed here.</div>
        )}
        {/* 改邮箱的后果说明（沿用 Awaiting reply 的琥珀色）：旧地址的会话会被登出、邀请标回未发送，RSVP 和认领保留 */}
        {emailChanging && (
          <div style={{ marginTop: '14px', background: '#FBF4E8', border: '1px solid #EEE0C8', color: '#B08A4F', borderRadius: '12px', padding: '10px 14px', font: `600 12.5px/1.5 ${FONT.sans}` }}>
            Saving signs out anyone using the old address and marks the invitation as not sent. Their RSVP and claimed gifts stay with this guest.
            {used.length > 0 && ' Someone signed in as this guest has already ' + used.join(' and ') + ' — if the old address was a typo, check those before sending the invitation again.'}
          </div>
        )}

        {guestErr && <div style={{ font: `700 13px ${FONT.sans}`, color: '#C0715E', marginTop: '12px' }}>{guestErr}</div>}

        {/* 操作按钮：保存中禁用（同 ConfirmModal 的忙碌态） */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px' }}>
          <Hover as="button" onClick={saveGuest} disabled={savingGuest} style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '13px 30px', font: `700 14px ${FONT.sans}`, cursor: savingGuest ? 'default' : 'pointer', opacity: savingGuest ? 0.6 : 1 }} hover={savingGuest ? null : { background: '#47709A' }}>{savingGuest ? 'Saving…' : 'Save guest'}</Hover>
          <Hover as="button" onClick={closeGuestEdit} disabled={savingGuest} style={{ background: 'transparent', color: '#8A94A6', border: '1.5px solid #E2DCCE', borderRadius: '999px', padding: '12px 24px', font: `700 14px ${FONT.sans}`, cursor: savingGuest ? 'default' : 'pointer', opacity: savingGuest ? 0.6 : 1 }} hover={savingGuest ? null : { background: '#F4F1E9' }}>Cancel</Hover>
        </div>
      </div>
    </div>
  );
}
