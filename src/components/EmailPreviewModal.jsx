import { Link } from 'react-router';
import { useStore } from '../store.jsx';
import { Hover, useEscClose } from './ui.jsx';
import Envelope from './Envelope.jsx';

// 邮件预览弹窗（原型 EMAIL PREVIEW MODAL 区块移植）：信封开启动画 + 邀请卡滑出。
// 信封舞台已抽成 <Envelope>，与落地页共用；这里的卡片内容仍是主人视角的完整版（含日期）。
export default function EmailPreviewModal() {
  const { event, babyInitial, emailOpen, closeEmail, envOn, envOpen, envReplay, flapZ } = useStore();

  // Escape 关闭（须在提前返回之前调用 —— Rules of Hooks）
  useEscClose(emailOpen, closeEmail);

  // 仅在弹窗开启时渲染
  if (!emailOpen) return null;

  // 内层容器阻止事件冒泡
  const swallow = (e) => e.stopPropagation();
  const envHint = !envOn;

  return (
    <div
      onClick={closeEmail}
      style={{ position: 'fixed', inset: '0', zIndex: 120, background: 'rgba(30,40,55,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', animation: 'bsFadeIn .25s' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invitation email preview"
        onClick={swallow}
        style={{ position: 'relative', width: 'min(560px,100%)', maxHeight: '94vh', overflow: 'auto', background: '#FFFFFF', borderRadius: '22px', boxShadow: '0 30px 90px rgba(20,32,48,.4)', animation: 'bsPopUp .3s' }}
      >
        <Hover
          as="button"
          aria-label="Close"
          onClick={closeEmail}
          style={{ position: 'absolute', top: '12px', right: '12px', width: '34px', height: '34px', borderRadius: '50%', border: '1px solid #E7E0D2', background: '#FFFFFF', color: '#8A94A6', font: "700 14px 'Nunito',sans-serif", cursor: 'pointer', zIndex: 5 }}
          hover={{ color: '#3D4A5C' }}
        >
          ✕
        </Hover>

        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #EFEAE0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ font: "800 14px 'Nunito',sans-serif", color: '#3D4A5C' }}>Invitation email — preview</div>
          <div style={{ font: '600 12px ui-monospace,Menlo,monospace', color: '#93A0B4' }}>From: {event.hosts}</div>
          <div style={{ font: '600 12px ui-monospace,Menlo,monospace', color: '#93A0B4' }}>Subject: You're invited — A Baby Shower for {event.baby}</div>
        </div>

        <div style={{ background: 'linear-gradient(180deg,#DCE9F5,#EDF3F9)', padding: '34px 20px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Envelope open={envOn} flapZ={flapZ} onOpen={envOpen} initial={babyInitial}>
            <div style={{ font: "700 9px 'Nunito',sans-serif", letterSpacing: '.28em', color: '#A9C7E4', textTransform: 'uppercase' }}>You're invited</div>
            <div style={{ font: "600 21px/1.15 'Cormorant Garamond',serif", color: '#3D4A5C' }}>A Baby Shower<br />for {event.baby}</div>
            <div style={{ font: "600 11px 'Nunito',sans-serif", color: '#8A94A6' }}>{event.dateLabel} · {event.timeLabel}</div>
            <Hover
              as={Link}
              to="/"
              onClick={closeEmail}
              style={{ display: 'inline-flex', background: '#5B84AE', color: '#FFFFFF', borderRadius: '999px', padding: '9px 20px', font: "700 12px 'Nunito',sans-serif", marginTop: '2px' }}
              hover={{ background: '#47709A', color: '#FFFFFF' }}
            >
              Open Invitation
            </Hover>
          </Envelope>
          {envHint && (
            <div style={{ font: '600 11px ui-monospace,Menlo,monospace', color: '#7C93AC', marginTop: '10px' }}>tap the envelope to open it</div>
          )}
          {envOn && (
            <Hover
              as="button"
              onClick={envReplay}
              style={{ marginTop: '10px', background: 'none', border: 'none', color: '#7C93AC', font: "700 12px 'Nunito',sans-serif", cursor: 'pointer', textDecoration: 'underline' }}
              hover={{ color: '#47709A' }}
            >
              Replay animation
            </Hover>
          )}
        </div>

        <div style={{ padding: '14px 22px 18px', font: "600 12px/1.6 'Nunito',sans-serif", color: '#9AA3B2' }}>This is how guests experience the email: the envelope opens, the card slides out, and the button brings them to the invitation page.</div>
      </div>
    </div>
  );
}
