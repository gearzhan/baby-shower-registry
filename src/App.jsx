import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store.jsx';
import Landing from './pages/Landing.jsx';
import Invitation from './pages/Invitation.jsx';
import Registry from './pages/Registry.jsx';
import Admin from './pages/Admin.jsx';
import RsvpModal from './components/RsvpModal.jsx';
import Toast from './components/Toast.jsx';

// 未登录访问需要身份的页面：送回落地页，并记住原本要去哪（登录后回到那里）
function RequireGuest({ children }) {
  const { authed } = useStore();
  const loc = useLocation();
  if (!authed) return <Navigate to="/" replace state={{ from: loc.pathname + loc.search }} />;
  return children;
}

// 后台：主人 = 邮箱在 HOST_EMAILS 里的宾客。普通宾客手打 /admin 静默送回首页。
// 真正的防线在服务端（/api/admin/* 一律 403），这里只是不让页面白闪一下。
function RequireHost({ children }) {
  const { me } = useStore();
  const loc = useLocation();
  // 没登录：走和 RequireGuest 一样的路 —— 记住他本来要去后台，登录完直接送回去，
  // 而不是把他丢在邀请函页面再自己找入口（主人多半是从书签直接进 /admin 的）
  if (!me) return <Navigate to="/" replace state={{ from: loc.pathname + loc.search }} />;
  if (!me.isHost) return <Navigate to="/" replace />;
  return children;
}

// 路由与全局挂件：RSVP 弹窗与吐司在任意路由都可用（从邀请页触发）
export default function App() {
  const { authed } = useStore();
  return (
    <>
      <Routes>
        <Route path="/" element={authed ? <Invitation /> : <Landing />} />
        <Route path="/registry" element={<RequireGuest><Registry /></RequireGuest>} />
        <Route path="/admin" element={<RequireHost><Admin /></RequireHost>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <RsvpModal />
      <Toast />
    </>
  );
}
