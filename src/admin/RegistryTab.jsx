import { useStore } from '../store.jsx';
import { groupByStore } from '../util.js';
import { Hover, Toggle } from '../components/ui.jsx';
import { FONT } from '../theme.js';

// 收货/致谢胶囊开关（主人专用进度）：开 = 已认领绿（与状态胶囊同色）；关 = 与 Unclaim 同款素胶囊。
// 可见文字始终是 label（'Received' / 'Thanked'），开关态只靠 aria-pressed 表达；✓ 是装饰，aria-hidden ——
// 不另设 aria-label，保证可访问名称就是看到的文字（WCAG 2.5.3 Label in Name）。
function Mark({ on, onClick, label }) {
  return (
    <Hover
      as="button"
      onClick={onClick}
      aria-pressed={on}
      style={{ background: on ? '#F0F6EC' : 'transparent', border: '1.5px solid ' + (on ? '#DCE9D4' : '#E7E0D2'), color: on ? '#5F8A54' : '#8A94A6', borderRadius: '999px', padding: '7px 13px', font: `700 12px ${FONT.sans}`, cursor: 'pointer' }}
      hover={{ background: on ? '#E7F0E2' : '#F4F1E9' }}
    >
      {on && <span aria-hidden="true">✓ </span>}{label}
    </Hover>
  );
}

// 描边胶囊按钮（与宾客页 "Preview invitation email" 同款）：头部的次要操作共用
const outlineBtn = { background: 'transparent', color: '#5B84AE', border: '1.5px solid #A9C7E4', borderRadius: '999px', padding: '10px 20px', font: `700 13px ${FONT.sans}`, cursor: 'pointer' };
// 浅蓝行内按钮（Edit / Save image 共用）
const paleBtn = { background: '#EAF2F9', border: '1.5px solid #CBDDEE', color: '#47709A', borderRadius: '999px', padding: '7px 15px', font: `700 12px ${FONT.sans}`, cursor: 'pointer' };

