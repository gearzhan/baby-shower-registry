import { Link } from 'react-router';
import { useStore } from '../../store.jsx';
import { Hover } from '../../components/ui.jsx';
import Markdown from '../../components/Markdown.jsx';
import { FONT } from '../../theme.js';

// GARDEN 主题邀请卡（原型 THEME: GARDEN 区块移植）—— 拱形照片窗 + 双描边奶油卡
export default function GardenCard() {
  const { event, babyInitial, bgMediaEl, bgIsNone, bgDim, openRsvp, rsvpCta, rsvpClosed, rsvpNote, me, calOk, gcalUrl, addToCalendar } = useStore();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '92px 18px 56px', background: '#FBF8F2' }}>
      <div style={{ position: 'relative', width: 'min(700px,100%)', background: '#FFFDF8', border: '1px solid #E9E1D2', borderRadius: '26px', boxShadow: '0 30px 80px rgba(61,74,92,.10)', padding: 'clamp(30px,6vw,60px)', textAlign: 'center' }}>
        {/* 内层浅蓝描边框 */}
        <div style={{ position: 'absolute', inset: '11px', border: '1px solid rgba(169,199,228,.6)', borderRadius: '17px', pointerEvents: 'none' }}></div>
        {/* 宝宝首字母圆章（浮动动画） */}
        <div style={{ width: '54px', height: '54px', margin: '0 auto 24px', borderRadius: '50%', background: '#EAF2F9', border: '1px solid #CBDDEE', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 24px ${FONT.serif}`, color: '#5B84AE', animation: 'bsFloat 6s ease-in-out infinite', position: 'relative' }}>{babyInitial}</div>
        {/* 照片/视频窗（拱形） */}
        <div style={{ position: 'relative', width: 'min(320px,74vw)', margin: '0 auto 30px', aspectRatio: '4/4.7', borderRadius: '170px 170px 20px 20px', overflow: 'hidden', border: '1px solid #E5DCC9', background: '#EAF2F9' }}>
          {bgMediaEl}
          {bgIsNone && (
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg,#E7F0F8 0%,#F4EEE1 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255,255,255,.7)', border: '1px solid #D8E4F0', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `500 30px ${FONT.serif}`, color: '#8FB0CE' }}>{babyInitial}</div>
              {/* 这句是给主人看的操作提示，宾客不该看到"Host Dashboard"这几个字 */}
              {me?.isHost && (
                <div style={{ font: '600 10.5px ui-monospace,Menlo,monospace', color: '#93A0B4', textAlign: 'center', lineHeight: '1.6' }}>photo or video slot<br />add in Host Dashboard → Design</div>
              )}
            </div>
          )}
          {/* 暗化叠层：不透明度取自 bgDim */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(28,40,56,1)', opacity: bgDim, pointerEvents: 'none' }}></div>
        </div>
        <div style={{ font: `italic 500 clamp(19px,3.4vw,24px) ${FONT.serif}`, color: '#8A94A6' }}>Please join us for a</div>
        <div style={{ font: `500 clamp(46px,9vw,76px)/1.05 ${FONT.serif}`, color: '#3D4A5C', margin: '6px 0 18px' }}>Baby Shower</div>
        {/* 分隔线 · 圆点 · 分隔线 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '18px' }}>
          <div style={{ width: '64px', height: '1px', background: '#DCD2BE' }}></div>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#A9C7E4' }}></div>
          <div style={{ width: '64px', height: '1px', background: '#DCD2BE' }}></div>
        </div>
        <div style={{ font: `700 11px ${FONT.sans}`, letterSpacing: '.22em', color: '#9AA3B2', textTransform: 'uppercase' }}>In honour of</div>
        <div style={{ font: `600 clamp(28px,5vw,38px) ${FONT.serif}`, color: '#5B84AE', margin: '6px 0 4px' }}>{event.hosts}</div>
        <div style={{ font: `italic 500 clamp(16px,3vw,19px) ${FONT.serif}`, color: '#8A94A6', marginBottom: '26px' }}>as we await the arrival of {event.baby}</div>
        <div style={{ font: `italic 400 15px/1.65 ${FONT.serif}`, color: '#6C7889', maxWidth: '420px', margin: '0 auto 28px' }}><Markdown text={event.welcome} /></div>
        {/* 日期 / 时间 / 地点 三栏 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '14px', borderTop: '1px solid #EFE8DA', borderBottom: '1px solid #EFE8DA', padding: '18px 6px', marginBottom: '28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ font: `700 10px ${FONT.sans}`, letterSpacing: '.18em', color: '#9AA3B2', textTransform: 'uppercase' }}>Date</div>
            <div style={{ font: `600 17px ${FONT.serif}`, color: '#3D4A5C' }}>{event.dateLabel}</div>
            {/* 加入日历：主人填齐开始/结束/时区（且合法）才出现，样式同 Where 栏的地图链接。
                "Add to calendar" 是动作不是导航，所以用按钮（套链接样式） */}
            {calOk && <button type="button" onClick={addToCalendar} style={{ alignSelf: 'center', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: `700 12px ${FONT.sans}`, color: '#5B84AE' }}>Add to calendar</button>}
            {calOk && <a href={gcalUrl} target="_blank" rel="noopener" style={{ font: `700 12px ${FONT.sans}`, color: '#5B84AE' }}>Google Calendar ↗</a>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ font: `700 10px ${FONT.sans}`, letterSpacing: '.18em', color: '#9AA3B2', textTransform: 'uppercase' }}>Time</div>
            <div style={{ font: `600 17px ${FONT.serif}`, color: '#3D4A5C' }}>{event.timeLabel}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ font: `700 10px ${FONT.sans}`, letterSpacing: '.18em', color: '#9AA3B2', textTransform: 'uppercase' }}>Where</div>
            <div style={{ font: `600 17px ${FONT.serif}`, color: '#3D4A5C' }}>{event.venueName}</div>
            {event.mapsUrl && <a href={event.mapsUrl} target="_blank" rel="noopener" style={{ font: `700 12px ${FONT.sans}`, color: '#5B84AE' }}>Open in Google Maps ↗</a>}
          </div>
        </div>
        {/* RSVP + View Registry 按钮组 */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
          <Hover as="button" onClick={openRsvp} disabled={rsvpClosed} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '14px 34px', font: `700 15px ${FONT.sans}`, cursor: rsvpClosed ? 'default' : 'pointer', opacity: rsvpClosed ? 0.6 : 1, letterSpacing: '.02em', boxShadow: '0 8px 20px rgba(91,132,174,.3)' }} hover={rsvpClosed ? null : { background: '#47709A' }}>{rsvpCta}</Hover>
          <Hover as={Link} to="/registry" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: '#5B84AE', border: '1.5px solid #A9C7E4', borderRadius: '999px', padding: '13px 30px', font: `700 15px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#EAF2F9' }}>View Registry</Hover>
        </div>
        <div style={{ font: `600 12.5px ${FONT.sans}`, color: '#9AA3B2' }}>{rsvpNote}</div>
      </div>
    </div>
  );
}
