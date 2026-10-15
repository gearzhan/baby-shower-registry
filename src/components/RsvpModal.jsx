import { useStore } from '../store.jsx';
import { Hover, FocusInput, useEscClose } from './ui.jsx';

// RSVP 弹窗（原型 RSVP MODAL 区块移植）：只剩 form→done。
// 邮箱/验证码两步已搬到落地页 —— 能打开这个弹窗的人本来就登录过了。
export default function RsvpModal() {
  const {
    rsvpOpen, closeRsvp, rsvpStep,
    event,
    rsvpErr, rsvpBusy, hasRsvp,
    rsvpName,
    attYes, setAttendYes, setAttendNo,
    adults, kids, bump,
    dietary, setDietary, allergies, setAllergies,
    submitRsvp, doneTitle, doneMsg,
  } = useStore();

  // Escape 关闭（须在提前返回之前调用 —— Rules of Hooks）
  useEscClose(rsvpOpen, closeRsvp);

  // 仅在弹窗开启时渲染
  if (!rsvpOpen) return null;

  // 派生步骤布尔
  const stepForm = rsvpStep === 'form';
  const stepDone = rsvpStep === 'done';

  // 内层容器阻止事件冒泡（避免点击内容触发背景关闭）
  const swallow = (e) => e.stopPropagation();

  // 出席按钮配色：本地按 attYes 计算，复刻原型取值
  const attYesBorder = attYes ? '#5B84AE' : '#E2DCCE';
  const attYesBg = attYes ? '#EAF2F9' : '#FFFFFF';
  const attYesColor = attYes ? '#47709A' : '#9AA3B2';
  const attNoBorder = !attYes ? '#B99C8A' : '#E2DCCE';
  const attNoBg = !attYes ? '#F6EFE7' : '#FFFFFF';
  const attNoColor = !attYes ? '#96755C' : '#9AA3B2';

  return (
    <div
      onClick={closeRsvp}
      style={{ position: 'fixed', inset: '0', zIndex: 110, background: 'rgba(30,40,55,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', animation: 'bsFadeIn .25s' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="RSVP"
        onClick={swallow}
        style={{ position: 'relative', width: 'min(460px,100%)', maxHeight: '92vh', overflow: 'auto', background: '#FFFDF8', borderRadius: '24px', boxShadow: '0 30px 90px rgba(20,32,48,.35)', animation: 'bsPopUp .3s', padding: 'clamp(24px,5vw,34px)' }}
      >
        <Hover
          as="button"
          aria-label="Close"
          onClick={closeRsvp}
          style={{ position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px', borderRadius: '50%', border: '1px solid #E7E0D2', background: '#FFFFFF', color: '#8A94A6', font: "700 15px 'Nunito',sans-serif", cursor: 'pointer' }}
          hover={{ color: '#3D4A5C', borderColor: '#CBDDEE' }}
        >
          ✕
        </Hover>

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ font: "italic 500 16px 'Cormorant Garamond',serif", color: '#8A94A6' }}>{event.dateLabel}</div>
          <div style={{ font: "500 34px 'Cormorant Garamond',serif", color: '#3D4A5C' }}>RSVP</div>
        </div>

        {stepForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ font: "600 14px/1.5 'Nunito',sans-serif", color: '#6C7889', textAlign: 'center' }}>
              Hi <b style={{ color: '#3D4A5C' }}>{rsvpName}</b> — {hasRsvp ? 'you can change anything below.' : "we can't wait to hear!"}
            </div>
            <div style={{ display: 'flex', gap: '9px' }}>
              <button onClick={setAttendYes} aria-pressed={attYes} style={{ flex: '1', border: `2px solid ${attYesBorder}`, background: attYesBg, color: attYesColor, borderRadius: '14px', padding: '13px 8px', font: "700 13.5px 'Nunito',sans-serif", cursor: 'pointer' }}>Joyfully accepts</button>
              <button onClick={setAttendNo} aria-pressed={!attYes} style={{ flex: '1', border: `2px solid ${attNoBorder}`, background: attNoBg, color: attNoColor, borderRadius: '14px', padding: '13px 8px', font: "700 13.5px 'Nunito',sans-serif", cursor: 'pointer' }}>Regretfully declines</button>
            </div>
            {attYes && (
              <>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1', minWidth: '150px', border: '1.5px solid #E9E2D3', borderRadius: '14px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px', background: '#FDFCF8' }}>
                    <div style={{ flex: '1' }}>
                      <div style={{ font: "700 11px 'Nunito',sans-serif", letterSpacing: '.1em', textTransform: 'uppercase', color: '#8A94A6' }}>Adults</div>
                      <div style={{ font: "800 20px 'Nunito',sans-serif", color: '#3D4A5C' }}>{adults}</div>
                    </div>
                    {/* 到达上下限（与 store 的 bump 钳制一致：1–12）就禁用，别让按钮看着能点却没反应 */}
                    <Hover
                      as="button"
                      aria-label="Fewer adults"
                      onClick={() => bump('adults', -1)}
                      disabled={adults <= 1}
                      style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1.5px solid #CBDDEE', background: '#FFFFFF', color: '#5B84AE', font: "800 16px 'Nunito',sans-serif", cursor: adults <= 1 ? 'default' : 'pointer', opacity: adults <= 1 ? 0.5 : 1 }}
                      hover={adults <= 1 ? null : { background: '#EAF2F9' }}
                    >
                      −
                    </Hover>
                    <Hover
                      as="button"
                      aria-label="More adults"
                      onClick={() => bump('adults', 1)}
                      disabled={adults >= 12}
                      style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1.5px solid #CBDDEE', background: '#FFFFFF', color: '#5B84AE', font: "800 16px 'Nunito',sans-serif", cursor: adults >= 12 ? 'default' : 'pointer', opacity: adults >= 12 ? 0.5 : 1 }}
                      hover={adults >= 12 ? null : { background: '#EAF2F9' }}
                    >
                      +
                    </Hover>
                  </div>
                  <div style={{ flex: '1', minWidth: '150px', border: '1.5px solid #E9E2D3', borderRadius: '14px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px', background: '#FDFCF8' }}>
                    <div style={{ flex: '1' }}>
                      <div style={{ font: "700 11px 'Nunito',sans-serif", letterSpacing: '.1em', textTransform: 'uppercase', color: '#8A94A6' }}>Children</div>
                      <div style={{ font: "800 20px 'Nunito',sans-serif", color: '#3D4A5C' }}>{kids}</div>
                    </div>
                    {/* 到达上下限（0–12）就禁用，同上 */}
                    <Hover
                      as="button"
                      aria-label="Fewer children"
                      onClick={() => bump('kids', -1)}
                      disabled={kids <= 0}
                      style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1.5px solid #CBDDEE', background: '#FFFFFF', color: '#5B84AE', font: "800 16px 'Nunito',sans-serif", cursor: kids <= 0 ? 'default' : 'pointer', opacity: kids <= 0 ? 0.5 : 1 }}
                      hover={kids <= 0 ? null : { background: '#EAF2F9' }}
                    >
                      −
                    </Hover>
                    <Hover
                      as="button"
                      aria-label="More children"
                      onClick={() => bump('kids', 1)}
                      disabled={kids >= 12}
                      style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1.5px solid #CBDDEE', background: '#FFFFFF', color: '#5B84AE', font: "800 16px 'Nunito',sans-serif", cursor: kids >= 12 ? 'default' : 'pointer', opacity: kids >= 12 ? 0.5 : 1 }}
                      hover={kids >= 12 ? null : { background: '#EAF2F9' }}
                    >
                      +
                    </Hover>
                  </div>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  <span style={{ font: "700 11px 'Nunito',sans-serif", letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A94A6' }}>Dietary preferences</span>
                  <FocusInput
                    as="input"
                    placeholder="e.g. vegetarian, halal — or leave blank"
                    value={dietary}
                    onChange={(e) => setDietary(e.currentTarget.value)}
                    style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: "600 14px 'Nunito',sans-serif", outline: 'none', background: '#FFFFFF' }}
                    focus={{ borderColor: '#A9C7E4', boxShadow: '0 0 0 3px rgba(169,199,228,.25)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  <span style={{ font: "700 11px 'Nunito',sans-serif", letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A94A6' }}>Allergies</span>
                  <FocusInput
                    as="input"
                    placeholder="e.g. peanuts, shellfish — or leave blank"
                    value={allergies}
                    onChange={(e) => setAllergies(e.currentTarget.value)}
                    style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: "600 14px 'Nunito',sans-serif", outline: 'none', background: '#FFFFFF' }}
                    focus={{ borderColor: '#A9C7E4', boxShadow: '0 0 0 3px rgba(169,199,228,.25)' }}
                  />
                </label>
              </>
            )}
            {/* 表单步骤同样要显示错误：会话过期/网络故障时，这里没提示就等于 RSVP 悄悄丢了 */}
            {rsvpErr && (<div style={{ font: "700 13px 'Nunito',sans-serif", color: '#C0715E', textAlign: 'center' }}>{rsvpErr}</div>)}
            <Hover
              as="button"
              onClick={submitRsvp}
              disabled={rsvpBusy}
              style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '14px', font: "700 15px 'Nunito',sans-serif", cursor: rsvpBusy ? 'default' : 'pointer', opacity: rsvpBusy ? 0.6 : 1 }}
              hover={rsvpBusy ? null : { background: '#47709A' }}
            >
              {rsvpBusy ? 'Sending…' : hasRsvp ? 'Update RSVP' : 'Send RSVP'}
            </Hover>
          </div>
        )}

        {stepDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center', textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ width: '58px', height: '58px', borderRadius: '50%', background: '#F0F6EC', border: '1.5px solid #DCE9D4', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "800 24px 'Nunito',sans-serif", color: '#5F8A54' }}>✓</div>
            <div style={{ font: "500 28px 'Cormorant Garamond',serif", color: '#3D4A5C' }}>{doneTitle}</div>
            <div style={{ font: "600 14px/1.6 'Nunito',sans-serif", color: '#6C7889', maxWidth: '300px' }}>{doneMsg}</div>
            <Hover
              as="button"
              onClick={closeRsvp}
              style={{ background: '#3D4A5C', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '12px 30px', font: "700 14px 'Nunito',sans-serif", cursor: 'pointer' }}
              hover={{ background: '#2E3947' }}
            >
              Close
            </Hover>
          </div>
        )}
      </div>
    </div>
  );
}
