import { Link } from 'react-router-dom';
import { useStore } from '../../store.jsx';
import { Hover } from '../../components/ui.jsx';
import Markdown from '../../components/Markdown.jsx';
import { FONT } from '../../theme.js';

// WISTERIA INK 主题邀请卡（原型 THEME: WISTERIA INK 区块移植）—— 固定植物线描插画为整卡背景，文字叠在中央留白处
// 该主题没有照片窗：不消费 bgMediaEl/bgIsNone/bgDim，主人上传的背景照片对它无效（设计如此）
// 字号一律用 cqw（容器查询单位），随卡片宽度等比缩放，故手机/桌面/预览缩放下都保持版式比例
export default function WisteriaCard() {
  const { event, openRsvp, rsvpCta, rsvpClosed, rsvpNote, calOk, gcalUrl, addToCalendar } = useStore();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '92px 18px 56px', background: '#EAE8DA' }}>
      {/* 插画卡：图片本身即背景，containerType 让内部 cqw 相对本卡宽度解析。
          末尾的 #FBF7ED 是插画纸色（取自原图四边像素的中位数）：插画不入公开仓库，缺图时 SPA 兜底把这个 URL 当 HTML 返回、
          背景图解码失败，卡片原本会整张透明；有了底色就读作一张素纸。有图时图片 cover 铺满且不透明，底色完全被盖住 */}
      <div style={{ position: 'relative', width: 'min(540px,100%)', aspectRatio: '1200/1691', containerType: 'inline-size', background: "url('/themes/wisteria.webp') center/cover no-repeat #FBF7ED", borderRadius: '18px', boxShadow: '0 30px 80px rgba(62,72,48,.18)', overflow: 'hidden' }}>
        {/* 文字叠层：落在插画中央的奶油留白区 */}
        <div style={{ position: 'absolute', left: '13%', right: '9%', top: '23%', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1.1cqw' }}>
          <div style={{ font: `italic 500 4cqw ${FONT.serif}`, color: '#7E8663' }}>Please join us for a</div>
          <div style={{ font: `500 10cqw/1.02 ${FONT.serif}`, color: '#3F5426' }}>Baby Shower</div>
          <div style={{ font: `700 2.2cqw ${FONT.sans}`, letterSpacing: '.26em', color: '#98A07C', textTransform: 'uppercase', marginTop: '.9cqw' }}>In honour of</div>
          <div style={{ font: `600 6.2cqw ${FONT.serif}`, color: '#4A5D33' }}>{event.hosts}</div>
          <div style={{ font: `italic 500 3.4cqw ${FONT.serif}`, color: '#7E8663' }}>awaiting the arrival of {event.baby}</div>
          <div style={{ font: `600 3.8cqw ${FONT.serif}`, color: '#3F5426', marginTop: '1.1cqw' }}>{event.dateLabel} · {event.timeLabel}</div>
          <div style={{ font: `italic 500 3.4cqw ${FONT.serif}`, color: '#6A7355' }}>{event.venueName}</div>
          {/* 没填地图链接就不渲染（空 href 会跳回本页） */}
          {event.mapsUrl && <a href={event.mapsUrl} target="_blank" rel="noopener" style={{ font: `700 2.6cqw ${FONT.sans}`, color: '#4A5D33' }}>Open in Google Maps ↗</a>}
          {/* RSVP + View Registry 按钮组 */}
          <div style={{ display: 'flex', gap: '2.4cqw', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.1cqw' }}>
            <Hover as="button" onClick={openRsvp} disabled={rsvpClosed} style={{ background: '#4A5D33', color: '#FFFDF4', border: 'none', borderRadius: '999px', padding: '2.2cqw 6.4cqw', font: `700 2.9cqw ${FONT.sans}`, cursor: rsvpClosed ? 'default' : 'pointer', opacity: rsvpClosed ? 0.6 : 1, boxShadow: '0 8px 20px rgba(74,93,51,.28)' }} hover={rsvpClosed ? null : { background: '#3C4C29' }}>{rsvpCta}</Hover>
            <Hover as={Link} to="/registry" style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,253,244,.7)', color: '#4A5D33', border: '1.5px solid #A9B18A', borderRadius: '999px', padding: '2cqw 5cqw', font: `700 2.9cqw ${FONT.sans}` }} hover={{ background: '#F2F1E3' }}>View Registry</Hover>
          </div>
          <div style={{ font: `600 2.5cqw ${FONT.sans}`, color: '#98A07C' }}>{rsvpNote}</div>
        </div>
      </div>
      {/* 加入日历放在插画卡外、欢迎语之上：卡内奶油留白是固定尺寸，再加一行会压到桌子插画（与欢迎语移出卡外同理）。
          颜色取卡内地图链接的 #4A5D33；只在 calOk 时出现 */}
      {calOk && (
        <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '18px' }}>
          <button type="button" onClick={addToCalendar} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: `700 13px ${FONT.sans}`, color: '#4A5D33' }}>Add to calendar</button>
          <a href={gcalUrl} target="_blank" rel="noopener" style={{ font: `700 13px ${FONT.sans}`, color: '#4A5D33' }}>Google Calendar ↗</a>
        </div>
      )}
      {/* 欢迎语放在插画卡下方（卡内留白是固定尺寸，长文会溢出）：像装裱画下的一行手写留言，任意长度都不破版 */}
      {event.welcome && (
        <div style={{ font: `italic 500 17px/1.65 ${FONT.serif}`, color: '#6A7355', textAlign: 'center', maxWidth: '46ch', marginTop: '22px' }}><Markdown text={event.welcome} /></div>
      )}
    </div>
  );
}
