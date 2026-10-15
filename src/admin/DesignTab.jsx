import { useState } from 'react';
import { useStore, StoreCtx } from '../store.jsx';
import { Hover } from '../components/ui.jsx';
import { FONT } from '../theme.js';
import GardenCard from '../pages/themes/GardenCard.jsx';
import SkyCard from '../pages/themes/SkyCard.jsx';
import WisteriaCard from '../pages/themes/WisteriaCard.jsx';

// 设计标签页（原型 TAB: DESIGN 移植）：主题选择 + 背景上传 + 滑杆 + 实时预览
export default function DesignTab() {
  const store = useStore();
  const { theme, setTheme, bg, onSlider, hasBg, bgStatus, uploadBg, removeBg, bgMediaFor } = store;

  // 预览刷新用的本地随机码：Refresh 时自增以强制预览重挂载
  const [nonce, setNonce] = useState(0);

  // 主题卡选中态描边（选中蓝、未选米）
  const thBorder = (v) => (theme === v ? '#5B84AE' : '#EDE6D9');

  // 滑杆定义：k 对应 bg 的键
  const sliders = [
    { k: 'dX', label: 'Desktop focus · horizontal' },
    { k: 'dY', label: 'Desktop focus · vertical' },
    { k: 'pX', label: 'Phone focus · horizontal' },
    { k: 'pY', label: 'Phone focus · vertical' },
    { k: 'dim', label: 'Photo dim / overlay' },
  ];

  // 当前主题对应的邀请卡组件（用于实时预览）：wisteria 为兜底分支（含旧 'classic' 存量值）
  const Card = theme === 'sky' ? SkyCard : theme === 'garden' ? GardenCard : WisteriaCard;

  // 预览框只是个缩放的 div，而主题卡里的背景焦点取自真实视口宽度（narrow）——
  // 手机框里必须强行注入手机焦点（pX/pY），否则拖 Phone 滑杆预览毫无反应。
  // 不能把它包成 render 体内定义的组件：那样每次渲染都是新组件类型，React 会整棵重挂，
  // 视频背景每拖一下滑杆就从头重播、闪黑。改为在调用处直接内联 Provider，复用稳定的 Card 类型。
  const preview = (phone) => (
    <StoreCtx.Provider value={{ ...store, bgMediaEl: bgMediaFor(phone) }}>
      <Card />
    </StoreCtx.Provider>
  );

  const cardBox = { background: '#FFFFFF', border: '1px solid #EAE3D4', borderRadius: '20px', padding: 'clamp(20px,4vw,34px)' };
  const thumbLabel = { font: `700 13px ${FONT.sans}` };
  const thumbSub = { font: `600 11px ${FONT.sans}`, color: '#9AA3B2' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 主题选择 */}
      <div style={cardBox}>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '4px' }}>Invitation style</div>
        <div style={{ font: `600 13px ${FONT.sans}`, color: '#9AA3B2', marginBottom: '20px' }}>Three looks for the same details — switch any time.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '14px' }}>
          {/* Garden 主题卡 */}
          <Hover as="div" onClick={() => setTheme('garden')} style={{ cursor: 'pointer', border: `2px solid ${thBorder('garden')}`, borderRadius: '16px', padding: '14px', background: '#FFFDF8', display: 'flex', flexDirection: 'column', gap: '10px' }} hover={{ boxShadow: '0 8px 22px rgba(61,74,92,.10)' }}>
            <div style={{ height: '96px', border: '1px solid #E9E1D2', borderRadius: '10px', background: '#FBF8F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '34px', height: '48px', borderRadius: '17px 17px 4px 4px', background: '#EAF2F9', border: '1px solid #CBDDEE' }}></div>
            </div>
            <div style={thumbLabel}>Garden Card <span style={thumbSub}>· arch photo, cream</span></div>
          </Hover>
          {/* Sky 主题卡 */}
          <Hover as="div" onClick={() => setTheme('sky')} style={{ cursor: 'pointer', border: `2px solid ${thBorder('sky')}`, borderRadius: '16px', padding: '14px', background: '#FFFDF8', display: 'flex', flexDirection: 'column', gap: '10px' }} hover={{ boxShadow: '0 8px 22px rgba(61,74,92,.10)' }}>
            <div style={{ height: '96px', borderRadius: '10px', background: 'linear-gradient(180deg,#9FBEDD,#DDEAF5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '60%', height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,.85)' }}></div>
            </div>
            <div style={thumbLabel}>Dreamy Sky <span style={thumbSub}>· full-bleed photo</span></div>
          </Hover>
          {/* Wisteria Ink 主题卡：缩略图末尾的 #FBF7ED 是插画纸色，缺插画文件时（公开仓库不附带）显示为素纸，同 WisteriaCard */}
          <Hover as="div" onClick={() => setTheme('wisteria')} style={{ cursor: 'pointer', border: `2px solid ${thBorder('wisteria')}`, borderRadius: '16px', padding: '14px', background: '#FFFDF8', display: 'flex', flexDirection: 'column', gap: '10px' }} hover={{ boxShadow: '0 8px 22px rgba(61,74,92,.10)' }}>
            <div style={{ height: '96px', borderRadius: '10px', border: '1px solid #E9E1D2', background: "url('/themes/wisteria.webp') left top/cover no-repeat #FBF7ED" }}></div>
            <div style={thumbLabel}>Wisteria Ink <span style={thumbSub}>· botanical line art</span></div>
          </Hover>
        </div>
      </div>

      {/* Wisteria 用固定插画，无照片窗：隐藏上传+滑杆区，改显一句提示 */}
      {theme === 'wisteria' && (
        <div style={cardBox}>
          <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '4px' }}>Background</div>
          <div style={{ font: `600 13px ${FONT.sans}`, color: '#9AA3B2' }}>Wisteria Ink uses fixed artwork — the background photo and focus sliders don't apply to this theme.</div>
        </div>
      )}

      {/* 背景照片/视频 + 滑杆（Wisteria 以外的主题才显示） */}
      {theme !== 'wisteria' && (
      <div style={cardBox}>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '4px' }}>Background photo or video</div>
        <div style={{ font: `600 13px ${FONT.sans}`, color: '#9AA3B2', marginBottom: '20px' }}>Used inside the invitation's photo window (or full-bleed on Dreamy Sky). A short muted video loops like a GIF. Max 30&nbsp;MB for video.</div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '22px' }}>
          {/* 阶段二：上传占位，仅提示 */}
          <Hover as="label" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#5B84AE', color: '#FFFFFF', borderRadius: '999px', padding: '12px 24px', font: `700 14px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#47709A' }}>
            Upload image or video
            <input type="file" accept="image/*,video/*" onChange={(e) => { const f = e.currentTarget.files && e.currentTarget.files[0]; if (f) uploadBg(f); e.currentTarget.value = ''; }} style={{ display: 'none' }} />
          </Hover>
          <div style={{ font: `700 13px ${FONT.sans}`, color: '#8A94A6' }}>Current: {bgStatus}</div>
          {hasBg && (
            <Hover as="button" onClick={removeBg} style={{ background: 'transparent', border: '1.5px solid #E0C9BF', color: '#C0715E', borderRadius: '999px', padding: '10px 20px', font: `700 13px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#FBF1EE' }}>Remove</Hover>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '16px 26px' }}>
          {sliders.map((s) => (
            <label key={s.k} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', font: `700 11.5px ${FONT.sans}`, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8A94A6' }}>
                <span>{s.label}</span><span style={{ color: '#5B84AE' }}>{bg[s.k]}%</span>
              </span>
              <input type="range" min="0" max="100" value={bg[s.k]} onChange={(e) => onSlider(s.k, parseInt(e.currentTarget.value, 10) || 0)} style={{ width: '100%' }} />
            </label>
          ))}
        </div>
      </div>
      )}

      {/* 实时预览：桌面 + 手机（内嵌真实主题卡缩放渲染，取代原型 iframe） */}
      <div style={cardBox}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
          <div style={{ font: `800 16px ${FONT.sans}` }}>Live preview</div>
          <Hover as="button" onClick={() => setNonce((n) => n + 1)} style={{ background: '#F4F1E9', border: '1.5px solid #E7E0D2', color: '#5B84AE', borderRadius: '999px', padding: '8px 16px', font: `700 12.5px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#EAF2F9' }}>Refresh</Hover>
          <div style={{ font: `600 12px ${FONT.sans}`, color: '#9AA3B2' }}>Desktop and phone, rendered live from your settings.</div>
        </div>
        <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* 桌面框 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ font: `700 11px ${FONT.sans}`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8A94A6' }}>Desktop</div>
            <div style={{ width: '392px', maxWidth: '100%', height: '250px', overflow: 'hidden', borderRadius: '14px', border: '1px solid #E2DCCE', background: '#FFFFFF', boxShadow: '0 10px 26px rgba(61,74,92,.10)' }}>
              <div key={'d' + nonce} style={{ width: '1225px', minHeight: '781px', transform: 'scale(.32)', transformOrigin: '0 0', pointerEvents: 'none' }}>
                {preview(false)}
              </div>
            </div>
          </div>
          {/* 手机框 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ font: `700 11px ${FONT.sans}`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8A94A6' }}>Phone</div>
            <div style={{ width: '215px', height: '436px', overflow: 'hidden', borderRadius: '22px', border: '6px solid #3D4A5C', background: '#FFFFFF', boxShadow: '0 12px 30px rgba(61,74,92,.18)' }}>
              <div key={'p' + nonce} style={{ width: '390px', minHeight: '770px', transform: 'scale(.522)', transformOrigin: '0 0', pointerEvents: 'none' }}>
                {preview(true)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
