import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { Hover, FocusInput } from '../components/ui.jsx';
import Envelope from '../components/Envelope.jsx';
import { FONT } from '../theme.js';

// 落地页：全站唯一的公开页面。信封 → 打开 → 只露"宝宝名 + 主人名"的卡片 → 登录框。
// 这里绝不能出现日期/时间/地点 —— 整道门就是为了挡住这些。
const SEEN = 'bs.envelope.seen';

export default function Landing() {
  const {
    event, babyInitial,
    envOn, envOpen, envSkip, envDone, flapZ,
    authStep, authEmail, setAuthEmail, authCode, setAuthCode,
    authErr, authBusy, authDevCode,
    inviteToken, setInviteToken,
    signIn, verifyCode, authBack,
  } = useStore();

  const loc = useLocation();
  const navigate = useNavigate();
  const from = loc.state?.from || '/';

  // 挂载：读邀请链接的 ?i=<令牌>，并决定信封放不放。
  // 不把 ?i= 从地址栏抹掉 —— 它不是登录凭证（顶多让验证码发到本人邮箱），
  // 抹掉之后宾客在验证码这一步刷新，预填就没了，只会更懵。
  useEffect(() => {
    const tok = new URLSearchParams(loc.search).get('i');
    if (tok) setInviteToken(tok);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try { seen = localStorage.getItem(SEEN) === '1'; } catch { /* 无痕模式 */ }
    // 从邀请邮件点进来的一律放动画；本浏览器看过一次的、或系统要求减少动效的，直接跳到终态。
    // 不需要 else 分支：store 里信封的初值本就是"合着的"。
    if (reduce || (seen && !tok)) envSkip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* 无痕模式 */ } };
  const onOpen = () => { markSeen(); envOpen(); };
  const onSkip = () => { markSeen(); envSkip(); };

  const submit = async (e) => {
    e.preventDefault();
    if (authStep === 'email') return signIn(event.hosts);
    const ok = await verifyCode();
    if (ok) navigate(from, { replace: true });
  };

  const input = {
    width: '100%', padding: '13px 15px', border: '1.5px solid #E2DCCE', borderRadius: '13px',
    font: `600 15px ${FONT.sans}`, outline: 'none', background: '#FFFFFF', textAlign: 'center',
  };
  const focus = { borderColor: '#A9C7E4', boxShadow: '0 0 0 3px rgba(169,199,228,.25)' };
  const btn = {
    background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '14px',
    font: `700 15px ${FONT.sans}`, cursor: authBusy ? 'default' : 'pointer', opacity: authBusy ? 0.6 : 1, width: '100%',
  };

  return (
    <div
      data-screen-label="Landing"
      style={{ minHeight: '100vh', background: '#FBF8F2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 18px' }}
    >
      {!envDone ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Envelope open={envOn} flapZ={flapZ} onOpen={onOpen} initial={babyInitial}>
            {/* 信封里的卡片：只有宝宝名和主人名 */}
            <div style={{ font: `700 9px ${FONT.sans}`, letterSpacing: '.28em', color: '#A9C7E4', textTransform: 'uppercase' }}>You're invited</div>
            <div style={{ font: `600 21px/1.15 ${FONT.serif}`, color: '#3D4A5C' }}>A Baby Shower<br />for {event.baby}</div>
            <div style={{ font: `600 11px ${FONT.sans}`, color: '#8A94A6' }}>{event.hosts}</div>
          </Envelope>
          {!envOn && (
            <div style={{ font: '600 11px ui-monospace,Menlo,monospace', color: '#7C93AC', marginTop: '12px' }}>tap the envelope to open it</div>
          )}
          <Hover
            as="button"
            onClick={onSkip}
            style={{ marginTop: '10px', background: 'none', border: 'none', color: '#A5AEBC', font: `700 12px ${FONT.sans}`, cursor: 'pointer', textDecoration: 'underline' }}
            hover={{ color: '#5B84AE' }}
          >
            Skip
          </Hover>
        </div>
      ) : (
        <div
          style={{
            width: 'min(440px,100%)', background: '#FFFDF8', borderRadius: '24px', border: '1px solid #E9E1D2',
            boxShadow: '0 30px 90px rgba(20,32,48,.10)', padding: 'clamp(24px,5vw,36px)', textAlign: 'center',
            animation: 'bsPopUp .45s',
          }}
        >
          <div
            style={{
              width: '48px', height: '48px', margin: '0 auto', borderRadius: '50%', background: '#EAF2F9',
              border: '1px solid #CBDDEE', display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: `600 21px ${FONT.serif}`, color: '#5B84AE', animation: 'bsFloat 6s ease-in-out infinite',
            }}
          >
            {babyInitial}
          </div>
          <div style={{ font: `700 11px ${FONT.sans}`, letterSpacing: '.28em', color: '#A9C7E4', textTransform: 'uppercase', marginTop: '14px' }}>You're invited</div>
          <div style={{ font: `500 clamp(30px,5vw,40px)/1.15 ${FONT.serif}`, color: '#3D4A5C', marginTop: '6px' }}>A Baby Shower for {event.baby}</div>
          <div style={{ font: `italic 500 16px ${FONT.serif}`, color: '#8A94A6', marginTop: '4px' }}>Hosted with love by {event.hosts}</div>

          <div style={{ height: '1px', background: '#EFE8DA', margin: '18px 0' }}></div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {authStep === 'email' ? (
              <>
                <div style={{ font: `600 14px/1.6 ${FONT.sans}`, color: '#6C7889' }}>
                  {inviteToken
                    ? 'Welcome! We’ll send a 6-digit code to the address your invitation was sent to.'
                    : 'Enter the email your invitation was sent to and we’ll send you a 6-digit code.'}
                </div>
                {!inviteToken && (
                  <FocusInput
                    as="input"
                    type="email"
                    placeholder="you@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.currentTarget.value)}
                    style={input}
                    focus={focus}
                  />
                )}
                {authErr && <div style={{ font: `700 13px ${FONT.sans}`, color: '#C0715E' }}>{authErr}</div>}
                <Hover as="button" type="submit" disabled={authBusy} style={btn} hover={authBusy ? null : { background: '#47709A' }}>
                  {authBusy ? 'Sending…' : 'Email me a code'}
                </Hover>
              </>
            ) : (
              <>
                <div style={{ font: `600 14px/1.6 ${FONT.sans}`, color: '#6C7889' }}>
                  We emailed a 6-digit code to<br />
                  <b style={{ color: '#3D4A5C' }}>{inviteToken ? 'the address on your invitation' : authEmail}</b>
                </div>
                {/* 仅开发/本地模式（服务端回传 devCode）才显示；生产为真实邮件，此块不出现 */}
                {authDevCode && (
                  <div style={{ border: '1.5px dashed #CBDDEE', borderRadius: '14px', background: '#F5F9FC', padding: '12px 16px' }}>
                    <div style={{ font: '700 10px ui-monospace,Menlo,monospace', color: '#93A0B4', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Dev preview · code shown for testing</div>
                    <div style={{ font: '600 13px ui-monospace,Menlo,monospace', color: '#47709A' }}>Your code is <b style={{ fontSize: '16px', letterSpacing: '.2em' }}>{authDevCode}</b></div>
                  </div>
                )}
                <FocusInput
                  as="input"
                  placeholder="······"
                  inputMode="numeric"
                  maxLength={6}
                  value={authCode}
                  onChange={(e) => setAuthCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ ...input, font: `800 26px ${FONT.sans}`, letterSpacing: '.35em' }}
                  focus={focus}
                />
                {authErr && <div style={{ font: `700 13px ${FONT.sans}`, color: '#C0715E' }}>{authErr}</div>}
                {/* 验证码必须凑满 6 位才能提交：短码必然失败，不值得发请求 */}
                <Hover as="button" type="submit" disabled={authBusy || authCode.length !== 6} style={{ ...btn, cursor: authBusy || authCode.length !== 6 ? 'default' : 'pointer', opacity: authBusy || authCode.length !== 6 ? 0.6 : 1 }} hover={authBusy || authCode.length !== 6 ? null : { background: '#47709A' }}>
                  {authBusy ? 'Signing in…' : 'Sign in'}
                </Hover>
                {/* 重发验证码：直接复用 signIn；60 秒冷却由服务端把关（429 → 友好文案） */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '18px', flexWrap: 'wrap' }}>
                  <Hover
                    as="button"
                    type="button"
                    onClick={() => signIn(event.hosts)}
                    disabled={authBusy}
                    style={{ background: 'none', border: 'none', color: '#8A94A6', font: `700 13px ${FONT.sans}`, cursor: authBusy ? 'default' : 'pointer', textDecoration: 'underline' }}
                    hover={authBusy ? null : { color: '#5B84AE' }}
                  >
                    Resend code
                  </Hover>
                  <Hover
                    as="button"
                    type="button"
                    onClick={authBack}
                    style={{ background: 'none', border: 'none', color: '#8A94A6', font: `700 13px ${FONT.sans}`, cursor: 'pointer', textDecoration: 'underline' }}
                    hover={{ color: '#5B84AE' }}
                  >
                    Use a different email
                  </Hover>
                </div>
              </>
            )}
          </form>

          <div style={{ font: `600 11.5px ${FONT.sans}`, color: '#A5AEBC', marginTop: '16px' }}>
            Only invited guests can see the details.
          </div>
        </div>
      )}
    </div>
  );
}
