import { useRef, useState } from 'react';
import { api, errText } from './api.js';
import { EMAIL_RE } from './util.js';

// 登录状态机：邮箱/邀请令牌 → 6 位验证码 → 7 天会话 cookie。
// 独立成 hook 只是为了不让 store.jsx 继续膨胀 —— store 调用它并把结果摊进 value，
// useStore() 的契约不变，组件不需要认识第二个 hook。
// 这里不碰 react-router：verifyCode 回一个布尔值，由落地页决定跳去哪。
export function useAuth() {
  const [me, setMe] = useState(null); // { id, name, isHost } | null
  const [myRsvp, setMyRsvp] = useState(null); // 该宾客已有的 RSVP，供表单预填

  const [authStep, setAuthStep] = useState('email'); // email | code
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authDevCode, setAuthDevCode] = useState(''); // 仅 EMAIL_MODE!=='resend' 时服务端回传
  const [inviteToken, setInviteToken] = useState(''); // 邮件链接 ?i= 带来的令牌

  // 防连点必须用 ref：setState 要等下次渲染才生效，同一轮事件里的连点会读到同一份旧 state
  const authBusyRef = useRef(false);

  // 401（会话过期/被吊销）：清掉身份即可 —— authed 变 false，路由会把人送回落地页。
  // 这就是整条会话过期路径，不需要额外的标志位。
  const handle401 = (e) => {
    if (e && e.status === 401) {
      setMe(null);
      setMyRsvp(null);
      return true;
    }
    return false;
  };

  // 第一步：要验证码。有邀请令牌就用令牌（宾客一个字都不用输）。
  const signIn = async (hostsLabel) => {
    if (authBusyRef.current) return;
    const body = inviteToken ? { inviteToken } : { email: authEmail.trim().toLowerCase() };
    // 与 addGuest/后端同一条邮箱形状校验：拦住 a@b / anne@ 这类必然发不出验证码的地址
    if (!inviteToken && !EMAIL_RE.test(body.email || '')) {
      setAuthErr('Please enter a valid email address.');
      return;
    }
    authBusyRef.current = true;
    setAuthBusy(true);
    setAuthErr('');
    try {
      const r = await api.authStart(body);
      setAuthDevCode(r.devCode || '');
      setAuthCode('');
      setAuthStep('code');
    } catch (e) {
      if (e.status === 404) setAuthErr('We couldn’t find this email on the guest list — ask ' + hostsLabel + ' to add you!');
      else if (e.status === 429) setAuthErr('Please wait a moment before asking for another code.');
      else if (e.status === 400 && e.data && e.data.error === 'invalid_invite') {
        // 邀请链接过期/损坏/已作废（主人改过邮箱）：静默降级成手输邮箱，别把人卡死在一个点不动的按钮上。
        // 也可能是在验证码那一步点了 Resend code，所以连步骤一起退回 email
        setInviteToken('');
        setAuthStep('email');
        setAuthErr('That invitation link has expired — please enter your email instead.');
      } else setAuthErr(errText(e, 'Please try again.'));
    } finally {
      authBusyRef.current = false;
      setAuthBusy(false);
    }
  };

  // 第二步：核验证码。成功返回 true（落地页据此跳转），失败返回 false。
  // afterVerify：cookie 已种下、身份尚未亮出时先跑（store 用它拉宾客数据）—— authed 一变 true，"/" 立刻渲染邀请页，
  // 那时 data 若还是未登录空壳，会先闪一张 EMPTY_DATA 主题的空卡再换成真主题；它跑完之前 authBusy 保持 true，防重复提交。
  // 它必须自己吞掉错误：抛到下面的 catch 会被当成"验证码不对"
  const verifyCode = async (afterVerify) => {
    if (authBusyRef.current) return false;
    authBusyRef.current = true;
    setAuthBusy(true);
    setAuthErr('');
    try {
      const body = inviteToken ? { inviteToken, code: authCode } : { email: authEmail.trim().toLowerCase(), code: authCode };
      const r = await api.authVerify(body);
      if (afterVerify) await afterVerify();
      setMe(r.guest);
      setMyRsvp(r.rsvp || null);
      return true;
    } catch (e) {
      if (e.status === 400 && e.data && e.data.error === 'invalid_invite') {
        // 邀请令牌在验证码这一步失效（过期，或主人刚改了这位宾客的邮箱）：同 signIn，退回手输邮箱，
        // 别把机器码 'invalid_invite' 原样显示给宾客
        setInviteToken('');
        setAuthStep('email');
        setAuthCode('');
        setAuthDevCode('');
        setAuthErr('That invitation link has expired — please enter your email instead.');
      } else setAuthErr(errText(e, 'That code doesn’t match — please check your email.'));
      return false;
    } finally {
      authBusyRef.current = false;
      setAuthBusy(false);
    }
  };

  // "换个邮箱"：连邀请令牌一起丢掉 —— 否则点了它还是照着邀请里的那个邮箱发码，等于没换
  const authBack = () => { setAuthStep('email'); setAuthErr(''); setAuthCode(''); setAuthDevCode(''); setInviteToken(''); };

  const signOut = async () => {
    await api.signOut().catch(() => {}); // 网络失败也照样在本地登出
    setMe(null);
    setMyRsvp(null);
    setAuthStep('email');
    setAuthEmail('');
    setAuthCode('');
    setAuthDevCode('');
    setInviteToken('');
  };

  return {
    me, setMe, authed: !!me,
    myRsvp, setMyRsvp,
    authStep, authEmail, setAuthEmail, authCode, setAuthCode,
    authErr, authBusy, authDevCode,
    inviteToken, setInviteToken,
    signIn, verifyCode, authBack, signOut, handle401,
  };
}
