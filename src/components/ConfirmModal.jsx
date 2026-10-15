import { useStore } from '../store.jsx';
import { Hover, useEscClose } from './ui.jsx';
import { FONT } from '../theme.js';

// 危险 / 不可撤回操作确认弹窗：由 store 的 confirm payload 驱动（标题/说明/按钮文案/action）。
// 四个后台破坏性操作（移除礼物/移除宾客/取消认领/删除背景）和 RSVP 提醒群发（邮件发出去就收不回）都经它二次确认；
// 遮罩 / ✕ / Cancel / Escape 都等于取消，执行中（confirmBusy）一律不可关闭。
export default function ConfirmModal() {
  const { confirmOpen, confirm, confirmBusy, runConfirm, closeConfirm } = useStore();
  // Escape 关闭：必须在提前返回之前调用（Rules of Hooks）；执行中不响应
  useEscClose(confirmOpen && !confirmBusy, closeConfirm);

  if (!confirmOpen) return null;

  const c = confirm;
  // 阻止内层点击冒泡到遮罩
  const swallow = (e) => e.stopPropagation();

  return (
    <div data-screen-label="Confirm" onClick={closeConfirm} style={{ position: 'fixed', inset: 0, zIndex: 140, background: 'rgba(30,40,55,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', animation: 'bsFadeIn .25s' }}>
      <div role="dialog" aria-modal="true" aria-label={c.title} onClick={swallow} style={{ position: 'relative', width: 'min(420px,100%)', background: '#FFFDF8', borderRadius: '22px', boxShadow: '0 30px 90px rgba(20,32,48,.35)', animation: 'bsPopUp .3s', padding: 'clamp(20px,4vw,30px)' }}>
        <Hover as="button" aria-label="Close" onClick={closeConfirm} disabled={confirmBusy} style={{ position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px', borderRadius: '50%', border: '1px solid #E7E0D2', background: '#FFFFFF', color: '#8A94A6', font: `700 15px ${FONT.sans}`, cursor: confirmBusy ? 'default' : 'pointer' }} hover={confirmBusy ? null : { color: '#3D4A5C' }}>✕</Hover>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '10px', paddingRight: '40px' }}>{c.title}</div>
        <div style={{ font: `600 14px/1.6 ${FONT.sans}`, color: '#6C7889', marginBottom: '20px' }}>{c.message}</div>
        {/* 操作按钮：危险键写明具体动作，执行中禁用并显示 busyLabel */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Hover as="button" onClick={runConfirm} disabled={confirmBusy} style={{ background: '#C0715E', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '13px 30px', font: `700 14px ${FONT.sans}`, cursor: confirmBusy ? 'default' : 'pointer', opacity: confirmBusy ? 0.6 : 1 }} hover={confirmBusy ? null : { background: '#A85D4C' }}>{confirmBusy ? c.busyLabel : c.confirmLabel}</Hover>
          <Hover as="button" onClick={closeConfirm} disabled={confirmBusy} style={{ background: 'transparent', color: '#8A94A6', border: '1.5px solid #E2DCCE', borderRadius: '999px', padding: '12px 24px', font: `700 14px ${FONT.sans}`, cursor: confirmBusy ? 'default' : 'pointer', opacity: confirmBusy ? 0.6 : 1 }} hover={confirmBusy ? null : { background: '#F4F1E9' }}>Cancel</Hover>
        </div>
      </div>
    </div>
  );
}
