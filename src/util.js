// 通用派生逻辑：从原型 Component 的 ph()/enrich()/babyInitial 移植

// 生成占位图（斜线纹理 + 标签），返回 data URL —— 原型 ph() 原样移植
const _phCache = {};
export function ph(label) {
  label = label || 'gift';
  if (_phCache[label]) return _phCache[label];
  let lines = '';
  for (let i = -1; i < 14; i++) {
    const x = i * 44;
    lines += "<line x1='" + x + "' y1='480' x2='" + (x + 160) + "' y2='0'/>";
  }
  const s =
    "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='480'><rect width='480' height='480' fill='#F2EDE3'/><g stroke='#E8E1D2' stroke-width='9'>" +
    lines +
    "</g><rect x='90' y='212' rx='15' width='300' height='54' fill='#FFFFFF' opacity='0.9'/><text x='240' y='246' text-anchor='middle' font-family='monospace' font-size='19' fill='#94A0B2'>" +
    label +
    ' · photo</text></svg>';
  const u = 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
  _phCache[label] = u;
  return u;
}

// 礼物卡派生：图片源、认领态、品牌、Google 搜索链接等 —— 原型 enrich() 移植
// 图片优先级：R2 上传(imgKey) > 静态/粘贴 URL(imgUrl) > 占位图
export function enrichItem(it) {
  const r2 = it.imgKey ? '/api/media/' + it.imgKey : '';
  // claimed：优先看是否有认领者姓名；接口在隐藏姓名时会带 claimed 标记
  const claimed = !!it.claimedBy || it.claimed === true;
  const mine = it.mine === true; // 自己认领的（接口按会话身份标注）
  // brand 与 store 同名时不值得再显示一遍 —— 卡片上方就是 store 分组标题，弹窗 eyebrow 里 store 也紧挨着，
  // 而很多 store 本身就是品牌（品牌直营店），照抄一遍正是当初删掉 store eyebrow 的毛病。
  // 比较前去空格并折叠大小写。后台列表行故意不用这个判断：主人逐条补 brand 时要能同时看到两个值对照。
  // `it.brand || ''` 的兜底是必需的：KV 里存过的老记录没有 brand 键，读回来是 undefined。
  const brand = (it.brand || '').trim();
  const hasBrand = !!brand && brand.toLowerCase() !== (it.store || '').trim().toLowerCase();
  return {
    ...it,
    imgSrc: r2 || it.imgUrl || ph(it.cat || 'gift'),
    claimed,
    mine,
    hasBrand,
    hasColor: !!it.color,
    hasLink: !!(it.link && it.link.indexOf('http') === 0),
    // 自己挑的礼物不要灰掉 —— 它该看起来"选好了"，而不是"作废了"
    imgFilter: claimed && !mine ? 'grayscale(.55) opacity(.82)' : 'none',
    // 搜品牌比搜店名准；brand 为空（老条目、主人还没填）时退回 store，与改动前行为一致。
    // 这里用原始 brand 而不是 hasBrand —— 去重只是显示层的事，同名时搜哪个结果都一样。
    gUrl: 'https://www.google.com/search?q=' + encodeURIComponent((it.name || '') + ' ' + (brand || it.store || '')),
  };
}

// 这件礼物是否还在外链别人的图片（没有 R2 副本、imgUrl 是 https）：
// 决定后台是否显示 "Save image" 按钮，以及批量转存的计数 —— 两处共用这一个判断，按钮数和批量范围永远一致。
// 服务端会做更严格的校验（公网主机名、跳转、大小、魔数）；http:// 链接不给按钮。
export function hasExternalImg(it) {
  return !it.imgKey && /^https:\/\//i.test((it.imgUrl || '').trim());
}

// 邮箱形状校验：与后端 admin/guests 的 addGuest / editGuest 是同一条规则（Resend 能接收的最小形状）。
// 拦住 a@b / anne@ / "john smith@x.com" 这类必然发不出去的地址。前端只此一份：添加宾客、编辑宾客、登录都用它
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 宝宝名首字母（取最后一个词的首字母大写）—— 原型 babyInitial 移植
export function babyInitialOf(baby) {
  return ((baby || 'B').trim().split(/\s+/).pop() || 'B').charAt(0).toUpperCase();
}

// 按 Store 分组，返回 { ungrouped, groups }，groups 按店名字母序 A→Z。
// store 是自由文本、全站没有归一化，而两处分组标题都是 uppercase 渲染 ——
// 所以必须折叠大小写：否则 'Shop A' 和 'shop a' 会分裂成两个长得一模一样的 SHOP A 标题。
// Map 用折叠后的值做键，但显示时保留首次出现的原始写法。
// store 为空的条目进 ungrouped（主人新建条目时 store 默认就是空串，漏填要看得见）。
export function groupByStore(items) {
  const ungrouped = [];
  const map = new Map(); // 归一化店名 → { store, items }
  for (const it of items) {
    const store = (it.store || '').trim();
    if (!store) {
      ungrouped.push(it);
      continue;
    }
    const g = map.get(store.toLowerCase());
    if (g) g.items.push(it);
    else map.set(store.toLowerCase(), { store, items: [it] });
  }
  const groups = [...map.values()].sort((a, b) => a.store.localeCompare(b.store));
  return { ungrouped, groups };
}

// 把一段文本存成本地文件（Blob + 隐藏的 <a download>）。CSV 导出和日历 .ics 共用这一个，别再另写一份。
// 参数顺序固定为 (filename, text, mime)。Blob URL 60 秒后才回收：点击触发下载是异步的，立刻回收可能存出空文件；
// iOS Safari 还会先弹"是否下载"确认框，用户点下去才读 Blob —— 回收早了就是 WebKitBlobResource 错误 1、下载失败
// （FileSaver.js 为此等 40 秒）。只是一小段文本，多留一会儿没有代价。
export function downloadFile(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
