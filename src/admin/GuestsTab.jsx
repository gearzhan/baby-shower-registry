import { useStore } from '../store.jsx';
import { Hover, FocusInput, Toggle } from '../components/ui.jsx';
import { FONT } from '../theme.js';

// 宾客与 RSVP 标签页（原型 TAB: GUESTS 移植）：添加宾客 + 群发邀请/提醒/预览/导出 + 宾客列表 + RSVP 汇总（含关闭 RSVP 开关）
export default function GuestsTab() {
  const {
    guestRows, ngName, setNgName, ngEmail, setNgEmail, ngErr, addGuest,
    guestAct, sendAll, remindAll, unsent, openEmail, openRecordRsvp,
    addingGuest, sendingId, sendingAll, exportCsv, exporting,
    totYes, totAdults, totKids, totPending, notes, rsvpClosed, toggleConfig,
  } = useStore();

  // 本地派生：群发按钮文案 / 禁用态 / 透明度（群发中也算禁用）
  const sendAllLabel = sendingAll ? 'Sending…' : 'Send all unsent (' + unsent + ')';
  const sendAllDisabled = unsent === 0 || sendingAll || !!sendingId; // 单发进行中也不群发（见 store.sendAll）
  const sendAllOpacity = sendAllDisabled ? 0.5 : 1;
  // 提醒群发：数字就是 RSVP 汇总里的 Awaiting reply；真正发给谁、跳过谁（20 小时内发过信的）由服务端决定。
  // 邀请群发 / 单发邀请进行中禁用：它们都会重读再整键写回 guests，同时跑会互相盖掉 sentAt / remindedAt，
  // 单发的那位还没落 sentAt 就会被算进提醒、紧接着再收一封。
  // RSVP 已关闭时禁用（服务端也 423）：宾客此时回复不了，不该再催。
  const remindLabel = 'Remind all pending (' + totPending + ')';
  const remindDisabled = totPending === 0 || sendingAll || !!sendingId || rsvpClosed;

  const focusRing = { borderColor: '#A9C7E4', boxShadow: '0 0 0 3px rgba(169,199,228,.25)' };
  // 浅蓝行内按钮样式（发送 / 记录 RSVP / 编辑共用）
  const paleBtn = { background: '#EAF2F9', border: '1.5px solid #CBDDEE', color: '#47709A', borderRadius: '999px', padding: '7px 15px', font: `700 12px ${FONT.sans}`, cursor: 'pointer' };
  // 深色胶囊按钮：群发邀请 / 提醒群发共用
  const darkPill = { background: '#3D4A5C', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '11px 22px', font: `700 13px ${FONT.sans}`, cursor: 'pointer' };
  // 描边按钮：预览邮件 / 导出 CSV 共用
  const outlineBtn = { background: 'transparent', color: '#5B84AE', border: '1.5px solid #A9C7E4', borderRadius: '999px', padding: '10px 20px', font: `700 13px ${FONT.sans}`, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 宾客列表 & 邀请 */}
      <div style={{ background: '#FFFFFF', border: '1px solid #EAE3D4', borderRadius: '20px', padding: 'clamp(20px,4vw,34px)' }}>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '4px' }}>Guest list &amp; invitations</div>
        <div style={{ font: `600 13px ${FONT.sans}`, color: '#9AA3B2', marginBottom: '20px' }}>Invitations go out by email with a link that opens the invitation page. Guests verify their email to RSVP.</div>
        {/* 添加宾客行 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
          <FocusInput as="input" placeholder="Guest name" value={ngName} onChange={(e) => setNgName(e.currentTarget.value)} style={{ flex: '1', minWidth: '160px', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: `600 14px ${FONT.sans}`, outline: 'none', background: '#FFFFFF' }} focus={focusRing} />
          <FocusInput as="input" placeholder="email@example.com" value={ngEmail} onChange={(e) => setNgEmail(e.currentTarget.value)} style={{ flex: '1.4', minWidth: '200px', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: `600 14px ${FONT.sans}`, outline: 'none', background: '#FFFFFF' }} focus={focusRing} />
          {/* 添加中禁用：连点会创建重复宾客 */}
          <Hover as="button" onClick={addGuest} disabled={addingGuest} style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '12px 26px', font: `700 14px ${FONT.sans}`, cursor: addingGuest ? 'default' : 'pointer', opacity: addingGuest ? 0.6 : 1 }} hover={addingGuest ? null : { background: '#47709A' }}>{addingGuest ? 'Adding…' : 'Add guest'}</Hover>
        </div>
        {ngErr && <div style={{ font: `700 12.5px ${FONT.sans}`, color: '#C0715E', marginBottom: '6px' }}>{ngErr}</div>}
        {/* 群发邀请 / 提醒 / 预览 / 导出行 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '14px 0 18px' }}>
          <Hover as="button" onClick={sendAll} disabled={sendAllDisabled} style={{ ...darkPill, opacity: sendAllOpacity }} hover={{ background: '#2E3947' }}>{sendAllLabel}</Hover>
          {/* 提醒群发：先弹确认框（store 内部），发送中由确认框显示 Sending… 并挡住整页 */}
          <Hover as="button" onClick={remindAll} disabled={remindDisabled} title={rsvpClosed ? 'RSVPs are closed — reopen them to send reminders' : undefined} style={{ ...darkPill, cursor: remindDisabled ? 'default' : 'pointer', opacity: remindDisabled ? 0.5 : 1 }} hover={remindDisabled ? null : { background: '#2E3947' }}>{remindLabel}</Hover>
          <Hover as="button" onClick={openEmail} style={outlineBtn} hover={{ background: '#EAF2F9' }}>Preview invitation email</Hover>
          {/* 导出 CSV：点击时重新拉后台数据；导出中禁用 */}
          <Hover as="button" onClick={() => exportCsv('guests')} disabled={exporting} style={{ ...outlineBtn, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1 }} hover={exporting ? null : { background: '#EAF2F9' }}>{exporting ? 'Exporting…' : 'Export CSV'}</Hover>
        </div>
        {/* 宾客行列表（空时给指引） */}
        {guestRows.length === 0 && (
          <div style={{ textAlign: 'center', font: `italic 500 16px ${FONT.serif}`, color: '#8A94A6', padding: '24px 0' }}>No guests yet — add your first guest above.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {guestRows.map((g) => (
            <div key={g.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', border: '1px solid #EFE9DC', borderRadius: '14px', padding: '13px 16px', background: '#FDFCF8' }}>
              <div style={{ flex: '1', minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ font: `700 14px ${FONT.sans}`, color: '#3D4A5C' }}>{g.name}</div>
                <div style={{ font: `600 12.5px ${FONT.sans}`, color: '#9AA3B2' }}>{g.email}</div>
              </div>
              <div style={{ font: `700 11.5px ${FONT.sans}`, color: g.chipColor, background: g.chipBg, borderRadius: '999px', padding: '6px 13px', letterSpacing: '.03em' }}>{g.statusLabel}</div>
              <div style={{ flex: '1.2', minWidth: '170px', font: `600 12.5px ${FONT.sans}`, color: '#6C7889' }}>{g.rsvpLine}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {/* 发送中禁用该行按钮：连点会重复发邮件 */}
                <Hover as="button" onClick={() => guestAct(g.id, 'send')} disabled={sendingAll || !!sendingId} style={{ ...paleBtn, cursor: (sendingAll || sendingId) ? 'default' : 'pointer', opacity: (sendingAll || sendingId) ? 0.6 : 1 }} hover={(sendingAll || sendingId) ? null : { background: '#DCEAF6' }}>{sendingId === g.id ? 'Sending…' : g.sendLabel}</Hover>
                {/* 主人代填 RSVP（电话回复场景） */}
                <Hover as="button" onClick={() => openRecordRsvp(g.id)} style={paleBtn} hover={{ background: '#DCEAF6' }}>Record RSVP</Hover>
                {/* 改名 / 改错邮箱（主人行只能改名）。发信进行中禁用：发信结束时的"重读 - 改 - 整键写回"会把这次修改盖掉 */}
                <Hover as="button" onClick={() => guestAct(g.id, 'edit')} disabled={sendingAll || sendingId === g.id} style={{ ...paleBtn, cursor: (sendingAll || sendingId === g.id) ? 'default' : 'pointer', opacity: (sendingAll || sendingId === g.id) ? 0.6 : 1 }} hover={(sendingAll || sendingId === g.id) ? null : { background: '#DCEAF6' }}>Edit</Hover>
                {/* 主人不能被移出名单（后台入口就认这份名单，删了自己就把自己锁在门外了）——
                    服务端会拒绝，这里干脆不给按钮 */}
                {!g.isHost && (
                  <Hover as="button" onClick={() => guestAct(g.id, 'remove')} style={{ background: 'transparent', border: '1.5px solid #E8E1D3', color: '#A5AEBC', borderRadius: '999px', padding: '7px 13px', font: `700 12px ${FONT.sans}`, cursor: 'pointer' }} hover={{ borderColor: '#E0C9BF', color: '#C0715E' }}>Remove</Hover>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RSVP 汇总 */}
      <div style={{ background: '#FFFFFF', border: '1px solid #EAE3D4', borderRadius: '20px', padding: 'clamp(20px,4vw,34px)' }}>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '16px' }}>RSVP summary</div>
        {/* 收尾开关：关闭后宾客不能再回复/修改（服务端 423）；主人仍可用 Record RSVP 代填 */}
        <div style={{ display: 'flex', gap: '20px 34px', flexWrap: 'wrap', marginBottom: '18px', paddingBottom: '18px', borderBottom: '1px solid #EFE9DC' }}>
          <Toggle on={rsvpClosed} onClick={() => toggleConfig('rsvpClosed')} label="Close RSVPs" hint="Guests can’t reply or change — you can still Record RSVP" />
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
          <div style={{ flex: '1', minWidth: '120px', background: '#F0F6EC', border: '1px solid #DCE9D4', borderRadius: '14px', padding: '14px 18px' }}>
            <div style={{ font: `800 24px ${FONT.sans}`, color: '#5F8A54' }}>{totYes}</div>
            <div style={{ font: `700 11.5px ${FONT.sans}`, color: '#7FA06F', letterSpacing: '.08em', textTransform: 'uppercase' }}>Attending</div>
          </div>
          <div style={{ flex: '1', minWidth: '120px', background: '#EAF2F9', border: '1px solid #D5E4F1', borderRadius: '14px', padding: '14px 18px' }}>
            <div style={{ font: `800 24px ${FONT.sans}`, color: '#47709A' }}>{totAdults}</div>
            <div style={{ font: `700 11.5px ${FONT.sans}`, color: '#7C9BB9', letterSpacing: '.08em', textTransform: 'uppercase' }}>Adults</div>
          </div>
          <div style={{ flex: '1', minWidth: '120px', background: '#EAF2F9', border: '1px solid #D5E4F1', borderRadius: '14px', padding: '14px 18px' }}>
            <div style={{ font: `800 24px ${FONT.sans}`, color: '#47709A' }}>{totKids}</div>
            <div style={{ font: `700 11.5px ${FONT.sans}`, color: '#7C9BB9', letterSpacing: '.08em', textTransform: 'uppercase' }}>Children</div>
          </div>
          <div style={{ flex: '1', minWidth: '120px', background: '#FBF4E8', border: '1px solid #EEE0C8', borderRadius: '14px', padding: '14px 18px' }}>
            <div style={{ font: `800 24px ${FONT.sans}`, color: '#B08A4F' }}>{totPending}</div>
            <div style={{ font: `700 11.5px ${FONT.sans}`, color: '#C0A36B', letterSpacing: '.08em', textTransform: 'uppercase' }}>Awaiting reply</div>
          </div>
        </div>
        {notes.length > 0 && (
          <>
            <div style={{ font: `700 11.5px ${FONT.sans}`, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A94A6', marginBottom: '10px' }}>Dietary &amp; allergy notes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notes.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', border: '1px dashed #E5DECF', borderRadius: '12px', padding: '10px 14px', background: '#FDFCF8' }}>
                  <span style={{ font: `700 13px ${FONT.sans}`, color: '#3D4A5C' }}>{n.name}</span>
                  <span style={{ font: `600 13px ${FONT.sans}`, color: '#6C7889' }}>{n.line}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
