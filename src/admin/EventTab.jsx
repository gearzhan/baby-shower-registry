import { useRef } from 'react';
import { useStore, StoreCtx } from '../store.jsx';
import { FocusInput } from '../components/ui.jsx';
import { FONT } from '../theme.js';
import GardenCard from '../pages/themes/GardenCard.jsx';
import SkyCard from '../pages/themes/SkyCard.jsx';
import WisteriaCard from '../pages/themes/WisteriaCard.jsx';
import RegistryHeader from '../components/RegistryHeader.jsx';
import EmailContentPreview from '../components/EmailContentPreview.jsx';
import { addMinutesLocal, cleanLocal, cleanTz } from '../../functions/lib/calendar.js';

// 时区下拉的候选：浏览器支持的全部 IANA 时区。Node/V8 的列表里没有 'UTC'（下面单独补上）；
// 老 Safari（< 15.4）没有 supportedValuesOf，退化为只列当前值、本机时区和 UTC
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
// 主人浏览器所在时区：首次填"开始"时自动带上。先过一遍与服务端相同的 cleanTz ——
// 个别环境会报出 '+05:30' 这类偏移写法，服务端会 400，那就宁可不自动填
const LOCAL_TZ = (() => { try { return cleanTz(Intl.DateTimeFormat().resolvedOptions().timeZone) || ''; } catch { return ''; } })();

