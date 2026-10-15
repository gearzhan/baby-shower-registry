// 极简 Markdown 渲染器:仅支持 **粗体**、*斜体*、[文字](链接) 与空行分段,供主持人编辑的
// 欢迎语(event.welcome / event.registryWelcome)使用。输出 React 元素——所有文本始终是
// 文本节点,不经 dangerouslySetInnerHTML,天然免疫 XSS。

// 行内语法单趟扫描,优先级:链接 → 粗体 → 斜体;未闭合的星号原样保留。
// 链接 URL 在正则里就要求 https?://,javascript:/data: 等协议根本不会匹配,按字面文字显示。
// 强调内容首尾不得是空白(仿 CommonMark 两侧规则),否则 "5* hotel and *cozy*" 里
// 孤立的 "5*" 会误与后面的星号配对,把主持人没标记的文字斜体化。
const EMPH = '([^\\s*](?:[^*]*[^\\s*])?)';
const INLINE = new RegExp(`\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)|\\*\\*${EMPH}\\*\\*|\\*${EMPH}\\*`, 'g');

// 把一行纯文本解析成 React 节点数组(普通字符串 + 行内元素)
function renderInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) {
      // 链接:继承所在版面的文字颜色,仅以下划线区分——四种底色(含 Sky 照片上的白字)都协调
      out.push(
        <a key={out.length} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{m[1]}</a>
      );
    } else if (m[3]) {
      out.push(<strong key={out.length}>{m[3]}</strong>);
    } else {
      // 四个宾客界面的欢迎语本身就是斜体衬线字,斜中套斜在视觉上不可见:
      // 按古典排版惯例,斜体语境里的强调用正体(直立)呈现
      out.push(<em key={out.length} style={{ fontStyle: 'normal' }}>{m[4]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// <Markdown text={...} />:空值返回 null(未登录壳的 event.welcome 是 undefined);
// 空行分段(块级 span,合法嵌于任意父元素并继承其 font 简写);
// 段内单换行按严格 Markdown 语义合并为一个空格,不输出 <br>
export default function Markdown({ text }) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return t.split(/\n\s*\n/).map((para, pi) => (
    <span key={pi} style={{ display: 'block', marginTop: pi > 0 ? '0.6em' : 0 }}>
      {renderInline(para.replace(/\s*\n\s*/g, ' '))}
    </span>
  ));
}
