import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import { StoreProvider } from './store.jsx';

// 应用入口：挂载 React 根节点，使用路径路由（BrowserRouter）；StoreProvider 提供全站状态
// useTransitions={false}：react-router v7 默认把路由状态更新包进 React.startTransition，
// 登出时 setMe(null) 会先于路径更新渲染，RequireGuest 在 /registry 上补一个带 state.from 的
// <Navigate replace>，下一位登录者就被送去 /registry；登录后也会先闪一帧 Invitation 再跳目标页。
// 关掉过渡，恢复 v6 的同步更新语义（本应用没有 Suspense/懒加载，用不上过渡）
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter useTransitions={false}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </React.StrictMode>
);
