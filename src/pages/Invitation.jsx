import { Link } from 'react-router';
import { useStore } from '../store.jsx';
import { Hover } from '../components/ui.jsx';
import { FONT } from '../theme.js';
import GuestNav from '../components/GuestNav.jsx';
import GardenCard from './themes/GardenCard.jsx';
import SkyCard from './themes/SkyCard.jsx';
import WisteriaCard from './themes/WisteriaCard.jsx';

// 宾客端邀请页外壳：顶部导航 + 按当前主题渲染邀请卡 + 底部落款
// RSVP 弹窗在全局挂载，本页只负责触发 openRsvp（由各主题卡内部调用）
export default function Invitation() {
  const { event, theme, me } = useStore();
  // 依据 theme 选择对应主题卡：wisteria 为兜底分支（含旧 'classic' 存量值）；新部署的默认主题是 garden（见 seed-data.js）
  const Card = theme === 'sky' ? SkyCard : theme === 'garden' ? GardenCard : WisteriaCard;
  return (
    <div data-screen-label="Invitation" style={{ minHeight: '100vh' }}>
      <GuestNav />
      <Card />
      {/* 底部落款：主人署名 + Host Dashboard 入口（只有主人看得见） */}
      <div style={{ padding: '26px', textAlign: 'center', font: `600 12px ${FONT.sans}`, color: '#A5AEBC', background: 'transparent' }}>
        With love, {event.hosts}
        {me?.isHost && (
          <> · <Hover as={Link} to="/admin" style={{ color: '#A5AEBC', textDecoration: 'underline' }} hover={{ color: '#5B84AE' }}>Host Dashboard</Hover></>
        )}
      </div>
    </div>
  );
}
