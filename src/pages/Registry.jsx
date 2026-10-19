import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useStore } from '../store.jsx';
import { groupByStore } from '../util.js';
import { Hover } from '../components/ui.jsx';
import GuestNav from '../components/GuestNav.jsx';
import GiftModal from '../components/GiftModal.jsx';
import RegistryHeader from '../components/RegistryHeader.jsx';

// 礼物登记页（原型 REGISTRY 区块移植）：顶部导航、头部、筛选胶囊、礼物网格与页脚，末尾挂载礼物弹窗
export default function Registry() {
  const {
    event, me,
    all, open, claimedL, regItems,
    filter, setFilter, openGift, showPrices, registryClosed,
  } = useStore();

  // 深链恢复：/registry?gift=g4 直接把该礼物弹窗打开。
  // 未登录时会先被送去落地页登录，登录后再回到这个地址（RequireGuest 记了 from）。
  // id 不存在也无妨：derived.gift 查不到 → giftOpen 为 false → 什么都不弹。
  const [sp] = useSearchParams();
  useEffect(() => {
    const g = sp.get('gift');
    if (g) openGift(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选胶囊定义：标签带各分类计数
  const chips = [
    { v: 'all', label: `All gifts (${all.length})` },
    { v: 'open', label: `Available (${open.length})` },
    { v: 'claimed', label: `Claimed (${claimedL.length})` },
  ];

  // 分组渲染：对已筛选的 regItems 分组，所以空组会自己消失，不需要额外处理筛选态。
  // 没填 store 的一组排最前、不带标题（store 为空即 falsy，下面据此跳过标题）。
  const { ungrouped, groups } = groupByStore(regItems);
  const sections = [{ store: '', items: ungrouped }, ...groups].filter((s) => s.items.length > 0);

  return (
    <>
      <GuestNav />
      <div style={{ minHeight: '100vh', background: '#FBF8F2', padding: '96px 18px 40px' }}>
        <div style={{ width: 'min(1080px,100%)', margin: '0 auto' }}>
          {/* 头部：与后台实时预览共用 RegistryHeader（页级下边距留在这里，预览侧不需要） */}
          <div style={{ marginBottom: '30px' }}>
            <RegistryHeader />
          </div>

          {/* 筛选胶囊行 */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              flexWrap: 'wrap', marginBottom: '10px',
            }}
          >
            {chips.map((c) => {
              // 当前选中态与非选中态的配色
              const active = filter === c.v;
              return (
                <button
                  key={c.v}
                  onClick={() => setFilter(c.v)}
                  aria-pressed={active}
                  style={{
                    border: `1.5px solid ${active ? '#5B84AE' : '#D8E2EC'}`,
                    background: active ? '#5B84AE' : '#FFFFFF',
                    color: active ? '#FFFFFF' : '#5B84AE',
                    borderRadius: '999px', padding: '8px 18px',
                    font: "700 12.5px 'Nunito',sans-serif", cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* 操作提示（清单关闭后换成致谢） */}
          <div
            style={{
              textAlign: 'center', font: "600 12.5px 'Nunito',sans-serif", color: '#9AA3B2',
              marginBottom: '26px',
            }}
          >
            {registryClosed
              ? 'The registry is now closed — thank you for your generosity!'
              : "Tap a gift for details — claim it once you've bought it, so no one doubles up."}
          </div>

          {/* 空状态：区分「清单本来就空」和「当前筛选没有匹配」 */}
          {regItems.length === 0 && (
            <div style={{ textAlign: 'center', font: "italic 500 16px 'Cormorant Garamond',serif", color: '#8A94A6', padding: '40px 0' }}>
              {filter === 'open'
                ? 'Every gift has been claimed — thank you all!'
                : filter === 'claimed'
                  ? 'No gifts have been claimed yet.'
                  : 'The registry is still being filled — check back soon!'}
            </div>
          )}

          {/* 礼物网格：按 Store 分组，每组一个标题 + 独立网格 */}
          {sections.map((section) => (
            <div key={section.store || '_ungrouped'} style={{ marginBottom: '30px' }}>
              {section.store && (
                // sticky：手机端只有 1 列，7 件的分组要滚很久，标题钉住才知道自己还在哪家店。
                // top:88px 是量出来的 —— GuestNav 那颗 fixed 胶囊底边在 80px（top:16 + 64 高），
                // 再留 8px 呼吸；页面本身的上内边距是 96px，正好落在两者之间。
                // background 必须不透明，否则卡片会从标题底下透出来。
                <div
                  style={{
                    position: 'sticky', top: '88px', zIndex: 1, background: '#FBF8F2',
                    font: "700 11.5px 'Nunito',sans-serif", letterSpacing: '.14em', color: '#8A94A6',
                    textTransform: 'uppercase', borderBottom: '1px solid #EDE6D9',
                    paddingTop: '10px', paddingBottom: '10px', marginBottom: '14px',
                  }}
                >
                  {section.store}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(205px,1fr))', gap: '18px' }}>
                {section.items.map((it) => (
                  <Hover
                    key={it.id}
                    as="div"
                    onClick={() => openGift(it.id)}
                    style={{
                      cursor: 'pointer', background: '#FFFFFF', border: '1px solid #EDE6D9',
                      borderRadius: '18px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
                      transition: 'transform .22s,box-shadow .22s',
                    }}
                    hover={{ transform: 'translateY(-3px)', boxShadow: '0 16px 36px rgba(61,74,92,.13)' }}
                  >
                    <div style={{ position: 'relative', aspectRatio: '1', background: '#F4F0E8' }}>
                      {/* img 必须移出文档流：卡片是 column flex，in-flow 时 height:100% 无法对
                          aspect-ratio 推导出的 auto 高度求值，会退回图片自然高度，再被 flex item 的
                          min-height:auto 锁死 —— aspect-ratio:1 就永远不生效，非方图会把卡片撑高。
                          （弹窗里同样的写法没事，因为那个容器是 grid item，高度由轨道决定。） */}
                      <img
                        src={it.imgSrc}
                        alt={it.name}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: it.imgFilter }}
                      />
                      {it.claimed && (
                        <div
                          style={{
                            position: 'absolute', top: '10px', right: '10px',
                            background: it.mine ? 'rgba(95,138,84,.9)' : 'rgba(61,74,92,.86)',
                            color: '#FFFFFF', font: "700 11px 'Nunito',sans-serif", padding: '6px 13px',
                            borderRadius: '999px', letterSpacing: '.05em',
                          }}
                        >
                          {it.mine ? 'Claimed by you' : 'Claimed'}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '13px 15px 15px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      {/* store eyebrow 仍然不放这里 —— 分组之后它只是把上方的标题再抄一遍，
                          手机端标题还会 sticky 钉住，滚多远都知道在哪家店。
                          brand 只在与 store 不同名时才显示（hasBrand 已折叠大小写）：综合商店分组里
                          各件礼物的品牌是标题给不了的信息；而品牌直营店分组下再写一遍同名 brand 就只是
                          把标题又抄一遍，跟当初删掉的 store eyebrow 是同一个毛病。
                          不显示时整个节点不渲染，flex 的 4px gap 也不会凭空多出来。 */}
                      {it.hasBrand && (
                        <div
                          style={{
                            font: "700 10px 'Nunito',sans-serif", letterSpacing: '.14em', color: '#A5AEBC',
                            textTransform: 'uppercase',
                          }}
                        >
                          {it.brand}
                        </div>
                      )}
                      <div
                        style={{
                          font: "700 14px/1.35 'Nunito',sans-serif", color: '#3D4A5C', display: '-webkit-box',
                          WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}
                      >
                        {it.name}
                      </div>
                      {showPrices && (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginTop: 'auto', paddingTop: '4px' }}>
                          <span style={{ font: "800 14.5px 'Nunito',sans-serif", color: '#5B84AE' }}>{it.price}</span>
                        </div>
                      )}
                    </div>
                  </Hover>
                ))}
              </div>
            </div>
          ))}

          {/* 页脚：主人署名 + 后台入口 */}
          <div
            style={{
              padding: '34px 0 8px', textAlign: 'center', font: "600 12px 'Nunito',sans-serif",
              color: '#A5AEBC',
            }}
          >
            With love, {event.hosts}
            {/* Host Dashboard 入口只有主人看得见 */}
            {me?.isHost && (
              <>
                {' · '}
                <Hover
                  as={Link}
                  to="/admin"
                  style={{ color: '#A5AEBC', textDecoration: 'underline' }}
                  hover={{ color: '#5B84AE' }}
                >
                  Host Dashboard
                </Hover>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 礼物详情弹窗 */}
      <GiftModal />
    </>
  );
}
