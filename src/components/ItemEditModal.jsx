import { useStore } from '../store.jsx';
import { Hover, FocusInput, useEscClose } from '../components/ui.jsx';
import { FONT } from '../theme.js';
import { ph } from '../util.js';

// 礼物编辑弹窗（原型 ITEM EDIT MODAL 移植）：仅在 editOpen 时渲染，新增/编辑礼物
export default function ItemEditModal() {
  const { editOpen, ef, onEditField, saveItem, savingItem, closeEdit, editErr, uploadItemImg } = useStore();

  // Escape 关闭（须在提前返回之前调用 —— Rules of Hooks）；closeEdit 自己会处理保存中的情况
  useEscClose(editOpen, closeEdit);

  if (!editOpen) return null;

  // ef 可能为空，做兜底
  const f = ef || {};
  const editTitle = f.id ? 'Edit item' : 'Add registry item';
  // 预览优先级：本次上传预览 > 粘贴 URL > 已存照片(imgKey) > 占位图。
  // URL 排在 imgKey 之前，输入即所见；删空 URL 后又落回 imgKey，照片自动「复原」。
  const editImgSrc = f.imgPreview || (f.imgUrl || '').trim() || (f.imgKey ? '/api/media/' + f.imgKey : '') || ph(f.cat || 'gift');
  // 阻止内层点击冒泡到遮罩
  const swallow = (e) => e.stopPropagation();

  const labelSpan = { font: `700 11px ${FONT.sans}`, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A94A6' };
  const inputStyle = { width: '100%', padding: '12px 14px', border: '1.5px solid #E2DCCE', borderRadius: '12px', font: `600 14px ${FONT.sans}`, outline: 'none', background: '#FFFFFF' };
  const focusRing = { borderColor: '#A9C7E4' };

  // 文本字段定义（full 表示占满整行）
  const fields = [
    { k: 'name', label: 'Item name', full: true },
    { k: 'store', label: 'Store' },
    { k: 'brand', label: 'Brand (optional)' },
    { k: 'price', label: 'Price', placeholder: '$0.00' },
    { k: 'color', label: 'Colour (optional)' },
    { k: 'link', label: 'Product link', placeholder: 'https://…', full: true },
  ];

  return (
    <div data-screen-label="Item editor" onClick={closeEdit} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(30,40,55,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', animation: 'bsFadeIn .25s' }}>
      <div role="dialog" aria-modal="true" aria-label={editTitle} onClick={swallow} style={{ position: 'relative', width: 'min(620px,100%)', maxHeight: '94vh', overflow: 'auto', background: '#FFFDF8', borderRadius: '22px', boxShadow: '0 30px 90px rgba(20,32,48,.35)', animation: 'bsPopUp .3s', padding: 'clamp(20px,4vw,30px)' }}>
        <Hover as="button" aria-label="Close" onClick={closeEdit} style={{ position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px', borderRadius: '50%', border: '1px solid #E7E0D2', background: '#FFFFFF', color: '#8A94A6', font: `700 15px ${FONT.sans}`, cursor: 'pointer' }} hover={{ color: '#3D4A5C' }}>✕</Hover>
        <div style={{ font: `800 16px ${FONT.sans}`, marginBottom: '18px' }}>{editTitle}</div>

        {/* 图片预览 + 上传/粘贴 URL */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '16px' }}>
          <img src={editImgSrc} alt="" style={{ width: '104px', height: '104px', borderRadius: '14px', objectFit: 'cover', background: '#F4F0E8', border: '1px solid #EDE6D9' }} />
          <div style={{ flex: '1', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {/* 照片上传：直传 R2（uploadItemImg），返回 key 写进表单并即时预览 */}
            <Hover as="label" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#EAF2F9', border: '1.5px solid #CBDDEE', color: '#47709A', borderRadius: '999px', padding: '10px 18px', font: `700 13px ${FONT.sans}`, cursor: 'pointer', alignSelf: 'flex-start' }} hover={{ background: '#DCEAF6' }}>
              Upload photo
              <input type="file" accept="image/*" onChange={(e) => { const file = e.currentTarget.files && e.currentTarget.files[0]; if (file) uploadItemImg(file); e.currentTarget.value = ''; }} style={{ display: 'none' }} />
            </Hover>
            <FocusInput as="input" placeholder="…or paste an image URL" value={f.imgUrl || ''} onChange={(e) => onEditField('imgUrl', e.currentTarget.value)} style={{ width: '100%', padding: '11px 13px', border: '1.5px solid #E2DCCE', borderRadius: '11px', font: `600 13px ${FONT.sans}`, outline: 'none', background: '#FFFFFF' }} focus={focusRing} />
            <div style={{ font: `600 11.5px ${FONT.sans}`, color: '#A5AEBC' }}>Photos are cropped to a square automatically.</div>
          </div>
        </div>

        {/* 字段网格 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '13px' }}>
          {fields.map((fl) => (
            <label key={fl.k} style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...(fl.full ? { gridColumn: '1/-1' } : null) }}>
              <span style={labelSpan}>{fl.label}</span>
              <FocusInput as="input" placeholder={fl.placeholder} value={f[fl.k] || ''} onChange={(e) => onEditField(fl.k, e.currentTarget.value)} style={inputStyle} focus={focusRing} />
            </label>
          ))}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1/-1' }}>
            <span style={labelSpan}>Description</span>
            <FocusInput as="textarea" rows="3" value={f.desc || ''} onChange={(e) => onEditField('desc', e.currentTarget.value)} style={{ ...inputStyle, font: `600 14px/1.5 ${FONT.sans}`, resize: 'vertical' }} focus={focusRing} />
          </label>
        </div>

        {editErr && <div style={{ font: `700 13px ${FONT.sans}`, color: '#C0715E', marginTop: '12px' }}>{editErr}</div>}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px' }}>
          {/* 提交中禁用：新建礼物没有 id，连点两次会创建两条记录 */}
          <Hover as="button" onClick={saveItem} disabled={savingItem} style={{ background: '#5B84AE', color: '#FFFFFF', border: 'none', borderRadius: '999px', padding: '13px 30px', font: `700 14px ${FONT.sans}`, cursor: savingItem ? 'default' : 'pointer', opacity: savingItem ? 0.6 : 1 }} hover={savingItem ? null : { background: '#47709A' }}>{savingItem ? 'Saving…' : 'Save item'}</Hover>
          <Hover as="button" onClick={closeEdit} style={{ background: 'transparent', color: '#8A94A6', border: '1.5px solid #E2DCCE', borderRadius: '999px', padding: '12px 24px', font: `700 14px ${FONT.sans}`, cursor: 'pointer' }} hover={{ background: '#F4F1E9' }}>Cancel</Hover>
        </div>
      </div>
    </div>
  );
}
