// 信封舞台（原型 EMAIL PREVIEW 区块的信封部分抽出）：落地页与后台邮件预览共用。
// 纯展示组件，不碰 store —— 状态（envOn/flapZ）留在 store 里，两处调用方各自传入。
// 信封里的卡片内容由 children 决定：落地页给的是不含日期的版本，后台预览给的是完整版。
export default function Envelope({ open, flapZ, onOpen, initial, children }) {
  // 动画数值：复刻原型取值
  const flapDeg = open ? -178 : 0;
  const cardY = open ? -118 : 0;
  const sealO = open ? 0 : 1;

  const onKey = (e) => {
    if (open) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen && onOpen(); }
  };

  return (
    <div
      onClick={open ? undefined : onOpen}
      onKeyDown={onKey}
      role={open ? undefined : 'button'}
      tabIndex={open ? undefined : 0}
      aria-label={open ? undefined : 'Open your invitation'}
      style={{
        position: 'relative', width: '300px', height: '320px',
        cursor: open ? 'default' : 'pointer',
        // 缺了 perspective，rotateX(-178deg) 只是把封盖竖着压扁，不是"翻开一张纸"
        perspective: '900px',
      }}
    >
      {/* 信封后背板 */}
      <div style={{ position: 'absolute', left: '0', right: '0', bottom: '8px', height: '190px', background: '#F3E9D8', borderRadius: '12px', boxShadow: '0 18px 44px rgba(61,74,92,.22)' }}></div>
      {/* 卡片：翻盖开完（延迟 .5s）才滑出 */}
      <div style={{ position: 'absolute', left: '18px', right: '18px', bottom: '26px', height: '168px', background: '#FFFFFF', borderRadius: '10px', boxShadow: '0 8px 26px rgba(61,74,92,.18)', zIndex: 2, transform: `translateY(${cardY}px)`, transition: 'transform .8s cubic-bezier(.2,.7,.2,1) .5s', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '7px', padding: '14px', textAlign: 'center' }}>
        {children}
      </div>
      {/* 信封前袋 */}
      <div style={{ position: 'absolute', left: '0', right: '0', bottom: '8px', height: '108px', background: 'linear-gradient(#EFE3CE,#EAD9BC)', borderRadius: '0 0 12px 12px', zIndex: 3, boxShadow: '0 -1px 0 rgba(61,74,92,.08)' }}></div>
      {/* 信封内背板：盖住翻盖三角形两侧露出的卡片。
          原型少了这一层，合上的信封会从三角形两边漏出白色卡片和上面的字 ——
          当年它只活在后台的邮件预览里，没人细看；现在它是整个站点的大门，必须像个真信封。
          卡片开始滑出时（延迟 .5s，与卡片同步）淡出，好让卡片从"信封里面"升起来。 */}
      <div style={{ position: 'absolute', left: '0', right: '0', bottom: '102px', height: '96px', background: '#F3E9D8', zIndex: 3, opacity: open ? 0 : 1, transition: 'opacity .4s ease .5s' }}></div>
      {/* 翻盖：翻到背面时隐藏背面，避免转到一半露出接缝；drop-shadow 沿裁剪出的三角形描边，
          否则同为米色的翻盖压在内背板上几乎看不出折线 */}
      <div style={{ position: 'absolute', left: '0', right: '0', bottom: '102px', height: '96px', background: 'linear-gradient(#F1E6D2,#EBDDC3)', clipPath: 'polygon(0 0,100% 0,50% 96%)', transformOrigin: '50% 0', transform: `rotateX(${flapDeg}deg)`, backfaceVisibility: 'hidden', filter: 'drop-shadow(0 1px 1.5px rgba(61,74,92,.12))', transition: 'transform .65s cubic-bezier(.6,.05,.3,1)', zIndex: flapZ }}></div>
      {/* 火漆印 */}
      <div style={{ position: 'absolute', left: '50%', bottom: '118px', transform: 'translateX(-50%)', width: '46px', height: '46px', borderRadius: '50%', background: '#A9C7E4', border: '2px solid #93B7DA', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 22px 'Cormorant Garamond',serif", color: '#FFFFFF', zIndex: 6, transition: 'opacity .4s', opacity: sealO, boxShadow: '0 4px 12px rgba(61,74,92,.28)', pointerEvents: 'none' }}>{initial}</div>
    </div>
  );
}
