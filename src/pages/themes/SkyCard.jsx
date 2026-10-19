import { Link } from 'react-router';
import { useStore } from '../../store.jsx';
import { Hover } from '../../components/ui.jsx';
import Markdown from '../../components/Markdown.jsx';
import { FONT } from '../../theme.js';

// SKY 主题邀请卡（原型 THEME: SKY 区块移植）—— 满屏渐变天空 + 漂浮云朵占位
export default function SkyCard() {
  const { event, babyInitial, bgMediaEl, bgIsNone, bgDimSky, openRsvp, rsvpCta, rsvpClosed, rsvpNote, me, calOk, gcalUrl, addToCalendar } = useStore();
  // 日期行下那排白色下划线小链接（地图 / 加入日历 / Google 日历）共用的样式
  const skyLink = { color: '#FFFFFF', font: `700 13px ${FONT.sans}`, textDecoration: 'underline', opacity: '.9' };
  const skyHover = { color: '#FFFFFF', opacity: '1' };
  return (
    <div style={{ position: 'relative', minHeight: '100svh', overflow: 'hidden', background: 'linear-gradient(180deg,#BccFE6 0%,#DDEAF5 55%,#F2EFE6 100%)' }}>
      {bgMediaEl}
      {/* 暗化叠层：不透明度取自 bgDimSky */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(24,36,52,.30) 0%,rgba(24,36,52,.62) 100%)', opacity: bgDimSky, pointerEvents: 'none' }}></div>
      {bgIsNone && (
        <>
          {/* 漂浮云朵占位 */}
          <div style={{ position: 'absolute', left: '8%', top: '14%', width: '180px', height: '56px', borderRadius: '999px', background: 'rgba(255,255,255,.55)', filter: 'blur(2px)', animation: 'bsFloat 9s ease-in-out infinite' }}></div>
          <div style={{ position: 'absolute', right: '10%', top: '26%', width: '230px', height: '68px', borderRadius: '999px', background: 'rgba(255,255,255,.45)', filter: 'blur(3px)', animation: 'bsFloat 11s ease-in-out infinite' }}></div>
          <div style={{ position: 'absolute', left: '16%', bottom: '18%', width: '150px', height: '48px', borderRadius: '999px', background: 'rgba(255,255,255,.4)', filter: 'blur(2px)', animation: 'bsFloat 8s ease-in-out infinite' }}></div>
          {/* 这句是给主人看的操作提示，宾客不该看到"Host Dashboard"这几个字 */}
          {me?.isHost && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '14px', textAlign: 'center', font: '600 10.5px ui-monospace,Menlo,monospace', color: 'rgba(255,255,255,.75)' }}>background slot · add a photo or video in Host Dashboard → Design</div>
          )}
        </>
      )}
      {/* 内容层 */}
      <div style={{ position: 'relative', minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '100px 20px 70px', color: '#FFFFFF', textShadow: '0 2px 22px rgba(20,32,48,.45)' }}>
        <div style={{ width: '52px', height: '52px', borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 23px ${FONT.serif}`, marginBottom: '26px', background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(4px)' }}>{babyInitial}</div>
        <div style={{ font: `700 12px ${FONT.sans}`, letterSpacing: '.34em', textTransform: 'uppercase', opacity: '.95' }}>Please join us for a</div>
        <div style={{ font: `500 clamp(52px,10vw,96px)/1.02 ${FONT.serif}`, margin: '10px 0 14px' }}>Baby Shower</div>
        <div style={{ font: `italic 500 clamp(18px,3.4vw,24px) ${FONT.serif}`, opacity: '.95' }}>honouring {event.hosts} · awaiting {event.baby}</div>
        {/* 欢迎语：白色斜体衬线，40ch 控行长保证满幅照片上可读；为空整行不渲染 */}
        {event.welcome && (
          <div style={{ font: `italic 500 clamp(15px,2.6vw,18px)/1.6 ${FONT.serif}`, opacity: '.95', maxWidth: '40ch', marginTop: '14px' }}><Markdown text={event.welcome} /></div>
        )}
        {/* 日期 · 时间 · 地点 单行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', justifyContent: 'center', margin: '30px 0 8px', font: `600 16px ${FONT.sans}` }}>
          <span>{event.dateLabel}</span>
          <span style={{ opacity: '.6' }}>·</span>
          <span>{event.timeLabel}</span>
          <span style={{ opacity: '.6' }}>·</span>
          <span>{event.venueName}</span>
        </div>
        {/* 地图 + 加入日历 一行居中、可换行。没填地图链接就不渲染它（空 href 会跳回本页）；
            日历两项只在 calOk 时出现。行本身总在，全空时也保留同样的下边距，版式不变。
            按钮要 textShadow: 'inherit'：浏览器默认样式会清掉按钮的文字阴影，照片上的白字靠它才看得清 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '34px' }}>
          {event.mapsUrl && <Hover as="a" href={event.mapsUrl} target="_blank" rel="noopener" style={skyLink} hover={skyHover}>Open in Google Maps ↗</Hover>}
          {calOk && <Hover as="button" type="button" onClick={addToCalendar} style={{ ...skyLink, background: 'none', border: 0, padding: 0, cursor: 'pointer', textShadow: 'inherit' }} hover={skyHover}>Add to calendar</Hover>}
          {calOk && <Hover as="a" href={gcalUrl} target="_blank" rel="noopener" style={skyLink} hover={skyHover}>Google Calendar ↗</Hover>}
        </div>
        {/* RSVP + View Registry 按钮组 */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Hover as="button" onClick={openRsvp} disabled={rsvpClosed} style={{ display: 'inline-flex', alignItems: 'center', background: '#FFFFFF', color: '#3D4A5C', border: 'none', borderRadius: '999px', padding: '14px 36px', font: `700 15px ${FONT.sans}`, cursor: rsvpClosed ? 'default' : 'pointer', opacity: rsvpClosed ? 0.6 : 1, boxShadow: '0 10px 30px rgba(20,32,48,.3)' }} hover={rsvpClosed ? null : { background: '#EAF2F9' }}>{rsvpCta}</Hover>
          <Hover as={Link} to="/registry" style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,.14)', color: '#FFFFFF', border: '1.5px solid rgba(255,255,255,.7)', borderRadius: '999px', padding: '13px 32px', font: `700 15px ${FONT.sans}`, backdropFilter: 'blur(6px)' }} hover={{ background: 'rgba(255,255,255,.26)', color: '#FFFFFF' }}>View Registry</Hover>
        </div>
        <div style={{ font: `600 12.5px ${FONT.sans}`, opacity: '.85', marginTop: '18px' }}>{rsvpNote}</div>
      </div>
    </div>
  );
}
