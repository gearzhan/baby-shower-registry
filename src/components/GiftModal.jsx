import { useStore } from '../store.jsx';
import { Hover, useEscClose } from '../components/ui.jsx';

// 礼物详情弹窗（原型 GIFT DETAIL MODAL 移植）：仅在 giftOpen 时渲染。
// 认领的是"当前登录的这个人"，不再手输姓名；自己认领的还能一键撤销。
export default function GiftModal() {
  const {
    giftOpen, gift: giftRaw, showPrices, giftClaimedLine, showClaimCta, giftIsMine,
    claimErr, claimBusy, confirmClaim, unclaimGift, closeGift, registryClosed,
  } = useStore();

  // Escape 关闭（须在提前返回之前调用 —— Rules of Hooks）
  useEscClose(giftOpen, closeGift);

  if (!giftOpen) return null;

  // gift 可能为 {}，做空值兜底
  const gift = giftRaw || {};
  // 阻止内层点击冒泡到遮罩（避免误关弹窗）
  const swallow = (e) => e.stopPropagation();

  return (
    <div
      onClick={closeGift}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(30,40,55,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px',
        animation: 'bsFadeIn .25s',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={gift.name || 'Gift details'}
        onClick={swallow}
        style={{
          position: 'relative', width: 'min(780px,100%)', maxHeight: '92vh', overflow: 'auto',
          background: '#FFFDF8', borderRadius: '24px', boxShadow: '0 30px 90px rgba(20,32,48,.35)',
          animation: 'bsPopUp .3s', padding: 'clamp(18px,3vw,28px)',
        }}
      >
        <Hover
          as="button"
          aria-label="Close"
          onClick={closeGift}
          style={{
            position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px',
            borderRadius: '50%', border: '1px solid #E7E0D2', background: '#FFFFFF', color: '#8A94A6',
            font: "700 15px 'Nunito',sans-serif", cursor: 'pointer', zIndex: 2,
          }}
          hover={{ color: '#3D4A5C', borderColor: '#CBDDEE' }}
        >
          ✕
        </Hover>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '24px' }}>
          {/* 图片列 */}
          <div
            style={{
              position: 'relative', aspectRatio: '1', borderRadius: '18px', overflow: 'hidden',
              background: '#F4F0E8', border: '1px solid #EDE6D9',
            }}
          >
            <img
              src={gift.imgSrc}
              alt={gift.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: gift.imgFilter }}
            />
            {gift.claimed && (
              <div
                style={{
                  position: 'absolute', top: '12px', right: '12px',
                  background: gift.mine ? 'rgba(95,138,84,.9)' : 'rgba(61,74,92,.86)',
                  color: '#FFFFFF', font: "700 11.5px 'Nunito',sans-serif", padding: '7px 14px',
                  borderRadius: '999px',
                }}
              >
                {gift.mine ? 'Claimed by you' : 'Claimed'}
              </div>
            )}
          </div>

          {/* 详情列 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                font: "700 11px 'Nunito',sans-serif", letterSpacing: '.16em', color: '#A5AEBC',
                textTransform: 'uppercase', marginTop: '6px',
              }}
            >
              {/* store · brand；同名时 hasBrand 为 false，filter 会把它吃掉，不会出现 BRAND · BRAND 这种重复。
                  store 恒在前，免得有无 brand 的条目之间这一行左右横跳。 */}
              {[gift.store, gift.hasBrand && gift.brand].filter(Boolean).join(' · ')}
            </div>
            <div style={{ font: "600 clamp(22px,3.4vw,28px)/1.2 'Cormorant Garamond',serif", color: '#3D4A5C' }}>
              {gift.name}
            </div>
            <div style={{ font: "600 14px/1.65 'Nunito',sans-serif", color: '#6C7889' }}>{gift.desc}</div>

            {gift.hasColor && (
              <div style={{ font: "600 13px 'Nunito',sans-serif", color: '#8A94A6' }}>
                Colour: <span style={{ color: '#3D4A5C', fontWeight: 700 }}>{gift.color}</span>
              </div>
            )}

            {showPrices && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
                <span style={{ font: "800 21px 'Nunito',sans-serif", color: '#5B84AE' }}>{gift.price}</span>
              </div>
            )}

            <div style={{ height: '1px', background: '#EFE8DA', margin: '4px 0' }}></div>

            {/* 外链操作行 */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {gift.hasLink && (
                <Hover
                  as="a"
                  href={gift.link}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: 'inline-flex', alignItems: 'center', background: '#5B84AE', color: '#FFFFFF',
                    borderRadius: '999px', padding: '12px 24px', font: "700 13.5px 'Nunito',sans-serif",
                  }}
                  hover={{ background: '#47709A', color: '#FFFFFF' }}
                >
                  View product page ↗
                </Hover>
              )}
              <Hover
                as="a"
                href={gift.gUrl}
                target="_blank"
                rel="noopener"
                style={{
                  display: 'inline-flex', alignItems: 'center', background: 'transparent', color: '#5B84AE',
                  border: '1.5px solid #A9C7E4', borderRadius: '999px', padding: '11px 22px',
                  font: "700 13.5px 'Nunito',sans-serif",
                }}
                hover={{ background: '#EAF2F9' }}
              >
                Search on Google ↗
              </Hover>
            </div>

            {gift.claimed && (
              <div
                style={{
                  background: '#F0F6EC', border: '1px solid #DCE9D4', borderRadius: '14px', padding: '14px 18px',
                  font: "700 14px 'Nunito',sans-serif", color: '#5F8A54', marginTop: '4px',
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px',
                }}
              >
                <div>{giftClaimedLine} — thank you!</div>
                {/* 改主意了：撤销认领。不加二次确认 —— 它随时可以再认领回来，
                    为一件婴儿礼物在弹窗上再叠一个弹窗很荒唐。
                    清单关闭后不再给撤销（服务端也会 423），绿色的"你会带这件"仍保留。 */}
                {giftIsMine && !registryClosed && (
                  <Hover
                    as="button"
                    onClick={unclaimGift}
                    disabled={claimBusy}
                    style={{
                      background: 'transparent', border: '1.5px solid #DCE9D4', color: '#5F8A54',
                      borderRadius: '999px', padding: '8px 16px', font: "700 12.5px 'Nunito',sans-serif",
                      cursor: claimBusy ? 'default' : 'pointer', opacity: claimBusy ? 0.6 : 1,
                    }}
                    hover={claimBusy ? null : { background: '#E7F0E2' }}
                  >
                    {claimBusy ? 'Undoing…' : 'I changed my mind — undo'}
                  </Hover>
                )}
              </div>
            )}

            {/* 一步认领：身份来自会话，不用再问"这是谁送的" */}
            {showClaimCta && (
              <Hover
                as="button"
                onClick={confirmClaim}
                disabled={claimBusy}
                style={{
                  alignSelf: 'flex-start', background: '#3D4A5C', color: '#FFFFFF', border: 'none',
                  borderRadius: '999px', padding: '13px 28px', font: "700 14px 'Nunito',sans-serif",
                  cursor: claimBusy ? 'default' : 'pointer', opacity: claimBusy ? 0.6 : 1, marginTop: '4px',
                }}
                hover={claimBusy ? null : { background: '#2E3947' }}
              >
                {claimBusy ? 'Claiming…' : "I'll bring this gift"}
              </Hover>
            )}

            {claimErr && (
              <div style={{ font: "700 12.5px 'Nunito',sans-serif", color: '#C0715E' }}>{claimErr}</div>
            )}

            {/* 清单已关闭：未被认领的礼物不再给认领按钮（showClaimCta 已为 false），换成一行灰色说明 */}
            {registryClosed && !gift.claimed && (
              <div style={{ font: "600 11.5px 'Nunito',sans-serif", color: '#A5AEBC' }}>The registry is now closed — thank you!</div>
            )}

            {showClaimCta && (
              <div style={{ font: "600 11.5px 'Nunito',sans-serif", color: '#A5AEBC' }}>
                Claiming just marks it as taken so no one doubles up — you can undo it any time.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
