import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { enrichItem, babyInitialOf, hasExternalImg, downloadFile, EMAIL_RE } from './util.js';
import { guestsCsv, registryCsv, csvDate } from './csv.js';
import { api, errText } from './api.js';
import { useAuth } from './useAuth.js';
// 与服务端 admin/event.js 共用的纯模块（同 EmailContentPreview → email-templates.js 的做法）：校验与 calOk 永远一致
import { calendarTimes, buildIcs, googleCalendarUrl } from '../functions/lib/calendar.js';
import { FONT } from './theme.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 时间戳 → 主人本地时间的 DD/MM（后台宾客行的 "Reminded 13/10"）。本地时间读法，同 csv.js 的 csvDate；空值/非法值返回 ''
const dayMonth = (ms) => {
  const d = new Date(ms);
  return !ms || isNaN(d.getTime()) ? '' : String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
};

// 全站状态中枢：移植自原型 Component 的 state + renderVals + 事件处理。
// 数据来源：挂载时先问 /api/me（永远 200：guest 为 null 就是"没登录"），登录了才去拉
// 活动/设计/礼物 —— 全站在登录后面，未登录只有落地页。
// 各组件只认这里的 useStore() 契约（见 .reference/PORTING.md）。

// 导出 Context 本身：后台设计页要用嵌套 Provider 覆盖 bgMediaEl，
// 好让手机预览框按 pX/pY 渲染（组件本身只认真实视口宽度）。
export const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);

// 轻量加载态
function Loader() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `italic 500 22px ${FONT.serif}`, color: '#8A94A6' }}>
      Loading…
    </div>
  );
}

// 启动失败（接口不可达）。这里绝不能回退到一份假数据 —— 从前的 mock.js 把真实日期/地点
// 打进了前端产物，等于把整道门白设了；而且给宾客渲染一个"看起来对、其实是编的"日期，
// 比老实报错更糟。
function BootError({ onRetry }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', background: '#FBF8F2', padding: '24px', textAlign: 'center' }}>
      <div style={{ font: `italic 500 22px ${FONT.serif}`, color: '#8A94A6' }}>We couldn’t load the invitation.</div>
      <button
        onClick={onRetry}
        style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '12px 28px', font: `700 14px ${FONT.sans}`, cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  );
}

// 未登录时的安全空壳（只有 teaser：主人名 + 宝宝名，落地页就靠这两个字段）
const EMPTY_DATA = { event: {}, design: { theme: 'garden', bg: {} }, config: {}, guests: [], items: [] };

