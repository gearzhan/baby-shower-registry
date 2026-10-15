// 后端种子数据（KV 缺省回退值）：读接口在对应 KV 键缺失时返回这里的默认；
// 主人在后台首次编辑后会把整份数据写入 KV 覆盖默认。
// 这里只放通用演示数据 —— 真实的活动、场地、礼物清单只存在于 KV，绝不写进仓库。
// 主人不在种子里：他们完全由 HOST_EMAILS 决定，见 kv.js getGuests()。

export const SEED_EVENT = {
  hosts: 'Alex & Sam',
  baby: 'Baby Bean',
  dateLabel: 'Saturday, March 14th',
  timeLabel: '2:00 – 5:00 PM',
  venueName: 'Your venue, Suburb',
  mapsUrl: '',
  rsvpBy: 'Saturday, February 28th',
  welcome: 'Pull up a chair for cake, games and warm wishes as our family grows by one!',
  // 礼物登记页顶部欢迎语（与旧版 Registry.jsx 里的硬编码文案一致，主人未编辑前宾客看不出变化）
  registryWelcome: "Your presence is truly the best present — but if you'd love to spoil the little one, here are a few ideas.",
  // 邀请邮件里的私人附言：默认为空 → 邮件与从前完全一致，主人写了才出现
  emailMessage: '',
  // "加入日历"的结构化时间（场地本地 'YYYY-MM-DDTHH:MM'）与 IANA 时区。getEvent() 逐字段合并种子，
  // 所以线上老的 event 在主人填写前读到的都是这里的 ''，'' 即不显示日历链接。
  // 绝不能放演示日期：那会在线上站点给出一条"看起来对、其实是编的"日程。dateLabel/timeLabel 仍是宾客读到的展示文字
  startsAt: '',
  endsAt: '',
  tz: '',
};

// 新部署默认 Garden：纯 CSS，不依赖任何插画文件；Wisteria Ink 的插画不随公开仓库附带（见 .gitignore）。
// 已有 design 键的站点不受影响（getDesign 整份读取，不与种子合并）
export const SEED_DESIGN = {
  theme: 'garden',
  bg: { type: 'none', dX: 50, dY: 50, pX: 50, pY: 50, dim: 25, mediaKey: '' },
};

// 收尾开关 rsvpClosed / registryClosed 只是把缺省值写明：读取处一律 === true，键缺失即"开放"，老配置无需迁移
export const SEED_CONFIG = { showPrices: true, showClaimerNames: false, rsvpClosed: false, registryClosed: false };

// 演示礼物：不带图片，前端用 ph(cat) 生成占位图；主人在后台上传的照片存 R2（imgKey）
export const SEED_ITEMS = [
  { id: 'g1', name: 'Fabric Storage Baskets', store: 'Baby Store', brand: '', cat: 'storage', desc: 'Three foldable canvas baskets for tidying toys and spare clothes on a shelf.', price: '$56.00', color: '', link: '', imgUrl: '' },
  { id: 'g2', name: 'Bottle Drying Rack', store: 'Baby Store', brand: '', cat: 'feeding', desc: 'Compact rack holding bottles, teats and pump parts upright while they dry.', price: '$24.95', color: '', link: '', imgUrl: '' },
  { id: 'g3', name: 'Musical Night Light', store: 'Baby Store', brand: '', cat: 'nursery', desc: 'Glows a gentle amber and plays soft tunes on a timer.', price: '$39.00', color: '', link: '', imgUrl: '' },
  { id: 'g4', name: 'Wooden Stacking Rings', store: 'Toy Shop', brand: '', cat: 'toys', desc: 'Smooth beech rings in graded sizes to grab, chew and stack.', price: '$32.50', color: '', link: '', imgUrl: '' },
  { id: 'g5', name: 'Nursery Rhyme Treasury', store: 'Bookshop', brand: '', cat: 'stories', desc: 'A big illustrated collection of classic rhymes to read aloud at bedtime.', price: '$27.50', color: '', link: '', imgUrl: '' },
  { id: 'g6', name: 'Pram Organiser', store: 'Baby Store', brand: '', cat: 'outings', desc: 'Clips onto the handlebar to hold keys, phone, snacks and a coffee cup.', price: '$44.00', color: 'Stone', link: '', imgUrl: '' },
];
