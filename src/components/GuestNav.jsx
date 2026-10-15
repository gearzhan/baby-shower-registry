import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Hover } from './ui.jsx';
import { FONT } from '../theme.js';

// 宾客端顶部胶囊导航（原型 GUEST NAV 移植）；登录后额外显示招呼语与退出
export default function GuestNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { firstName, narrow, signOut } = useStore();
  const isInvite = pathname === '/';
  const isReg = pathname.startsWith('/registry');
  const pill = (active) => ({
    padding: '8px 18px', borderRadius: '999px', font: `700 13px ${FONT.sans}`,
    background: active ? '#5B84AE' : 'transparent',
    color: active ? '#FFFFFF' : '#5B6B80',
  });
  const onSignOut = async () => { await signOut(); navigate('/'); };
  return (
    <div
      style={{
        position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 60, display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,.85)',
        backdropFilter: 'blur(10px)', border: '1px solid rgba(61,74,92,.10)',
        borderRadius: '999px', padding: '5px', boxShadow: '0 6px 24px rgba(61,74,92,.12)',
      }}
    >
      <Link to="/" style={pill(isInvite)}>Invitation</Link>
      <Link to="/registry" style={pill(isReg)}>Registry</Link>
      <div style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(61,74,92,.12)', margin: '6px 2px' }}></div>
      {/* 招呼语在窄屏隐藏，免得胶囊在 360px 的手机上撑出屏幕 */}
      {!narrow && firstName && (
        <span style={{ padding: '8px 10px', font: `700 13px ${FONT.sans}`, color: '#5B6B80' }}>Hi, {firstName}</span>
      )}
      <Hover
        as="button"
        onClick={onSignOut}
        style={{ background: 'transparent', border: 'none', padding: '8px 14px', borderRadius: '999px', font: `700 13px ${FONT.sans}`, color: '#9AA3B2', cursor: 'pointer' }}
        hover={{ color: '#C0715E', background: 'rgba(192,113,94,.08)' }}
      >
        Sign out
      </Hover>
    </div>
  );
}