export function StoreProvider({ children }) {
  const auth = useAuth();
  const { me, setMe, myRsvp, setMyRsvp, handle401 } = auth;

  const [dataState, setData] = useState(null);
  const data = dataState || EMPTY_DATA;
  // 始终指向最新 data，供异步/防抖回调读取，避免闭包读到过期快照
  const dataRef = useRef(data);
  dataRef.current = data;
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [narrow, setNarrow] = useState(false); // 是否窄屏（手机）——决定背景焦点用 pX/pY 还是 dX/dY

  // 监听窄屏，切换背景焦点
  useEffect(() => {
    const mq = window.matchMedia('(max-width:700px)');
    const on = () => setNarrow(mq.matches);
    on();
    try { mq.addEventListener('change', on); } catch { mq.addListener(on); }
    return () => { try { mq.removeEventListener('change', on); } catch { mq.removeListener(on); } };
  }, []);

  // 标签页标题跟随主人名：index.html 只放通用的 "Baby Shower"，不把任何人名打进构建产物
  const hostsLabel = data.event.hosts;
  useEffect(() => {
    document.title = hostsLabel ? 'Baby Shower · ' + hostsLabel : 'Baby Shower';
  }, [hostsLabel]);

  // 登录后的数据（活动/设计/配置 + 礼物含认领态）
  const loadGuestData = async () => {
    const [pub, reg] = await Promise.all([api.getPublic(), api.getRegistry()]);
    setData({
      event: pub.event,
      design: pub.design,
      config: reg.config || pub.config,
      guests: [], // 宾客/RSVP 只在后台加载
      items: reg.items,
    });
  };

  // 启动：一次 /api/me 决定一切
  const boot = async () => {
    setBootError(false);
    try {
      const r = await api.getMe();
      if (r.guest) {
        setMe(r.guest);
        setMyRsvp(r.rsvp || null);
        await loadGuestData();
      } else {
        setMe(null);
        setMyRsvp(null);
        setData({ ...EMPTY_DATA, event: { hosts: r.teaser.hosts, baby: r.teaser.baby } });
      }
    } catch (e) {
      setBootError(true);
    } finally {
      setBooted(true);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => { await boot(); if (!alive) return; })();
    return () => { alive = false; };
  }, []);

  // 登录：先把宾客数据拉齐，再由 useAuth 亮出身份（见 useAuth.verifyCode 的 afterVerify）——
  // 否则 "/" 会先用未登录空壳渲染一帧 EMPTY_DATA 主题的空卡，再跳成站点真正的主题。
  // 回调自己吞掉错误：抛出去会被 useAuth 当成"验证码不对"。拉取失败照旧亮 BootError（Try again → boot() 凭 cookie 重拉）
  const verifyCode = () => auth.verifyCode(async () => {
    try { await loadGuestData(); } catch (e) { setBootError(true); }
  });

  // 登出：清身份 + 把 data 退回只剩 teaser，落地页立刻能渲染，不必再跑一次网络
  const signOut = async () => {
    await auth.signOut();
    setData({ ...EMPTY_DATA, event: { hosts: dataRef.current.event.hosts, baby: dataRef.current.event.baby } });
  };

  // ---- UI 状态（不进 data）----
  const [toast, setToastState] = useState('');
  const toastTimer = useRef(null);
  const showToast = (m) => {
    setToastState(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(''), 2800);
  };

  // registry 筛选与礼物弹窗
  const [filter, setFilter] = useState('all');
  const [giftId, setGiftId] = useState(null);
  const [claimErr, setClaimErr] = useState('');

  // RSVP 弹窗（登录后只剩 form|done —— 邮箱/验证码两步搬到落地页了）
  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [rsvpStep, setRsvpStep] = useState('form');
  const [rsvpErr, setRsvpErr] = useState('');
  const [rsvpGuestId, setRsvpGuestId] = useState(null);
  const [attending, setAttending] = useState('yes');
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);
  const [dietary, setDietary] = useState('');
  const [allergies, setAllergies] = useState('');
  const [rsvpAdminMode, setRsvpAdminMode] = useState(false); // 主人代填模式
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [adminLoaded, setAdminLoaded] = useState(false); // 后台数据是否已加载

  // 信封动画（落地页的主角；后台的邮件预览弹窗复用同一套状态）
  const [emailOpen, setEmailOpen] = useState(false);
  const [envOn, setEnvOn] = useState(false);
  const [flapZ, setFlapZ] = useState(4);
  const [envDone, setEnvDone] = useState(false); // 信封演完了（卡片已滑出）
  const flapTimer = useRef(null);
  const doneTimer = useRef(null);

  // 后台
  const [adminTab, setAdminTab] = useState('event');
  const [ngName, setNgName] = useState('');
  const [ngEmail, setNgEmail] = useState('');
  const [ngErr, setNgErr] = useState('');
  const [gf, setGf] = useState(null); // 宾客编辑表单 {id,name,email,origName,origEmail,emailLocked,rsvpBySelf,claims} | null
  const [guestErr, setGuestErr] = useState(''); // 宾客编辑弹窗里的错误行（409/403/404 等留在弹窗里显示）
  const [savingGuest, setSavingGuest] = useState(false); // 宾客保存中（按钮禁用样式；真正的闸门是 savingGuestRef）
  const [ef, setEf] = useState(null); // 礼物编辑表单
  const [editErr, setEditErr] = useState('');
  const [savingItem, setSavingItem] = useState(false); // 礼物保存中（仅用于按钮禁用样式）
  const [claimBusy, setClaimBusy] = useState(false); // 认领/撤销提交中
  const [adminError, setAdminError] = useState(false); // 后台数据加载失败
  // 真正的防重入闸门必须用 ref：setState 要等到下次渲染才生效，同一事件循环里的连点
  // 会读到同一份旧 state（disabled 属性同理还没打上去），照样把请求发出去两次。
  const claimBusyRef = useRef(false);
  const savingItemRef = useRef(false);
  const rsvpBusyRef = useRef(false);
  // 宾客操作的防连点（添加 / 单发邀请 / 群发）：连点会重复建宾客 / 重复发邮件
  const addingGuestRef = useRef(false);
  const sendingRef = useRef(false);
  const sendingAllRef = useRef(false);
  const savingGuestRef = useRef(false); // 宾客编辑保存中：防连点，且保存途中弹窗不可关（见 closeGuestEdit）
  const [addingGuest, setAddingGuest] = useState(false); // 添加宾客中（按钮禁用样式）
  const [sendingId, setSendingId] = useState(null); // 正在发邀请的宾客 id | null
  const [sendingAll, setSendingAll] = useState(false); // 群发中
  // 导出 CSV：同一时刻只出一个文件（两个标签页的按钮共用这一个标志）
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false); // 导出 CSV 中（按钮禁用样式；真正的闸门是 exportingRef）
  // 外链图转存 R2：单个和批量共用一道闸门 —— 同一时刻只发一个请求，因为每次成功都会整键重写 items，
  // 而 KV 同一个键每秒只允许写一次
  const rehostBusyRef = useRef(false);
  const [rehostingId, setRehostingId] = useState(null); // 正在转存的礼物 id | null
  const [rehostProgress, setRehostProgress] = useState(null); // 批量进度 {done,total} | null
  // 每件礼物最近一次转存失败 {itemId: {url, msg}}：url 是当时抓的那条链接（对外的 rehostErrs 按它过滤，见派生值）
  const [rehostFails, setRehostFails] = useState({});
  // 收货/致谢：每件礼物一条串行队列 {id: {chain, pending, lastWrite, base, shown, dead}}。
  // 同一件礼物的请求排队依次发（避免乱序写），不同礼物互不影响 —— 所以是按 id 的一组队列而不是单个标志。
  // 在途时再点不丢：乐观翻转立即生效，请求排在后面。不需要导出的 busy 状态。
  // 条目跑完也不删：lastWrite 要留着，上一个请求刚回来时的下一下点击也得等满 KV 的 1 秒同键写入间隔。
  const thanksQRef = useRef(new Map());
  // 本次编辑会话里上传但尚未保存的礼物图 R2 key。放弃编辑或换图时要清掉，避免 R2 堆孤儿。
  // 只清本会话上传的，绝不碰已持久化的 imgKey（那由后端在保存成功后清理）。
  const pendingImgKeys = useRef([]);

  // ---- 危险 / 不可撤回操作确认弹窗 ----
  // 一份通用 payload 驱动 ConfirmModal；四个破坏性操作 + RSVP 提醒群发（邮件发出去就收不回）都在 store 内部经 askConfirm 拦截，
  // 组件层只管调同名函数。askConfirm 不导出。
  const [confirm, setConfirm] = useState(null); // {title, message, confirmLabel, busyLabel, action} | null
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmBusyRef = useRef(false); // 防连点：同 savingItemRef 的理由
  const askConfirm = (opts) => setConfirm(opts);
  const closeConfirm = () => { if (confirmBusyRef.current) return; setConfirm(null); };
  const runConfirm = async () => {
    if (confirmBusyRef.current || !confirm) return;
    confirmBusyRef.current = true; setConfirmBusy(true);
    try { await confirm.action(); } // action 内部自己 try/catch + toast，故 finally 总能安全关弹窗
    finally { confirmBusyRef.current = false; setConfirmBusy(false); setConfirm(null); }
  };

  // ---- 数据写入助手 ----
  const upd = (fn) => {
    setData((prev) => {
      if (!prev) return prev;
      const d = JSON.parse(JSON.stringify(prev));
      fn(d);
      return d;
    });
  };

  // 后台数据加载（主人守卫内）：宾客(并入 RSVP) + 礼物(并入认领) + 活动/设计/配置。
  // block=true（进入后台时）：失败即整屏阻断；block=false（操作后的重新同步）：失败只提示，
  // 不把已经正常显示的后台替换成错误页 —— 群发成功后紧接一次抖动不该把整个面板打没。
  const loadAdmin = async ({ block = true } = {}) => {
    try {
      const ad = await api.admin.getAll();
      // 后台礼物只带 claimedById，不带 mine —— 在这里补回 mine/claimed，
      // 否则主人从 /admin 回到 /registry 时自己认领的礼物会被当成"别人认领的"，撤销按钮消失。
      const items = ad.items.map((it) => ({ ...it, claimed: !!it.claimedById, mine: !!me && it.claimedById === me.id }));
      setData((prev) => ({ ...(prev || EMPTY_DATA), event: ad.event, design: ad.design, config: ad.config, guests: ad.guests, items }));
      setAdminError(false);
      setAdminLoaded(true);
    } catch (e) {
      // 守卫未通过或接口错误：必须挡住后台界面。否则会拿公开数据冒充后台数据渲染
      // （宾客列表空、礼物显示 "Claimed by undefined"），主人对着假数据编辑，每次保存都 403。
      if (block) setAdminError(true);
      else showToast('Could not refresh — some info may be out of date.');
      setAdminLoaded(true);
    }
  };

  // 防抖保存（活动/设计/配置这类高频编辑）
  const saveTimers = useRef({});
  const debouncedSave = (key, fn) => {
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      // 会话过期（401）走登出重定向，别把它当成网络问题提示
      fn().catch((e) => { if (!handle401(e)) showToast('Could not save your changes — please check your connection.'); });
    }, 500);
  };

  const babyInitial = babyInitialOf(data.event.baby);

  // 加入日历：只有 startsAt/endsAt/tz 三项齐全、合法且结束晚于开始才显示链接（未登录时 event 只有 hosts/baby → false）。
  // 站点地址只取 origin + '/'，绝不用 location.href —— 邀请链接落地时地址栏可能带着 ?i=<邀请令牌>，
  // 而 .ics / Google 日程会被转发给别人
  const cal = useMemo(() => {
    const site = window.location.origin + '/';
    return { calOk: !!calendarTimes(data.event), gcalUrl: googleCalendarUrl(data.event, site) };
  }, [data.event]);

  // ================= 派生值 =================
  const derived = useMemo(() => {
    const { config } = data;
    const showPrices = config.showPrices !== false;
    const showNames = config.showClaimerNames === true;
    // 活动后收尾开关：缺失即开放（=== true）。这里只管 UI 外观，真正的闸门在服务端（423）
    const rsvpClosed = config.rsvpClosed === true;
    const registryClosed = config.registryClosed === true;

    // registry
    const all = data.items.map((it) => enrichItem(it));
    const open = all.filter((i) => !i.claimed);
    const claimedL = all.filter((i) => i.claimed);
    const regItems = filter === 'open' ? open : filter === 'claimed' ? claimedL : all;
    const gift = giftId ? all.find((i) => i.id === giftId) : null;
    const giftIsMine = !!gift && gift.mine;
    const giftClaimedLine = !gift || !gift.claimed
      ? ''
      : gift.mine
        ? 'You’re bringing this one'
        : showNames && gift.claimedBy
          ? 'Already claimed by ' + gift.claimedBy
          : 'Already claimed';

    // 后台礼物行（认领者姓名缺失时只说 Claimed，不要渲染出 "Claimed by undefined"）
    const itemRows = all.map((it) => ({
      ...it,
      statusLabel: it.claimed ? (it.claimedBy ? 'Claimed by ' + it.claimedBy : 'Claimed') : 'Available',
      stBg: it.claimed ? '#F0F6EC' : '#F4F1E9',
      stColor: it.claimed ? '#5F8A54' : '#8A94A6',
      extImg: hasExternalImg(it), // 还在外链别人的 https 图片（没有 R2 副本）→ 给 "Save image" 按钮
      // 主人专用的收货/致谢进度（只有 loadAdmin 拉来的后台数据才带 receivedAt/thankedAt）
      received: !!it.receivedAt,
      thanked: !!it.thankedAt,
    }));

    // 后台宾客行 + RSVP 汇总
    const guestRows = data.guests.map((g) => {
      let statusLabel = 'Not sent', chipBg = '#FBF4E8', chipColor = '#B08A4F';
      if (g.sentAt) { statusLabel = 'Invitation sent'; chipBg = '#EAF2F9'; chipColor = '#47709A'; }
      if (g.rsvp) {
        if (g.rsvp.attending === 'yes') { statusLabel = 'Attending'; chipBg = '#F0F6EC'; chipColor = '#5F8A54'; }
        else { statusLabel = 'Declined'; chipBg = '#F4F1E9'; chipColor = '#8A94A6'; }
      }
      let rsvpLine = '—';
      if (g.rsvp && g.rsvp.attending === 'yes') {
        rsvpLine = g.rsvp.adults + (g.rsvp.adults === 1 ? ' adult' : ' adults') + (g.rsvp.kids ? ', ' + g.rsvp.kids + (g.rsvp.kids === 1 ? ' child' : ' children') : '');
      } else if (g.rsvp) rsvpLine = 'Sends love, can’t make it';
      else if (g.sentAt) {
        // 发过 RSVP 提醒的待回复宾客注明最近一次的日期（remindedAt 由服务端 remind-all 写入，经 ...g 带过来）
        const rd = dayMonth(g.remindedAt);
        rsvpLine = 'Awaiting reply' + (rd ? ' · Reminded ' + rd : '');
      }
      return { ...g, statusLabel, chipBg, chipColor, rsvpLine, sendLabel: g.sentAt ? 'Resend' : 'Send' };
    });
    // 主人自己不算"待邀请/待回复"—— 他们被强制并入名单只是为了保住后台入口，不该被自己的群发邀请或计数波及
    const unsent = data.guests.filter((g) => !g.sentAt && !g.isHost).length;
    const yes = data.guests.filter((g) => g.rsvp && g.rsvp.attending === 'yes');
    const totAdults = yes.reduce((a, g) => a + (g.rsvp.adults || 0), 0);
    const totKids = yes.reduce((a, g) => a + (g.rsvp.kids || 0), 0);
    const totPending = data.guests.filter((g) => g.sentAt && !g.rsvp && !g.isHost).length;
    const notes = [];
    data.guests.forEach((g) => {
      if (g.rsvp && g.rsvp.attending === 'yes' && ((g.rsvp.dietary || '').trim() || (g.rsvp.allergies || '').trim())) {
        const parts = [];
        if ((g.rsvp.dietary || '').trim()) parts.push('Dietary: ' + g.rsvp.dietary.trim());
        if ((g.rsvp.allergies || '').trim()) parts.push('Allergies: ' + g.rsvp.allergies.trim());
        notes.push({ name: g.name, line: parts.join(' · ') });
      }
    });

    return {
      showPrices, showNames, rsvpClosed, registryClosed,
      all, open, claimedL, regItems, gift, giftClaimedLine, giftIsMine,
      itemRows, guestRows, unsent,
      totYes: yes.length, totAdults, totKids, totPending, notes,
      extImgCount: all.filter(hasExternalImg).length, // 批量转存按钮上的数字（从 data 派生，每成功一件自动减一）
    };
  }, [data, filter, giftId]);

  // 对外仍是 {itemId: msg}，但只留「这件礼物现在还外链着当时失败的那条链接」的条目：
  // 主人换了链接（本页 Save item，或别的标签页改了、loadAdmin 拉回来）、上传了照片，旧原因就不再显示 ——
  // 它说的是一条已经不在的链接；以后再粘回别的链接，也不会翻出那条旧错误。
  const rehostErrs = useMemo(() => {
    const out = {};
    data.items.forEach((it) => {
      const f = rehostFails[it.id];
      if (f && hasExternalImg(it) && (it.imgUrl || '').trim() === f.url) out[it.id] = f.msg;
    });
    return out;
  }, [data.items, rehostFails]);

  // ================= 背景媒体派生 =================
  const bg = data.design.bg || {};
  const hasBg = !!(bg.type && bg.type !== 'none' && bg.mediaKey);
  const bgUrl = hasBg ? '/api/media/' + bg.mediaKey : '';
  // 背景媒体工厂：按焦点模式（手机 pX/pY / 桌面 dX/dY）生成元素。
  // 独立成函数是为了让后台设计页的手机预览框能强制用手机焦点 —— 预览框只是个缩放的 div，
  // narrow 却来自真实视口宽度，两者对不上。
  const bgMediaFor = (isNarrow) => {
    if (!hasBg) return null;
    const x = isNarrow ? (bg.pX ?? 50) : (bg.dX ?? 50);
    const y = isNarrow ? (bg.pY ?? 50) : (bg.dY ?? 50);
    const st = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: x + '% ' + y + '%' };
    if (bg.type === 'image') return <img key={bgUrl} src={bgUrl} alt="" style={st} />;
    if (bg.type === 'video') return <video key={bgUrl} src={bgUrl} autoPlay muted loop playsInline style={st} />;
    return null;
  };
  const bgMediaEl = bgMediaFor(narrow);

  // ================= 操作 =================
  // registry / claim（身份来自会话，不再手输姓名）
  const openGift = (id) => { setGiftId(id); setClaimErr(''); };
  const closeGift = () => setGiftId(null);

  const confirmClaim = async () => {
    if (claimBusyRef.current) return;
    const id = giftId;
    if (!id || !me) return;
    const prev = dataRef.current.items.find((i) => i.id === id);
    if (!prev) return;
    // 清单已关闭：按钮本就不显示，这里只是兜底（服务端 423 才是真正的闸门）
    if (dataRef.current.config.registryClosed === true) return;
    claimBusyRef.current = true;
    setClaimBusy(true);
    setClaimErr('');
    // 乐观更新
    upd((d) => { const it = d.items.find((i) => i.id === id); if (it) { it.claimedBy = me.name; it.claimedAt = Date.now(); it.mine = true; } });
    try {
      await api.claim(id);
      showToast('Thank you — you’re bringing ' + prev.name + '!');
    } catch (e) {
      upd((d) => { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) d.items[i] = { ...prev }; }); // 回滚
      if (e.status === 423) {
        // 旧标签页：主人在我们加载之后关闭了清单 → 本地也翻成关闭态（按钮随之消失），Toast 显示服务端文案。
        // 不写 claimErr：弹窗里已有灰色的"清单已关闭"提示，再来一条红字就重复了
        upd((d) => { d.config.registryClosed = true; });
        showToast(errText(e));
      } else if (e.status === 409) {
        // 被别人抢先了：接口出于隐私不回传姓名，这里只标记为已认领（enrichItem 认 claimed===true）
        upd((d) => { const it = d.items.find((x) => x.id === id); if (it) it.claimed = true; });
        showToast('Oh! Someone just claimed this one.');
      } else if (!handle401(e)) {
        setClaimErr('Something went wrong — please try again.');
      }
    } finally {
      claimBusyRef.current = false;
      setClaimBusy(false);
    }
  };

  const unclaimGift = async () => {
    if (claimBusyRef.current) return;
    const id = giftId;
    if (!id) return;
    const prev = dataRef.current.items.find((i) => i.id === id);
    if (!prev) return;
    // 清单已关闭：撤销按钮本就不显示，这里只是兜底
    if (dataRef.current.config.registryClosed === true) return;
    claimBusyRef.current = true;
    setClaimBusy(true);
    setClaimErr('');
    upd((d) => {
      const it = d.items.find((i) => i.id === id);
      if (it) { delete it.claimedBy; delete it.claimedAt; it.claimed = false; it.mine = false; }
    });
    try {
      await api.unclaim(id);
      showToast('No problem — it’s open again.');
    } catch (e) {
      upd((d) => { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) d.items[i] = { ...prev }; }); // 回滚
      // 423：同 confirmClaim —— 旧标签页里清单已被关闭，翻本地开关 + Toast 服务端文案
      if (e.status === 423) { upd((d) => { d.config.registryClosed = true; }); showToast(errText(e)); }
      else if (e.status === 403 || e.status === 404) showToast('That gift isn’t yours to undo.');
      // 其余 4xx 显示服务端原话（如主人已标记收到 → 409 "This one’s locked in…"）；5xx/断网回落到通用文案
      else if (!handle401(e)) setClaimErr(errText(e));
    } finally {
      claimBusyRef.current = false;
      setClaimBusy(false);
    }
  };

  // RSVP（宾客已登录：直接进表单，并用他现有的答复预填 —— 这就是"回来改人数"这条需求）
  const prefillFrom = (pre) => {
    setAttending(pre?.attending || 'yes');
    setAdults(pre?.adults || 1);
    setKids(pre?.kids || 0);
    setDietary(pre?.dietary || '');
    setAllergies(pre?.allergies || '');
  };
  const openRsvp = () => {
    // RSVP 已关闭：按钮已禁用，这里兜底不开弹窗（主人代填走 openRecordRsvp，不受影响）
    if (dataRef.current.config.rsvpClosed === true) return;
    setRsvpAdminMode(false);
    prefillFrom(myRsvp || {});
    setRsvpStep('form');
    setRsvpErr('');
    setRsvpOpen(true);
  };
  const closeRsvp = () => setRsvpOpen(false);
  const bump = (field, delta) => {
    const min = field === 'adults' ? 1 : 0;
    const cur = field === 'adults' ? adults : kids;
    const v = Math.max(min, Math.min(12, cur + delta));
    if (field === 'adults') setAdults(v); else setKids(v);
  };
  const submitRsvp = async () => {
    if (rsvpBusyRef.current) return;
    const form = {
      attending,
      adults: attending === 'yes' ? adults : 0,
      kids: attending === 'yes' ? kids : 0,
      dietary, allergies,
    };
    rsvpBusyRef.current = true;
    setRsvpBusy(true);
    try {
      if (rsvpAdminMode) {
        // 主人代填：走后台接口，写入该宾客并乐观更新本地
        await api.admin.recordRsvp(rsvpGuestId, form);
        upd((d) => { const g = d.guests.find((x) => x.id === rsvpGuestId); if (g) g.rsvp = { ...form, at: Date.now(), byHost: true }; });
        // 主人代填的是自己那行时，同步刷新 myRsvp —— 否则回到邀请页会用默认值覆盖刚填的答复
        if (me && rsvpGuestId === me.id) setMyRsvp({ ...form, at: Date.now(), byHost: true });
        setRsvpOpen(false); showToast('RSVP recorded');
      } else {
        // 宾客：身份来自 cookie。用服务端夹紧后的记录更新本地 —— 若存本地表单，
        // "改成不来"时人数会被留成 3，下次再打开表单就把它复活了。
        const r = await api.rsvpSubmit(form);
        setMyRsvp(r.rsvp);
        setRsvpStep('done');
      }
    } catch (e) {
      // 旧标签页：主人已关闭 RSVP → 本地翻成关闭态（关掉弹窗后按钮即显示 'RSVPs closed'）；
      // 错误文案仍由下面的 errText 显示服务端原话。代填走后台接口，不会 423，这里只是防御
      if (e.status === 423 && !rsvpAdminMode) upd((d) => { d.config.rsvpClosed = true; });
      if (!handle401(e)) setRsvpErr(errText(e));
      else setRsvpOpen(false);
    } finally {
      rsvpBusyRef.current = false;
      setRsvpBusy(false);
    }
  };

  // 主人代填 RSVP（后台）：直接进入表单步骤，预填该宾客现有 RSVP
  const openRecordRsvp = (guestId) => {
    const g = data.guests.find((x) => x.id === guestId);
    if (!g) return;
    setRsvpAdminMode(true); setRsvpGuestId(guestId); prefillFrom(g.rsvp || {});
    setRsvpStep('form'); setRsvpErr(''); setRsvpOpen(true);
  };

  // 信封动画：翻盖 .65s → 卡片 .8s（延迟 .5s）= 约 1.3s 演完
  const envOpen = () => {
    if (envOn) return;
    setEnvOn(true);
    clearTimeout(flapTimer.current);
    clearTimeout(doneTimer.current);
    flapTimer.current = setTimeout(() => setFlapZ(1), 500);
    doneTimer.current = setTimeout(() => setEnvDone(true), 1400);
  };
  // 重播前要撤掉 envOpen 排的定时器，否则它们会在重播后把信封盖压回去 / 直接标记演完
  const envReplay = () => {
    clearTimeout(flapTimer.current);
    clearTimeout(doneTimer.current);
    setEnvOn(false); setFlapZ(4); setEnvDone(false);
  };
  // 跳过：直接到"已打开"的终态，不放动画（回访宾客 / prefers-reduced-motion）
  const envSkip = () => {
    clearTimeout(flapTimer.current);
    clearTimeout(doneTimer.current);
    setEnvOn(true); setFlapZ(1); setEnvDone(true);
  };
  // 后台的邮件预览弹窗
  const openEmail = () => { setEmailOpen(true); setEnvOn(false); setFlapZ(4); setEnvDone(false); };
  const closeEmail = () => setEmailOpen(false);

  // 后台：活动/设计/配置（本地即时更新 + 保存到后端；防抖回调从 dataRef 读最新状态，避免陈旧快照互相覆盖）
  const onEventField = (k, v) => {
    upd((d) => { d.event[k] = v; });
    // 400 现在只意味着日历字段格式不对 → 显示服务端原话。EventTab 已经挡掉了自己能发现的坏值（datetime-local 设了 max，
    // cleanLocal 判非法的不写入），剩下的多半是 Worker 的 ICU 不认的浏览器时区。
    // 401 / 断网照旧抛给 debouncedSave 的 handle401 / "检查网络"提示。只在活动保存这里收窄，
    // 不改全局 debouncedSave —— 否则 design 的 400 会把原始的 'bad_request' 弹给主人
    debouncedSave('event', () => api.admin.putEvent(dataRef.current.event).catch((e) => {
      if (e.status === 400) { showToast(errText(e)); return; }
      throw e;
    }));
  };
  // 下载 .ics：同步执行，留在点击手势里（iOS/Safari 只在用户手势内放行下载）；读 dataRef 而非渲染闭包
  const addToCalendar = () => {
    const ics = buildIcs(dataRef.current.event, window.location.origin + '/');
    if (ics) downloadFile('baby-shower.ics', ics, 'text/calendar;charset=utf-8');
  };
  // 注意：payload 一律从 dataRef.current 派生（upd 是 setState，调用后 ref 要到下次渲染才更新，
  // 所以必须在 upd 之前取），并在失败时回滚本地状态，避免 UI 与服务端长期不一致。
  const setTheme = (v) => {
    const prev = dataRef.current.design;
    const nextDesign = { ...prev, theme: v };
    upd((d) => { d.design.theme = v; });
    api.admin.putDesign(nextDesign).catch((e) => {
      // 仅当当前值仍是本次乐观设置的 v 时才回滚 —— 否则会覆盖掉期间又发生的更新
      if (dataRef.current.design.theme === v) upd((d) => { d.design.theme = prev.theme; });
      if (!handle401(e)) showToast('Could not save the theme.');
    });
  };
  const onSlider = (k, v) => {
    upd((d) => { d.design.bg[k] = v; });
    debouncedSave('design', () => api.admin.putDesign(dataRef.current.design));
  };
  // 开关：showPrices / showClaimerNames / rsvpClosed / registryClosed。
  // 只发改动的那一个键 —— 服务端按键合并，不会让旧快照里的其它键覆盖别的标签页刚改过的值
  const toggleConfig = (k) => {
    const prev = dataRef.current.config;
    const want = !prev[k];
    upd((d) => { d.config[k] = want; });
    api.admin.putConfig({ [k]: want }).catch((e) => {
      // 同理：值已被后续操作改动就不回滚，避免覆盖更新的状态
      if (dataRef.current.config[k] === want) upd((d) => { d.config[k] = prev[k]; });
      if (!handle401(e)) showToast('Could not save the setting.');
    });
  };

  // 背景媒体上传/移除（R2）
  const uploadBg = async (file) => {
    if (!file) return;
    const isVideo = (file.type || '').indexOf('video/') === 0;
    // 上传单独 try：失败只提示大小/上传错误，不动本地状态
    let r;
    try {
      r = await api.admin.uploadMedia(file, 'bg');
    } catch (e) {
      showToast(e.status === 413 ? 'That file is too large.' : 'Could not upload the file.');
      return;
    }
    // 从最新状态派生 payload 与回滚值 —— 不要在 setData 的 updater 里做副作用赋值，
    // 那依赖 React 的即时求值优化，且 StrictMode 会双调用。
    const prevBg = dataRef.current.design.bg;
    const oldKey = prevBg.mediaKey;
    const nextDesign = { ...dataRef.current.design, bg: { ...prevBg, type: isVideo ? 'video' : 'image', mediaKey: r.key } };
    upd((d) => { d.design.bg = nextDesign.bg; });
    try {
      await api.admin.putDesign(nextDesign);
      // 保存成功后再删被替换掉的旧背景，否则记录可能指向已删对象
      if (oldKey && oldKey !== r.key) api.admin.deleteMedia(oldKey).catch(() => {});
      showToast(isVideo ? 'Background video updated' : 'Background photo updated');
    } catch (e) {
      upd((d) => { d.design.bg = prevBg; }); // 回滚本地
      api.admin.deleteMedia(r.key).catch(() => {}); // 清理孤儿对象
      showToast('Could not save the background.');
    }
  };
  // 真正执行删除背景（确认后才走到这里）
  const doRemoveBg = async () => {
    // 从最新状态派生（不用渲染闭包的 data），与 uploadBg 一致
    const prevBg = dataRef.current.design.bg;
    const oldKey = prevBg.mediaKey;
    const nextBg = { ...prevBg, type: 'none', mediaKey: '' };
    const nextDesign = { ...dataRef.current.design, bg: nextBg };
    upd((d) => { d.design.bg = nextBg; });
    try {
      await api.admin.putDesign(nextDesign);
      if (oldKey) api.admin.deleteMedia(oldKey).catch(() => {});
      showToast('Background removed');
    } catch (e) {
      // 仅当背景仍是本次乐观设置的"无背景"时才回滚 —— 否则会覆盖掉期间成功上传的新背景
      const cur = dataRef.current.design.bg;
      if (cur.type === 'none' && !cur.mediaKey) upd((d) => { d.design.bg = prevBg; });
      showToast('Could not remove the background.');
    }
  };
  // 删除背景先确认（R2 对象删了就没了）；DesignTab 的按钮仍然直接调 removeBg，零改动
  const removeBg = () => askConfirm({
    title: 'Remove the background?',
    message: 'The background photo/video will be deleted and the invitation will use the soft default.',
    confirmLabel: 'Remove background', busyLabel: 'Removing…',
    action: doRemoveBg,
  });
  // 礼物图片上传（R2）：写入编辑表单的 imgKey + 预览
  const uploadItemImg = async (file) => {
    if (!file) return;
    try {
      const r = await api.admin.uploadMedia(file, 'item', (ef && ef.id) || '');
      pendingImgKeys.current.push(r.key); // 记为待清理；保存/取消时按最终结果决定删哪些
      // 弹窗可能在上传期间被关掉（ef 变 null）——此时不要把它凭空复活成一个空表单
      setEf((prev) => (prev ? { ...prev, imgKey: r.key, imgUrl: '', imgPreview: '/api/media/' + r.key } : prev));
    } catch (e) {
      showToast(e.status === 413 ? 'That image is too large.' : 'Could not upload the image.');
    }
  };

  // 后台：宾客
  const addGuest = async () => {
    if (addingGuestRef.current) return; // 防连点：连点两次会创建两条宾客记录
    const n = ngName.trim(), em = ngEmail.trim().toLowerCase();
    // 与后端同一条邮箱形状校验：拦住 a@b / anne@ / "john smith@x.com" 这类会永远发不出去的地址
    if (!n || !EMAIL_RE.test(em)) { setNgErr('A name and a valid email are needed.'); return; }
    addingGuestRef.current = true;
    setAddingGuest(true);
    try {
      const r = await api.admin.addGuest(n, em);
      upd((d) => { d.guests.push({ ...r.guest, rsvp: null }); });
      setNgName(''); setNgEmail(''); setNgErr('');
      showToast(n + ' added to the guest list');
    } catch (e) {
      setNgErr(errText(e, 'Could not add guest.'));
    } finally {
      addingGuestRef.current = false;
      setAddingGuest(false);
    }
  };
  const guestAct = async (id, act) => {
    // 改名 / 改错邮箱：打开宾客编辑弹窗，不走确认弹窗（不是破坏性操作；而且确认弹窗"报错走 toast、然后必关"的约定
    // 会丢掉 409/403/404 的行内错误）。表单从 dataRef 现取，同步完成，不需要防连点。
    if (act === 'edit') {
      // 发信进行中不开：发信结束时会重读再整键写回 guests，可能把这次修改（连同会话吊销）盖掉。按钮已禁用，这里兜底
      if (sendingAllRef.current || sendingId === id) return;
      const d = dataRef.current;
      const g = d.guests.find((x) => x.id === id);
      if (!g) return;
      setGf({
        id: g.id, name: g.name || '', email: g.email || '',
        origName: g.name || '', origEmail: (g.email || '').trim().toLowerCase(),
        // 主人（及 host-* 行）的邮箱只能在站点配置里改：输入框禁用，服务端也 403
        emailLocked: !!g.isHost || String(g.id).startsWith('host-'),
        // 改邮箱时提醒主人：旧地址那边已经有人用这位宾客的身份回复过 / 认领过（主人代填的 RSVP 不算）
        rsvpBySelf: !!(g.rsvp && !g.rsvp.byHost),
        claims: d.items.filter((it) => it.claimedById === g.id).length,
      });
      setGuestErr('');
      return;
    }
    if (act === 'send') {
      // 防连点：连点会给同一位宾客重复发邮件；群发进行中也不发 —— 未发送的人正被群发覆盖，单发会让他收到两封
      if (sendingRef.current || sendingAllRef.current) return;
      sendingRef.current = true;
      setSendingId(id);
      try {
        const r = await api.admin.sendInvite(id);
        // 邮箱从 dataRef 取，不能在 upd（setState）的 updater 里赋值再读 —— 那个 updater 是延迟执行的
        const em = (dataRef.current.guests.find((x) => x.id === id) || {}).email || '';
        upd((d) => { const g = d.guests.find((x) => x.id === id); if (g) g.sentAt = Date.now(); });
        // 信寄出了但没能记进名单（与群发同一提示）：别马上重发，否则对方收到两封
        showToast(r && r.stampFailed ? 'Sent to ' + em + ', but the list couldn’t be updated — please don’t resend today' : 'Invitation sent to ' + em);
      } catch (e) {
        // 409：发信期间邮箱被改了（另一个标签页 / 另一位主人），服务端没记"已发送" —— 显示服务端文案，
        // 并非阻断地重新同步，好让行上的邮箱和下一次的 "Invitation sent to …" 是新地址。
        // 其它状态仍用通用文案：sendInvite 的 404 回的是裸 'not_found'
        if (e.status === 409) { showToast(errText(e, 'Could not send invitation.')); loadAdmin({ block: false }); }
        else showToast('Could not send invitation.');
      }
      finally {
        sendingRef.current = false;
        setSendingId(null);
      }
    }
    if (act === 'remove') {
      // 先确认再删：后端会级联删掉该宾客的 RSVP 和所有认领记录，不可恢复
      const g = dataRef.current.guests.find((x) => x.id === id) || {};
      const gName = g.name || 'This guest';
      // 他认领的礼物里已标记"收到"的件数：收货/致谢进度挂在认领上，会跟着一起删，先让主人知道
      const recN = dataRef.current.items.filter((x) => x.claimedById === id && x.receivedAt).length;
      askConfirm({
        title: 'Remove this guest?',
        message: gName + ' will be removed from the guest list, along with their RSVP and any gifts they claimed'
          + (recN ? ' — including ' + recN + (recN === 1 ? ' gift' : ' gifts') + ' you’ve marked received.' : '.'),
        confirmLabel: 'Remove guest', busyLabel: 'Removing…',
        action: async () => {
          try {
            await api.admin.removeGuest(id);
            // 本地照服务端的级联：他持有的认领（连同收货/致谢进度）已被删掉，礼物行要立刻变回 Available，
            // 否则计数行和 ✓ Received 会一直挂着直到刷新。只按 claimedById 匹配 —— 老格式认领没有 guestId，服务端也不会删
            upd((d) => {
              d.guests = d.guests.filter((x) => x.id !== id);
              d.items.forEach((x) => {
                if (x.claimedById === id) { delete x.claimedBy; delete x.claimedAt; delete x.claimedById; delete x.receivedAt; delete x.thankedAt; x.claimed = false; x.mine = false; }
              });
            });
            showToast(gName + ' removed from the guest list');
          } catch (e) { showToast(errText(e, 'Could not remove guest.')); }
        },
      });
    }
  };
  // 宾客编辑弹窗
  const onGuestField = (k, v) => setGf((p) => (p ? { ...p, [k]: v } : p));
  // 保存途中一律不关（遮罩 / ✕ / Cancel / Escape 都走这里）—— 同 closeConfirm。
  // 否则中途关掉再打开另一位宾客，前一次保存成功时的 setGf(null) 会把后一位的表单关掉
  const closeGuestEdit = () => { if (savingGuestRef.current) return; setGf(null); };
  const saveGuest = async () => {
    if (savingGuestRef.current || !gf) return; // 防连点
    const n = gf.name.trim(), em = gf.email.trim().toLowerCase();
    if (!n || !EMAIL_RE.test(em)) { setGuestErr('A name and a valid email are needed.'); return; }
    // 什么都没改：直接关，不发请求
    if (n === gf.origName && em === gf.origEmail) { setGf(null); return; }
    savingGuestRef.current = true;
    setSavingGuest(true);
    setGuestErr('');
    try {
      const r = await api.admin.editGuest(gf.id, { name: n, email: em });
      const g = r.guest;
      upd((d) => {
        const x = d.guests.find((y) => y.id === g.id);
        if (x) {
          x.name = g.name; x.email = g.email; x.sentAt = g.sentAt; x.sv = g.sv;
          // 改邮箱时服务端删掉了 remindedAt：本地也删，否则行上会显示一封从没寄到新地址的 "Reminded …"
          if (g.remindedAt) x.remindedAt = g.remindedAt; else delete x.remindedAt;
        }
        // 认领者姓名服务端按 guestId 现查；本地照着改，Registry 标签页立刻显示 "Claimed by <新名字>"。
        // 老格式认领没有 guestId（claimedById 为 ''），服务端也不改它们的名字，这里同样不碰
        d.items.forEach((it) => { if (it.claimedById === g.id && it.claimedBy) it.claimedBy = g.name; });
      });
      // 主人给自己改名：头部胶囊、"Hi, …"、邮件预览里的 "Dear …" 立刻跟着变。函数式更新，不读 await 之前的 me 闭包
      setMe((p) => (p && p.id === g.id ? { ...p, name: g.name } : p));
      // 先放闸再关：直接 setGf(null)，不走 closeGuestEdit（那里保存中会提前 return）
      savingGuestRef.current = false;
      setGf(null);
      showToast(r.emailChanged ? 'Saved — send the invitation to the new address' : 'Guest updated');
    } catch (e) {
      if (handle401(e)) setGf(null);
      else setGuestErr(errText(e, 'Could not save guest.'));
    } finally {
      savingGuestRef.current = false;
      setSavingGuest(false);
    }
  };

  const sendAll = async () => {
    if (!derived.unsent) return;
    // 防连点：连点会触发第二轮群发；单发进行中也不群发 —— 那位宾客的 sentAt 还没落，会被群发再寄一封
    if (sendingAllRef.current || sendingRef.current) return;
    sendingAllRef.current = true;
    setSendingAll(true);
    try {
      const r = await api.admin.sendAll();
      // 不能本地把所有未发送的都标成已发送 —— 可能有几封发失败了。以服务端结果为准。
      // 用非阻断刷新：群发已经成功，这次重新同步若抖动失败，不该把整个后台替换成错误页。
      await loadAdmin({ block: false });
      const n = r.count || 0;
      // stampFailed：信寄出了，但服务端没能把 sentAt 记进名单（KV 写入两次都失败）—— 这些人刷新后仍显示未发送，
      // 再点群发会重复邀请，所以先提醒主人别重发
      if (r.stampFailed) showToast(n + ' sent, but the list couldn’t be updated — please don’t resend today');
      else if (r.failed) showToast(n + ' sent · ' + r.failed + ' could not be sent');
      else showToast(n + (n === 1 ? ' invitation' : ' invitations') + ' sent');
    } catch (e) { showToast('Could not send invitations.'); }
    finally {
      sendingAllRef.current = false;
      setSendingAll(false);
    }
  };
  // RSVP 提醒群发。收件人只由服务端决定（已邀请、未回复、非主人、20 小时内没发过信），前端不做任何冷却计算。
  // 走确认弹窗：群发给 N 个人的邮件收不回。runConfirm 的 confirmBusyRef 就是同步的防连点闸门、busyLabel 就是忙碌态，
  // 所以这里不另设 busy ref/state。确认弹窗要求 action 自己 catch 一切（runConfirm 的 finally 只管关弹窗）。
  const doRemindAll = async () => {
    try {
      const r = await api.admin.remindAll();
      // 不本地乐观打标记：可能部分发失败，以服务端为准（同 sendAll）；非阻断刷新
      await loadAdmin({ block: false });
      const n = r.count || 0, s = r.skipped || 0;
      // stampFailed：信寄出了但 remindedAt 没记上，20 小时冷却挡不住下一次 —— 提醒主人今天别再点
      if (r.stampFailed) showToast(n + ' sent, but the list couldn’t be updated — please don’t resend today');
      else if (r.failed) showToast(n + ' sent · ' + r.failed + ' could not be sent');
      else if (n) showToast(n + (n === 1 ? ' reminder' : ' reminders') + ' sent' + (s ? ' · ' + s + ' emailed recently' : ''));
      else showToast(s ? 'Everyone waiting was emailed in the last 20 hours' : 'No one to remind right now');
    } catch (e) {
      // 423：另一个标签页/另一位主人已关闭 RSVP —— 把本地开关也翻过来（按钮随之禁用），再显示服务端文案
      if (e.status === 423) upd((d) => { d.config.rsvpClosed = true; });
      if (!handle401(e)) showToast(errText(e, 'Could not send reminders.'));
    }
  };
  const remindAll = () => {
    const n = derived.totPending;
    // RSVP 已关闭（按钮已禁用，这里兜底；服务端也会 423）/ 没人待回复 / 邀请群发或单发邀请进行中
    // （三者都会重读再整键重写 guests：会互相盖掉标记；单发刚给某人发的邀请还没落 sentAt，他会紧接着再收到一封提醒）
    if (dataRef.current.config.rsvpClosed === true || !n || sendingAllRef.current || sendingRef.current) return;
    askConfirm({
      title: 'Send RSVP reminders?',
      message: (n === 1 ? '1 guest hasn’t' : n + ' guests haven’t') + ' replied yet. Each gets a gentle reminder email with their invitation link — anyone emailed in the last 20 hours is skipped.',
      confirmLabel: 'Send reminders', busyLabel: 'Sending…',
      action: doRemindAll,
    });
  };

  // 后台：导出 CSV（纯前端生成，不新增接口）
  // 点击时重新拉 /api/admin/all：文件是最新的，也顺带再过一次服务端主人守卫（被撤销的主人导不出）。
  // 文件直接用这次的响应生成，故意不写回 store —— 写回会和进行中的后台改动（移除宾客、转存图片等）赛跑，
  // 把刚改过的行在屏幕上短暂"变回去"；也不读 data/dataRef。只读操作，所以不走确认弹窗。
  const exportCsv = async (kind) => {
    if (kind !== 'guests' && kind !== 'registry') return;
    if (exportingRef.current) return; // 防连点：一次点击只出一个文件
    exportingRef.current = true;
    setExporting(true);
    try {
      const ad = await api.admin.getAll();
      const day = csvDate(Date.now(), false); // 文件名用主人本地日期
      const mime = 'text/csv;charset=utf-8';
      if (kind === 'guests') {
        downloadFile('baby-shower-guests-' + day + '.csv', guestsCsv(ad.guests), mime);
        showToast('Guest list downloaded');
      } else {
        downloadFile('baby-shower-registry-' + day + '.csv', registryCsv(ad.items, ad.guests), mime);
        showToast('Registry downloaded');
      }
    } catch (e) {
      // 401 走登出重定向；其余（403/5xx/离线）给固定文案 —— 不用 errText：
      // 这个接口的 4xx 只会是 'unauthorized'/'forbidden' 这种机器字串。文件内容和响应都不打日志（含邮箱、过敏信息）。
      if (!handle401(e)) showToast('Could not export — please try again.');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  // 后台：礼物编辑
  const openNewItem = () => { setEf({ id: null, name: '', store: '', brand: '', cat: 'gift', desc: '', price: '', color: '', link: '', imgUrl: '' }); setEditErr(''); };
  const itemAct = async (id, act) => {
    if (act === 'edit') { const it = data.items.find((x) => x.id === id); if (it) { setEf({ ...it }); setEditErr(''); } }
    // 收货/致谢：一键乐观翻转，不走确认弹窗（不破坏任何东西，再点一下就撤回）
    if (act === 'received' || act === 'thanked') {
      const cur = dataRef.current.items.find((x) => x.id === id);
      // 老格式认领 {name, at} 没有 guestId → claimedById 为 ''（loadAdmin 里 claimed 为 false），所以按 claimedBy 也算已认领
      if (!cur || !(cur.claimedBy || cur.claimedById)) return;
      // prev 读的是当前显示值 —— 同一件礼物还有请求在途时，它就是上一下点击的乐观值，所以连点 Received → Thanked 能叠上去
      const prev = { receivedAt: cur.receivedAt || null, thankedAt: cur.thankedAt || null };
      const want = act === 'received' ? !prev.receivedAt : !prev.thankedAt;
      const now = Date.now();
      // 与服务端规则一致：取消"收到"连"致谢"一起清；标"致谢"顺带补上"收到"
      const next = act === 'received'
        ? (want ? { receivedAt: now, thankedAt: prev.thankedAt } : { receivedAt: null, thankedAt: null })
        : (want ? { receivedAt: prev.receivedAt || now, thankedAt: now } : { receivedAt: prev.receivedAt, thankedAt: null });
      const put = (v) => upd((d) => { const it = d.items.find((x) => x.id === id); if (it) { it.receivedAt = v.receivedAt; it.thankedAt = v.thankedAt; } });
      const showing = (v) => { const c = dataRef.current.items.find((x) => x.id === id); return !!c && (c.receivedAt || null) === v.receivedAt && (c.thankedAt || null) === v.thankedAt; };
      // 带上屏幕上这条认领的 at：认领在别处被换过（撤了又被别人认领）时服务端回 409，进度不会记到别人头上
      const body = { [act]: want, at: cur.claimedAt };
      const qs = thanksQRef.current;
      let q = qs.get(id);
      // 没有在途请求（或上一轮已失败作废）就开新一轮：base = 当前显示值，即服务端确认过/回滚后的状态；lastWrite 沿用
      if (!q || q.dead || !q.pending) {
        q = { chain: Promise.resolve(), pending: 0, lastWrite: q ? q.lastWrite : 0, base: prev, shown: prev, dead: false };
        qs.set(id, q);
      }
      q.pending += 1;
      q.shown = next;
      put(next);
      const run = async () => {
        try {
          if (q.dead) return; // 前面一个已失败并整体回滚：排在后面的这些基于被撤掉的乐观值，不再发
          // KV 同一个键每秒只允许写一次：紧跟着上一次写入的请求先等满 1.1 秒（同 rehostAll 的节奏）
          const wait = q.lastWrite + 1100 - Date.now();
          if (wait > 0) await sleep(wait);
          let r;
          try {
            r = await api.admin.setThanks(id, body);
          } catch (e) {
            // 仍撞上限速（429）：同 rehostOne，等 1.5 秒自动重试一次
            if (e.status !== 429) throw e;
            await sleep(1500);
            r = await api.admin.setThanks(id, body);
          }
          q.lastWrite = Date.now();
          q.base = { receivedAt: r.receivedAt || null, thankedAt: r.thankedAt || null };
          // 后面还有排队的点击就保留它们的乐观值；最后一个回来时以服务端时间戳为准（重复标记时保留最初的时间）
          if (q.pending === 1) put(q.base);
        } catch (e) {
          q.dead = true; // 之后的新点击从回滚后的状态另开一轮
          // 回滚到最后一次服务端确认的状态。同 toggleConfig：这一行已被后续刷新（如群发后的 loadAdmin）改掉就不回滚，免得盖掉更新的状态
          if (showing(q.shown)) put(q.base);
          if (handle401(e)) return;
          showToast(errText(e, 'Could not update.'));
          if (e.status === 409) loadAdmin({ block: false }); // 认领已经没了或换了人（宾客自撤/重新认领/别的标签页）：静默同步
        } finally {
          q.pending -= 1;
        }
      };
      q.chain = q.chain.then(run).catch(() => {}); // run 自己兜住了错误；这里再兜一层，保证队列永远不会卡死
      return;
    }
    if (act === 'unclaim') {
      // 先确认：这是主人在替宾客取消认领，系统不会通知对方，得让主人知道要自己去沟通
      const it = dataRef.current.items.find((x) => x.id === id) || {};
      const itName = it.name || 'This gift';
      askConfirm({
        title: 'Make this gift available again?',
        message: '"' + itName + '" will be open for anyone to claim again' + (it.claimedBy ? ' — ' + it.claimedBy + ' won’t be notified.' : '.'),
        confirmLabel: 'Make it available', busyLabel: 'Updating…',
        action: async () => {
          // 收货/致谢进度挂在认领上，随认领一起删；claimedById 也要删，否则残留的 id 会让上面 'received' 的守卫误判为已认领
          try { await api.admin.unclaimItem(id); upd((d) => { const x = d.items.find((i) => i.id === id); if (x) { delete x.claimedBy; delete x.claimedAt; delete x.claimedById; delete x.receivedAt; delete x.thankedAt; x.claimed = false; x.mine = false; } }); showToast('Gift is available again'); } catch (e) { showToast('Could not update.'); }
        },
      });
    }
    if (act === 'remove') {
      // 先确认再删：后端会级联删掉认领记录和 R2 图片，不可恢复
      const it = dataRef.current.items.find((x) => x.id === id) || {};
      const itName = it.name || 'This item';
      const claimBit = it.claimed ? (it.claimedBy ? it.claimedBy + '’s claim and its photo.' : 'its claim and its photo.') : 'its photo.';
      askConfirm({
        title: 'Remove this item?',
        message: '"' + itName + '" will be removed from the registry, along with ' + claimBit,
        confirmLabel: 'Remove item', busyLabel: 'Removing…',
        action: async () => {
          try {
            await api.admin.removeItem(id);
            upd((d) => { d.items = d.items.filter((x) => x.id !== id); });
            showToast('Item removed');
          } catch (e) { showToast(errText(e, 'Could not remove item.')); } // 与删宾客一致：4xx（如 429 写得太快）给可操作的原因
        },
      });
    }
  };
  const onEditField = (k, v) => setEf((prev) => {
    if (!prev) return prev;
    // 输入图片 URL 时只清掉本次上传的临时预览（imgPreview），让 URL 立即在预览里可见；
    // 绝不在这里动 imgKey —— 那是已持久化的照片，清空后保存会连带删掉 R2 对象（数据丢失）。
    // 「URL 是否顶替已存照片」留到保存时判断：输入过又删空，imgKey 原样保留，什么都不会删。
    if (k === 'imgUrl') return { ...prev, imgUrl: v, imgPreview: '' };
    return { ...prev, [k]: v };
  });
  const closeEdit = () => {
    // 保存进行中（遮罩/✕/取消都没被禁用，可在 saveItem 网络往返途中触发）时，一张也别删：
    // 正在落库的那张就在 pendingImgKeys 里，删了它会让礼物落库后指向一个已删的 R2 对象（/api/media 404）。
    // 交给 saveItem 的成功清理去处理（它保留最终采用的那张、删掉其余）。
    if (savingItemRef.current) { setEf(null); return; }
    // 放弃编辑：本会话上传但没保存的图全部清掉（没有任何 KV 记录指向它们）
    pendingImgKeys.current.forEach((k) => api.admin.deleteMedia(k).catch(() => {}));
    pendingImgKeys.current = [];
    setEf(null);
  };
  const saveItem = async () => {
    if (savingItemRef.current) return; // 防连点：新建礼物没有 id，连点两次会创建两条记录
    if (!ef || !ef.name.trim()) { setEditErr('The item needs a name.'); return; }
    // 轻量 URL 校验：商品链接和图片 URL 都会被直接渲染成 href/img src，
    // 只拦「不是 http(s):// 开头」这一类必错的输入（如 www.amazon.com、随手粘贴的文字）
    const badUrl = [ef.link, ef.imgUrl].some((u) => (u || '').trim() && !/^https?:\/\//i.test((u || '').trim()));
    if (badUrl) { setEditErr('Links need to start with http:// or https://'); return; }
    const rec = {
      // brand 的 `|| ''` 不是习惯性兜底：itemAct('edit') 是 setEf({ ...it }) 直接拿原始条目，
      // 改动前存进 KV 的礼物没有 brand 键，ef.brand 就是 undefined，写成 ef.brand.trim() 会抛进
      // catch 变成一句看不懂的 "Could not save item."
      id: ef.id || undefined, name: ef.name.trim(), store: (ef.store || '').trim(), brand: (ef.brand || '').trim(),
      cat: ef.cat || 'gift', desc: (ef.desc || '').trim(), price: (ef.price || '').trim(),
      color: (ef.color || '').trim(), link: (ef.link || '').trim(), imgUrl: (ef.imgUrl || '').trim(),
      // 提交了非空 URL 才让 URL 顶替已存照片（清空 imgKey → 后端顺带删掉那张已成孤儿的 R2 图）；
      // URL 为空则原样保留 imgKey，绝不删。这样「输入 URL 又删空」不会误删照片。
      imgKey: (ef.imgUrl || '').trim() ? '' : (ef.imgKey || '').trim(),
    };
    savingItemRef.current = true;
    setSavingItem(true);
    try {
      const r = await api.admin.saveItem(rec);
      const saved = r.item;
      upd((d) => { const i = d.items.findIndex((x) => x.id === saved.id); if (i >= 0) d.items[i] = { ...d.items[i], ...saved }; else d.items.push(saved); });
      // 保存成功：除最终采用的这张外，本会话其余上传都是孤儿，清掉
      pendingImgKeys.current.filter((k) => k !== saved.imgKey).forEach((k) => api.admin.deleteMedia(k).catch(() => {}));
      pendingImgKeys.current = [];
      setEf(null);
      showToast('Item saved');
    } catch (e) {
      setEditErr(errText(e, 'Could not save item.'));
    } finally {
      savingItemRef.current = false;
      setSavingItem(false);
    }
  };

  // 后台：外链图转存 R2（单个 + 批量）。不走确认弹窗：没有任何图片会丢，弹窗还会把整屏挡到批量跑完。
  // 内部：转存一件，返回 {ok} | {ok:false,status} | {stop}（401 → 已登出，批量要停）
  // 撞上 KV 同键写入限速（429，后端已删掉这次放进 R2 的对象）：等 1.5 秒自动重试一次，单个和批量都一样
  const rehostOne = async (id) => {
    const url = ((dataRef.current.items.find((x) => x.id === id) || {}).imgUrl || '').trim();
    try {
      let r;
      try {
        r = await api.admin.rehostItemImg(id);
      } catch (e) {
        if (e.status !== 429) throw e;
        await sleep(1500);
        r = await api.admin.rehostItemImg(id);
      }
      // 与 saveItem 同样的合并：保留本地的 claimedBy/mine 等认领字段
      upd((d) => { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) d.items[i] = { ...d.items[i], ...r.item }; });
      // 编辑弹窗正开着这件礼物、且 URL 没被改过：把表单也换成 R2 图。否则它的 Save 会把 URL 写回去，
      // 后端随即删掉刚转存的照片。主人已经改了 URL 或上传了照片（imgUrl 变 ''）的，表单不动。
      setEf((prev) => (prev && prev.id === id && (prev.imgUrl || '').trim() === url ? { ...prev, imgKey: r.item.imgKey, imgUrl: r.item.imgUrl || '' } : prev));
      setRehostFails((m) => { if (!(id in m)) return m; const n = { ...m }; delete n[id]; return n; });
      return { ok: true };
    } catch (e) {
      if (handle401(e)) return { stop: true };
      setRehostFails((m) => ({ ...m, [id]: { url, msg: errText(e, 'Could not save this image.') } }));
      return { ok: false, status: e.status };
    }
  };
  const rehostImg = async (id) => {
    if (rehostBusyRef.current) return; // 防连点 + 与批量互斥
    rehostBusyRef.current = true;
    setRehostingId(id);
    try {
      const r = await rehostOne(id);
      if (r.ok) showToast('Image saved');
      else if (!r.stop) showToast('Could not save the image.');
    } finally {
      rehostBusyRef.current = false;
      setRehostingId(null);
    }
  };
  // 批量：从客户端逐件串行跑（每件之间隔 1.1 秒），失败的原因留在各自行上，最后一条汇总提示
  const rehostAll = async () => {
    if (rehostBusyRef.current) return;
    const ids = dataRef.current.items.filter(hasExternalImg).map((x) => x.id);
    if (!ids.length) return;
    rehostBusyRef.current = true;
    const total = ids.length;
    setRehostProgress({ done: 0, total });
    let ok = 0, failed = 0, stopped = false;
    try {
      for (let k = 0; k < total; k++) {
        const id = ids[k];
        // 每件发之前按最新数据再确认一次：跑批期间可能被删、被上传了照片、或改了链接
        const cur = dataRef.current.items.find((x) => x.id === id);
        if (cur && hasExternalImg(cur)) {
          setRehostingId(id);
          // 429 的那一次自动重试在 rehostOne 里；再不行就记为该行失败
          const r = await rehostOne(id);
          if (r.stop) { stopped = true; break; }
          if (r.ok) ok++; else failed++;
          // KV 同键每秒一次写入；顺便对商家的 CDN 也温和些
          if (k < total - 1) await sleep(1100);
        }
        setRehostProgress({ done: k + 1, total });
      }
    } finally {
      rehostBusyRef.current = false;
      setRehostingId(null);
      setRehostProgress(null);
      // 会话过期（401）已经登出，不再提示
      if (!stopped) showToast(ok + ' saved' + (failed ? ' · ' + failed + ' could not be saved' : ''));
    }
  };

  const firstName = (me?.name || '').split(' ')[0];

  const value = {
    // 身份 / 登录（来自 useAuth，store 只是把它摊平进同一个契约）
    ...auth,
    verifyCode, signOut, // 覆盖 useAuth 的同名项：这两个还要顺带拉/清数据
    // 代填模式下反映的是被编辑的宾客，而非登录的主人（否则弹窗文案/按钮说反）
    firstName, hasRsvp: rsvpAdminMode ? !!(data.guests.find((g) => g.id === rsvpGuestId) || {}).rsvp : !!myRsvp,
    rsvpCta: derived.rsvpClosed ? 'RSVPs closed' : myRsvp ? 'Update RSVP' : 'RSVP',
    // 主题卡 RSVP 按钮下面那一行：平时是截止日期，关闭后改成"有变动请联系主人"（短文案，Wisteria 的固定留白区放得下）
    rsvpNote: derived.rsvpClosed
      ? 'Plans changed? Just let ' + (data.event.hosts || 'the hosts') + ' know.'
      : 'Kindly RSVP by ' + (data.event.rsvpBy || ''),
    booted, bootError,

    // 数据
    event: data.event, design: data.design, config: data.config,
    theme: data.design.theme, bg: data.design.bg, babyInitial, narrow,
    // 加入日历（主题卡的两个链接只在 calOk 时渲染；gcalUrl 在 !calOk 时为 ''，addToCalendar 那时是空操作）
    calOk: cal.calOk, gcalUrl: cal.gcalUrl, addToCalendar,
    // 背景媒体（R2）；bgMediaFor 供后台预览框强制指定焦点模式
    bgMediaEl, bgMediaFor, bgIsNone: !hasBg,
    bgDim: hasBg ? (bg.dim || 0) / 100 : 0,
    bgDimSky: hasBg ? Math.max(bg.dim || 0, 30) / 100 : 0.3,
    hasBg, bgStatus: hasBg ? (bg.type === 'video' ? 'video' : 'photo') : 'none — using the soft default',
    uploadBg, removeBg, uploadItemImg,
    // 提示
    toast, showToast,
    // 危险操作确认弹窗（ConfirmModal 消费；askConfirm 是 store 内部实现，不导出）
    confirmOpen: !!confirm, confirm, confirmBusy, runConfirm, closeConfirm,
    // registry
    ...derived,
    filter, setFilter,
    giftId, openGift, closeGift, giftOpen: !!derived.gift,
    claimErr, confirmClaim, unclaimGift, claimBusy,
    showClaimCta: !!derived.gift && !derived.gift.claimed && !derived.registryClosed, // 清单关闭后不再给认领按钮
    // rsvp
    rsvpOpen, openRsvp, closeRsvp, rsvpStep, rsvpAdminMode, rsvpErr, rsvpBusy,
    rsvpName: rsvpAdminMode ? (data.guests.find((g) => g.id === rsvpGuestId) || {}).name || '' : (me?.name || ''),
    attending, attYes: attending === 'yes', setAttendYes: () => setAttending('yes'), setAttendNo: () => setAttending('no'),
    adults, kids, bump, dietary, setDietary, allergies, setAllergies, submitRsvp,
    doneTitle: attending === 'yes' ? 'See you there!' : 'We’ll miss you!',
    doneMsg: attending === 'yes'
      ? 'Your RSVP is in — ' + data.event.hosts + ' can’t wait to celebrate with you.'
      : 'Thanks for letting us know. You’re welcome to peek at the registry any time.',
    // 信封
    emailOpen, openEmail, closeEmail, envOn, envOpen, envReplay, envSkip, envDone, flapZ,
    // admin
    adminTab, setAdminTab, loadAdmin, adminLoaded, adminError,
    onEventField, setTheme, onSlider, toggleConfig,
    ngName, setNgName, ngEmail, setNgEmail, ngErr, addGuest, guestAct, sendAll, remindAll,
    addingGuest, sendingId, sendingAll,
    gf, guestEditOpen: !!gf, onGuestField, saveGuest, closeGuestEdit, guestErr, savingGuest,
    exportCsv, exporting,
    openRecordRsvp,
    openNewItem, itemAct, ef, editErr, onEditField, closeEdit, saveItem, savingItem, editOpen: !!ef,
    rehostImg, rehostAll, rehostingId, rehostProgress, rehostErrs,
  };

  return (
    <StoreCtx.Provider value={value}>
      {bootError ? <BootError onRetry={boot} /> : booted ? children : <Loader />}
    </StoreCtx.Provider>
  );
}