// 礼物清单标签页（原型 TAB: REGISTRY 移植）：展示/收尾开关 + 条目计数 + 添加 + 导出 CSV + 逐项编辑/取消认领/移除
// + 把外链商品图转存到自己的 R2（单个 "Save image" / 批量 "Save external images (n)"）
// + 已认领礼物的收货/致谢进度（Received / Thanked，主人专用的感谢卡清单）
export default function RegistryTab() {
  const {
    itemRows, openNewItem, itemAct, all, claimedL, showPrices, showNames, registryClosed, toggleConfig,
    extImgCount, rehostImg, rehostAll, rehostingId, rehostProgress, rehostErrs,
    exportCsv, exporting,
  } = useStore();

  // 本地派生：条目计数行（有认领时再带上收货/致谢进度）
  const recN = itemRows.filter((r) => r.received).length;
  const thxN = itemRows.filter((r) => r.thanked).length;
  const regCountLine = `${all.length} items · ${claimedL.length} claimed` + (claimedL.length ? ` · ${recN} received · ${thxN} thanked` : '');
  // 转存进行中（单个或批量）：所有 Save 按钮一起禁用 —— 同一时刻只跑一个请求
  const rehostBusy = !!rehostingId || !!rehostProgress;
  const rehostAllLabel = rehostProgress ? `Saving images… ${rehostProgress.done}/${rehostProgress.total}` : `Save external images (${extImgCount})`;

  // 与宾客端同一个分组逻辑：没填 store 的排最前、不带标题
  const { ungrouped, groups } = groupByStore(itemRows);
  const sections = [{ store: '', items: ungrouped }, ...groups].filter((s) => s.items.length > 0);

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #EAE3D4', borderRadius: '20px', padding: 'clamp(20px,4vw,34px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div>
          <div style={{ font: `800 16px ${FONT.sans}` }}>Registry items</div>
          <div style={{ font: `600 13px ${FONT.sans}`, color: '#9AA3B2' }}>{regCountLine}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 批量转存外链图：只在还有外链图（或正在跑）时出现；跑批期间显示进度并禁用 */}
          {(extImgCount > 0 || rehostProgress) && (
            <Hover as="button" onClick={rehostAll} disabled={rehostBusy} title="Copy each store-hosted photo into your own storage so it keeps working if the store changes its page" style={{ ...outlineBtn, cursor: rehostBusy ? 'default' : 'pointer', opacity: rehostBusy ? 0.6 : 1 }} hover={rehostBusy ? null : { background: '#EAF2F9' }}>{rehostAllLabel}</Hover>
          )}
          {/* 导出 CSV：点击时重新拉后台数据；导出中禁用 */}
          <Hover as="button" onClick={() => exportCsv('registry')} disabled={exporting} style={{ ...outlineBtn, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1 }} hover={exporting ? null : { background: '#EAF2F9' }}>{exporting ? 'Exporting…' : 'Export CSV'}</Hover>
          <Hover as="button" onClick={openNewItem} style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '12px 24px', font: `700 14px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#47709A' }}>Add item</Hover>
        </div>
      </div>
      {/* 展示设置：控制宾客端能看到什么；Close the registry 是活动后的收尾开关（服务端 423 拦截认领/撤销，主人 Unclaim 不受限） */}
      <div style={{ display: 'flex', gap: '20px 34px', flexWrap: 'wrap', marginBottom: '18px', paddingBottom: '18px', borderBottom: '1px solid #EFE9DC' }}>
        <Toggle on={showPrices} onClick={() => toggleConfig('showPrices')} label="Show prices" hint="Display item prices to guests" />
        <Toggle on={showNames} onClick={() => toggleConfig('showClaimerNames')} label="Show claimer names" hint="Let guests see who claimed each gift" />
        <Toggle on={registryClosed} onClick={() => toggleConfig('registryClosed')} label="Close the registry" hint="Guests can browse but can’t claim or undo" />
      </div>
      {/* 条目列表（空时给指引） */}
      {itemRows.length === 0 && (
        <div style={{ textAlign: 'center', font: `italic 500 16px ${FONT.serif}`, color: '#8A94A6', padding: '24px 0' }}>No items yet — add your first gift with “Add item”.</div>
      )}
      {sections.map((section) => (
        <div key={section.store || '_ungrouped'} style={{ marginBottom: '18px' }}>
          {section.store && (
            <div style={{ font: `700 11.5px ${FONT.sans}`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8A94A6', borderBottom: '1px solid #EFE9DC', paddingBottom: '8px', marginBottom: '10px' }}>{section.store}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {section.items.map((it) => (
              <div key={it.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', border: '1px solid #EFE9DC', borderRadius: '14px', padding: '10px 14px', background: '#FDFCF8' }}>
                <img src={it.imgSrc} alt={it.name} style={{ width: '52px', height: '52px', borderRadius: '10px', objectFit: 'cover', background: '#F4F0E8', border: '1px solid #EDE6D9' }} />
                <div style={{ flex: '1', minWidth: '170px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ font: `700 13.5px ${FONT.sans}`, color: '#3D4A5C' }}>{it.name}</div>
                  {/* store / brand / price 都可能为空（未分组条目就没有 store），过滤后再拼，
                      避免开头的 ' · ' 或连续两个分隔符。
                      这里故意用原始 it.brand 而不是 hasBrand：宾客端要去重，后台不要 ——
                      主人逐条补 brand 时，store 和 brand 并排才好对照，哪怕两者同名。 */}
                  <div style={{ font: `600 12px ${FONT.sans}`, color: '#9AA3B2' }}>{[it.store, it.brand, it.price].filter(Boolean).join(' · ')}</div>
                  {/* 最近一次转存失败的原因；store 只给「仍外链着当时失败的那条链接」的行 —— 换了链接/上传/已转存后自动隐藏 */}
                  {it.extImg && rehostErrs[it.id] && <div style={{ font: `700 12px ${FONT.sans}`, color: '#C0715E' }}>{rehostErrs[it.id]}</div>}
                </div>
                <div style={{ font: `700 11.5px ${FONT.sans}`, color: it.stColor, background: it.stBg, borderRadius: '999px', padding: '6px 13px' }}>{it.statusLabel}</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {/* 收货/致谢进度：只挂在已认领的礼物上（进度存在认领记录里，随认领一起删） */}
                  {it.claimed && (
                    <>
                      <Mark on={it.received} onClick={() => itemAct(it.id, 'received')} label="Received" />
                      <Mark on={it.thanked} onClick={() => itemAct(it.id, 'thanked')} label="Thanked" />
                    </>
                  )}
                  {/* 把这张外链商品图转存到自己的 R2：商家改版/删图/防盗链后照样能显示 */}
                  {it.extImg && (
                    <Hover as="button" onClick={() => rehostImg(it.id)} disabled={rehostBusy} title="Copy this photo from the store into your own storage" style={{ ...paleBtn, cursor: rehostBusy ? 'default' : 'pointer', opacity: rehostBusy ? 0.6 : 1 }} hover={rehostBusy ? null : { background: '#DCEAF6' }}>{rehostingId === it.id ? 'Saving…' : 'Save image'}</Hover>
                  )}
                  <Hover as="button" onClick={() => itemAct(it.id, 'edit')} style={paleBtn} hover={{ background: '#DCEAF6' }}>Edit</Hover>
                  {/* 已标记收到就不给 Unclaim：礼物都到了，取消认领会把它重新开放，还会丢掉进度 —— 先取消 Received 再说。
                      （服务端仍允许主人代为撤销，进度随认领一起删；这里只是不让它一键误触） */}
                  {it.claimed && !it.received && (
                    <Hover as="button" onClick={() => itemAct(it.id, 'unclaim')} style={{ background: 'transparent', border: '1.5px solid #E7E0D2', color: '#8A94A6', borderRadius: '999px', padding: '7px 13px', font: `700 12px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#F4F1E9' }}>Unclaim</Hover>
                  )}
                  <Hover as="button" onClick={() => itemAct(it.id, 'remove')} style={{ background: 'transparent', border: '1.5px solid #E8E1D3', color: '#A5AEBC', borderRadius: '999px', padding: '7px 13px', font: `700 12px ${FONT.sans}`, cursor: 'pointer' }} hover={{ borderColor: '#E0C9BF', color: '#C0715E' }}>Remove</Hover>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
