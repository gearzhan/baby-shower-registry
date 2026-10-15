import { useStore } from '../store.jsx';
import { FONT } from '../theme.js';

// 全局吐司提示（原型 TOAST 区块移植）
export default function Toast() {
  const { toast } = useStore();
  return (
    // live region 常驻：aria-live 容器必须先于内容存在，读屏才会播报后续变化
    <div role="status" aria-live="polite">
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: '26px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 300, background: '#3D4A5C', color: '#FFFFFF', font: `700 13.5px ${FONT.sans}`,
            padding: '13px 26px', borderRadius: '999px', boxShadow: '0 14px 40px rgba(20,32,48,.35)',
            animation: 'bsPopUp .3s', maxWidth: '88vw', textAlign: 'center',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