// 活动信息标签页（原型 TAB: EVENT 移植 + 三块宾客可见文案的编辑与实时预览）。
// 设计主旨："每条消息都以宾客真正收到的载体预览"—— 邀请卡在手机壳里、
// 登记页头部是页面片段、邮件带信头 chrome；载体本身即说明正在编辑什么。
export default function EventTab() {
  const store = useStore();
  const { event, onEventField, theme, bgMediaFor, calOk } = store;

  // 字段定义：k 对应 event 的键，label 为字段标题
  const fields = [
    { k: 'hosts', label: 'Hosts' },
    { k: 'baby', label: 'Baby name' },
    { k: 'dateLabel', label: 'Date' },
    { k: 'timeLabel', label: 'Time' },
    { k: 'venueName', label: 'Venue / suburb' },
    { k: 'mapsUrl', label: 'Google Maps link' },
    { k: 'rsvpBy', label: 'RSVP by' },
  ];

  // 输入框与文本域共用的基础样式（聚焦高亮见 focus 属性）
  const inputStyle = { width: '100%', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: `600 14.5px ${FONT.sans}`, color: '#3D4A5C', background: '#FFFFFF', outline: 'none' };
  const labelSpan = { font: `700 11px ${FONT.sans}`, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A94A6' };
  const focusRing = { borderColor: '#A9C7E4', boxShadow: '0 0 0 3px rgba(169,199,228,.25)' };
  const textareaStyle = { ...inputStyle, font: `600 14.5px/1.5 ${FONT.sans}`, resize: 'vertical' };
  // 两个欢迎语文本域下方的 Markdown 语法提示(与下方邮件预览的灰字说明同款样式)
  const hintStyle = { font: `600 12px ${FONT.sans}`, color: '#9AA3B2' };

  // 卡片外壳与标题（与 DesignTab 同一节奏：一块关注点一张卡）
  const cardBox = { background: '#FFFFFF', border: '1px solid #EAE3D4', borderRadius: '20px', padding: 'clamp(20px,4vw,34px)' };
  const cardTitle = { font: `800 16px ${FONT.sans}`, marginBottom: '4px' };
  const cardSub = { font: `600 13px ${FONT.sans}`, color: '#9AA3B2', marginBottom: '22px' };
  // 预览眉标（与 DesignTab 的 Desktop/Phone 标签同款）
  const eyebrow = { font: `700 11px ${FONT.sans}`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8A94A6' };
  // 编辑列与消息卡行布局：编辑在左、载体预览在右，窄屏自动换行
  const editorCol = { flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '7px' };
  const row = { display: 'flex', gap: '26px', flexWrap: 'wrap', alignItems: 'flex-start' };

  // 当前主题的展示名与邀请卡组件：眉标注明正在预览哪个主题（换主题在 Design 标签页）
  const themeName = theme === 'sky' ? 'Dreamy Sky' : theme === 'garden' ? 'Garden Card' : 'Wisteria Ink';
  const Card = theme === 'sky' ? SkyCard : theme === 'garden' ? GardenCard : WisteriaCard;

  // 加入日历：当前值放最前（哪怕不在列表里也能显示），其后本机时区、UTC、全部时区（Set 去重）
  const zones = [...new Set([event.tz, LOCAL_TZ, 'UTC', ...ZONES].filter(Boolean))];
  // 两个 datetime-local 都设了 max：没有它，Chrome 的年份段会一直吃数字（'20271-03-14T13:00'）。
  // 处理函数里再兜一层：cleanLocal 判为非法（null）的值一律不写 —— 受控输入随即回到旧值。
  // 否则服务端回 400，而之后每次改任何文字标签都会带着这个坏值整份 PUT，全部存不进去
  const LOCAL_MAX = '9999-12-31T23:59';
  // 选开始时间：没时区就带上本机时区。结束怎么跟（这是对设计稿"只在结束为空或不晚于开始时才补"的有意改进）：
  // - 原开始/结束都合法且结束晚于开始 → 结束随开始整体平移、时长不变（日历软件的通行做法）。
  //   Chrome 逐段输入会发出中间值：12 小时制下把 1 PM 的小时改成 10，先发 22:00、选 AM 才变 10:00；
  //   月/日/时打前导 0（'07'）时先发一个 ''。平移逐次累加，最终仍是原时长 —— 只往后推、不往回拉的旧规则
  //   会把结束留在次日凌晨或一周之后
  // - 否则（首次填写、结束为空/不晚于开始）→ 结束 = 开始 + 3 小时
  // 开始被清空时把清空前的开始记在 clearedStart 里，下一次填回来照样按它平移；主人动过"结束"就作废。
  // 算出来的结束若越界（如超出 9999 年）就不写，宁可留给提示，也不能让服务端 400 卡住整份保存。
  // 多次 onEventField 仍只合成一次防抖 PUT（回调读 dataRef 的最新整份 event）；
  // 这里读渲染闭包里的旧 event 是对的：每次按键都是独立事件，React 会在下一次之前提交上一次的更新
  const clearedStart = useRef('');
  const onStart = (v) => {
    const s1 = cleanLocal(v);
    if (s1 === null) return;
    const s0 = cleanLocal(event.startsAt) || clearedStart.current, e0 = cleanLocal(event.endsAt);
    onEventField('startsAt', s1);
    clearedStart.current = s1 ? '' : s0; // 清空：结束原样保留，只记下清空前的开始
    if (!s1) return;
    if (!event.tz && LOCAL_TZ) onEventField('tz', LOCAL_TZ);
    const end = s0 && e0 && e0 > s0
      ? addMinutesLocal(e0, (Date.parse(s1 + ':00Z') - Date.parse(s0 + ':00Z')) / 60000)
      : !e0 || e0 <= s1 ? addMinutesLocal(s1, 180) : '';
    if (cleanLocal(end)) onEventField('endsAt', end);
  };
  const onEnd = (v) => {
    const e = cleanLocal(v);
    if (e === null) return;
    clearedStart.current = '';
    onEventField('endsAt', e);
  };
  // 同格式的本地时间字符串按字典序比较即按时间先后。结束不晚于开始：服务端照存，链接隐藏，这里给红字
  const calBad = !!(event.startsAt && event.endsAt && event.endsAt <= event.startsAt);
  const calPartial = !calOk && !calBad && !!(event.startsAt || event.endsAt || event.tz);
  // 已生效但跨度超过 24 小时：多半是结束没跟上（比如先清空开始、再填一个早得多的时间），提醒主人看一眼
  const calLong = calOk && Date.parse(cleanLocal(event.endsAt) + ':00Z') - Date.parse(cleanLocal(event.startsAt) + ':00Z') > 864e5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 卡 1：事实字段网格（欢迎语已移入下方"Invitation message"卡） */}
      <div style={cardBox}>
        <div style={cardTitle}>Event details</div>
        <div style={cardSub}>Shown on the invitation, registry and email. All changes save automatically.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '16px' }}>
          {fields.map((f) => (
            <label key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={labelSpan}>{f.label}</span>
              <FocusInput
                as="input"
                value={event[f.k]}
                onChange={(e) => onEventField(f.k, e.currentTarget.value)}
                style={inputStyle}
                focus={focusRing}
              />
            </label>
          ))}
        </div>
      </div>

      {/* 卡 2：加入日历的结构化时间（只给日历用；宾客读到的仍是上面的 Date / Time 文字） */}
      <div style={cardBox}>
        <div style={cardTitle}>Add to calendar</div>
        <div style={cardSub}>Lets guests save the date from the invitation. Leave blank to hide it — the Date and Time above are still what guests read.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <span style={labelSpan}>Starts</span>
            <FocusInput as="input" type="datetime-local" max={LOCAL_MAX} value={event.startsAt ?? ''} onChange={(e) => onStart(e.currentTarget.value)} style={inputStyle} focus={focusRing} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <span style={labelSpan}>Ends</span>
            <FocusInput as="input" type="datetime-local" max={LOCAL_MAX} value={event.endsAt ?? ''} onChange={(e) => onEnd(e.currentTarget.value)} style={inputStyle} focus={focusRing} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <span style={labelSpan}>Time zone</span>
            <FocusInput as="select" value={event.tz ?? ''} onChange={(e) => onEventField('tz', e.currentTarget.value)} style={inputStyle} focus={focusRing}>
              <option value="">Choose a time zone</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </FocusInput>
          </label>
        </div>
        {/* 四态提示：结束不晚于开始（红）/ 只填了一部分（灰）/ 已生效但超过 24 小时（红，仍生效）/ 已生效（灰） */}
        {calBad ? (
          <div style={{ font: `700 12.5px ${FONT.sans}`, color: '#C0715E', marginTop: '12px' }}>The end must be after the start.</div>
        ) : calLong ? (
          <div style={{ font: `700 12.5px ${FONT.sans}`, color: '#C0715E', marginTop: '12px' }}>This event runs over 24 hours — check the end. Guests already see “Add to calendar” on the invitation.</div>
        ) : calPartial ? (
          <div style={{ ...hintStyle, marginTop: '12px' }}>Fill in start, end and time zone to show the link.</div>
        ) : calOk ? (
          <div style={{ ...hintStyle, marginTop: '12px' }}>Guests now see “Add to calendar” and “Google Calendar ↗” on the invitation.</div>
        ) : null}
      </div>

      {/* 卡 3：邀请卡消息 + 手机壳实时预览（宾客几乎都在手机上打开邮件里的邀请） */}
      <div style={cardBox}>
        <div style={cardTitle}>Invitation message</div>
        <div style={cardSub}>A short line from you both, shown on the invitation card. Saves as you type.</div>
        <div style={row}>
          <label style={editorCol}>
            <span style={labelSpan}>Message</span>
            <FocusInput
              as="textarea"
              rows="4"
              value={event.welcome}
              onChange={(e) => onEventField('welcome', e.currentTarget.value)}
              style={textareaStyle}
              focus={focusRing}
            />
            <span style={hintStyle}>Formatting: **bold**, *italic*, [link](https://…) — blank line starts a new paragraph</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={eyebrow}>Live preview · {themeName}</div>
            {/* 手机壳比 DesignTab 的加高（500px）：保证三个主题的欢迎语——含 Wisteria 卡下那行——都落在框内。
                预览与真实主题卡同源；aria-hidden 因为它只是左侧编辑内容的复述 */}
            <div aria-hidden="true" style={{ width: '215px', height: '500px', overflow: 'hidden', borderRadius: '22px', border: '6px solid #3D4A5C', background: '#FFFFFF', boxShadow: '0 12px 30px rgba(61,74,92,.18)' }}>
              <div style={{ width: '390px', minHeight: '940px', transform: 'scale(.522)', transformOrigin: '0 0', pointerEvents: 'none' }}>
                {/* 与 DesignTab 同一手法：调用处内联 Provider 注入手机焦点，复用稳定的 Card 类型避免整棵重挂 */}
                <StoreCtx.Provider value={{ ...store, bgMediaEl: bgMediaFor(true) }}>
                  <Card />
                </StoreCtx.Provider>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 卡 4：登记页欢迎语 + 页面片段预览（与真实 /registry 头部共用 RegistryHeader，零漂移） */}
      <div style={cardBox}>
        <div style={cardTitle}>Registry welcome</div>
        <div style={cardSub}>Greets guests at the top of the gift registry. Saves as you type.</div>
        <div style={row}>
          <label style={editorCol}>
            <span style={labelSpan}>Message</span>
            <FocusInput
              as="textarea"
              rows="4"
              value={event.registryWelcome ?? ''}
              onChange={(e) => onEventField('registryWelcome', e.currentTarget.value)}
              style={textareaStyle}
              focus={focusRing}
            />
            <span style={hintStyle}>Formatting: **bold**, *italic*, [link](https://…) — blank line starts a new paragraph</span>
          </label>
          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={eyebrow}>Live preview</div>
            <div aria-hidden="true" style={{ background: '#FBF8F2', border: '1px solid #E2DCCE', borderRadius: '14px', boxShadow: '0 10px 26px rgba(61,74,92,.10)', padding: '28px 18px' }}>
              <RegistryHeader />
            </div>
          </div>
        </div>
      </div>

      {/* 卡 5：邮件私人附言 + 信头 chrome 预览（正文与 Subject 出自发信用的同一份模板） */}
      <div style={cardBox}>
        <div style={cardTitle}>Invitation email</div>
        <div style={cardSub}>Add a personal note to the invitation email — leave it blank and the standard invitation goes out unchanged. Saves as you type.</div>
        <div style={row}>
          <label style={editorCol}>
            <span style={labelSpan}>Personal note</span>
            <FocusInput
              as="textarea"
              rows="4"
              value={event.emailMessage ?? ''}
              onChange={(e) => onEventField('emailMessage', e.currentTarget.value)}
              placeholder="e.g. We can't wait to celebrate with you."
              style={textareaStyle}
              focus={focusRing}
            />
          </label>
          <div style={{ flex: '1 1 340px', minWidth: 0, maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={eyebrow}>Live preview</div>
            <EmailContentPreview />
            <div style={{ font: `600 12px ${FONT.sans}`, color: '#9AA3B2' }}>Addressed to you for this preview — each guest receives their own name.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
