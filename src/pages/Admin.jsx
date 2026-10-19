import { useEffect } from 'react';
import { Link } from 'react-router';
import { useStore } from '../store.jsx';
import { Hover } from '../components/ui.jsx';
import { FONT } from '../theme.js';
import EventTab from '../admin/EventTab.jsx';
import DesignTab from '../admin/DesignTab.jsx';
import GuestsTab from '../admin/GuestsTab.jsx';
import RegistryTab from '../admin/RegistryTab.jsx';
import ItemEditModal from '../components/ItemEditModal.jsx';
import GuestEditModal from '../components/GuestEditModal.jsx';
import EmailPreviewModal from '../components/EmailPreviewModal.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

// 后台外壳（原型 ADMIN 区块移植）：吸顶头部 + 标签栏 + 按 adminTab 分发正文
export default function Admin() {
  const { babyInitial, adminTab, setAdminTab, loadAdmin, adminError, adminLoaded, me } = useStore();

  // 进入后台时加载真实数据（宾客/RSVP/礼物认领等）
  useEffect(() => { loadAdmin(); }, []);

  // 头部显示当前登录的主人（身份就是那份宾客会话，不再有 Cloudflare Access）
  const hostName = me?.name || '';

  // 标签定义（v 用于切换，label 为按钮文案）
  const tabs = [
    { v: 'event', label: 'Event details' },
    { v: 'design', label: 'Invitation design' },
    { v: 'guests', label: 'Guests & RSVPs' },
    { v: 'registry', label: 'Registry' },
  ];

  return (
    <>
      <div data-screen-label="Host Dashboard" style={{ minHeight: '100vh', background: '#F3F0E9' }}>
        {/* 吸顶头部 + 标签栏 */}
        <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #E7E0D2' }}>
          <div style={{ width: 'min(1060px,100%)', margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            {/* 宝宝首字母徽章 */}
            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#EAF2F9', border: '1px solid #CBDDEE', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 16px ${FONT.serif}`, color: '#5B84AE' }}>{babyInitial}</div>
            <div style={{ font: `800 17px ${FONT.sans}`, color: '#3D4A5C' }}>Host Dashboard</div>
            {/* 登录身份胶囊（当前登录主人的宾客会话身份） */}
            <div style={{ font: `600 12px ${FONT.sans}`, color: '#A5AEBC', background: '#F4F1E9', border: '1px solid #E7E0D2', padding: '4px 10px', borderRadius: '999px' }}>{hostName || 'Host'}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '14px', alignItems: 'center' }}>
              <Link to="/" style={{ font: `700 13px ${FONT.sans}` }}>View invitation ↗</Link>
              <Link to="/registry" style={{ font: `700 13px ${FONT.sans}` }}>View registry ↗</Link>
            </div>
          </div>
          <div style={{ width: 'min(1060px,100%)', margin: '0 auto', padding: '0 20px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {tabs.map((t) => {
              // 选中态深色底、白字；未选中态白底、灰字
              const active = adminTab === t.v;
              const bg = active ? '#3D4A5C' : '#FFFFFF';
              const color = active ? '#FFFFFF' : '#5B6B80';
              const border = active ? '#3D4A5C' : '#E2DCCE';
              return (
                <button
                  key={t.v}
                  onClick={() => setAdminTab(t.v)}
                  style={{ border: `1.5px solid ${border}`, background: bg, color, borderRadius: '999px', padding: '9px 18px', font: `700 13px ${FONT.sans}`, cursor: 'pointer' }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 正文：加载失败时整体阻断，否则按当前标签分发。
            不阻断的话，后台会拿公开数据冒充后台数据渲染（宾客列表空、礼物状态错），
            主人对着假数据编辑，每次保存都 403。 */}
        <div style={{ width: 'min(1060px,100%)', margin: '0 auto', padding: '26px 20px 60px' }}>
          {adminError ? (
            <div style={{ background: '#FFFFFF', border: '1px solid #EAE3D4', borderRadius: '20px', padding: 'clamp(28px,5vw,44px)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#FBF1EE', border: '1.5px solid #E0C9BF', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `800 22px ${FONT.sans}`, color: '#C0715E' }}>!</div>
              <div style={{ font: `600 24px ${FONT.serif}`, color: '#3D4A5C' }}>Couldn't load your admin data</div>
              <div style={{ font: `600 14px/1.6 ${FONT.sans}`, color: '#8A94A6', maxWidth: '360px' }}>Your session may have expired. Sign in again, or retry — we're not showing the dashboard until we have your real data.</div>
              <Hover as="button" onClick={() => loadAdmin()} style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '12px 30px', font: `700 14px ${FONT.sans}`, cursor: 'pointer', marginTop: '4px' }} hover={{ background: '#47709A' }}>Retry</Hover>
            </div>
          ) : !adminLoaded ? (
            // 后台真实数据未到位前不渲染标签页：否则会拿启动时的公开数据冒充后台数据，
            // 而主人此刻的输入会被随后的 setData 覆盖（防抖保存又把旧值写回）
            <div style={{ font: `italic 500 20px ${FONT.serif}`, color: '#8A94A6', textAlign: 'center', padding: '60px 0' }}>Loading…</div>
          ) : (
            <>
              {adminTab === 'event' && <EventTab />}
              {adminTab === 'design' && <DesignTab />}
              {adminTab === 'guests' && <GuestsTab />}
              {adminTab === 'registry' && <RegistryTab />}
            </>
          )}
        </div>
      </div>

      {/* 全局挂载：礼物编辑弹窗 + 宾客编辑弹窗 + 邮件预览弹窗 + 危险操作确认弹窗 */}
      <ItemEditModal />
      <GuestEditModal />
      <EmailPreviewModal />
      <ConfirmModal />
    </>
  );
}
