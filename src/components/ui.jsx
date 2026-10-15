import { useEffect, useState } from 'react';
import { FONT } from '../theme.js';

// Hover 容器：合并 style 与 hover 时的样式，复刻原型的 style-hover 行为。
// as 可为 'div' | 'button' | 'a' | 'label' 等；其余属性透传（onClick/href/type…）。
export function Hover({ as = 'div', style, hover, children, ...rest }) {
  const [h, setH] = useState(false);
  const El = as;
  return (
    <El
      style={{ ...style, ...(h && hover ? hover : null) }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      {...rest}
    >
      {children}
    </El>
  );
}

// Escape 关闭弹窗：仅 active 时订阅 window keydown，卸载/失活即退订。
// 注意：必须在各弹窗的提前返回（if (!open) return null）之前调用 —— Rules of Hooks 不允许条件调用。
export function useEscClose(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}

// Focus 输入容器：复刻原型 style-focus（聚焦时描边高亮）。用于 input/textarea。
export function FocusInput({ as = 'input', style, focus, ...rest }) {
  const [f, setF] = useState(false);
  const El = as;
  return (
    <El
      style={{ ...style, ...(f && focus ? focus : null) }}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      {...rest}
    />
  );
}

// 开关（一个胶囊滑块，role="switch"）：后台共用 ——
// 礼物清单展示开关 showPrices / showClaimerNames 与收尾开关 registryClosed（RegistryTab），
// 以及收尾开关 rsvpClosed（GuestsTab）。都是一键可撤回的即时保存，不走 ConfirmModal。
export function Toggle({ on, onClick, label, hint }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '11px', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }} role="switch" aria-checked={on}>
      <span style={{ width: '40px', height: '23px', borderRadius: '999px', background: on ? '#5B84AE' : '#D8D2C4', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: '2px', left: on ? '19px' : '2px', width: '19px', height: '19px', borderRadius: '50%', background: '#FFFFFF', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
      </span>
      <span>
        <span style={{ font: `700 13px ${FONT.sans}`, color: '#3D4A5C', display: 'block' }}>{label}</span>
        <span style={{ font: `600 12px ${FONT.sans}`, color: '#9AA3B2' }}>{hint}</span>
      </span>
    </button>
  );
}
