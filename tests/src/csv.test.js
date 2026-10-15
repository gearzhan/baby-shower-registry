// src/csv.js：主人后台的 CSV 导出（纯函数）。引号转义、公式注入防护、BOM + CRLF、本地时区日期、列与行序。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { csvCell, toCsv, csvDate, guestsCsv, registryCsv } from '../../src/csv.js';
import { groupByStore } from '../../src/util.js';

// 最小 RFC 4180 解析器（每格都带引号、CRLF 分行），用来做往返校验
function parse(text) {
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const t = text.slice(1);
  const rows = [];
  let row = [];
  let i = 0;
  while (i < t.length) {
    expect(t[i]).toBe('"');
    i++;
    let v = '';
    for (;;) {
      if (t[i] === '"') {
        if (t[i + 1] === '"') {
          v += '"';
          i += 2;
          continue;
        }
        i++;
        break;
      }
      v += t[i++];
    }
    row.push(v);
    if (t[i] === ',') {
      i++;
      continue;
    }
    expect(t.slice(i, i + 2)).toBe('\r\n');
    i += 2;
    rows.push(row);
    row = [];
  }
  return rows;
}

const GUEST_HEADER = ['Name', 'Email', 'Invitation', 'Invited at', 'Reminded at', 'RSVP', 'Adults', 'Children', 'Dietary', 'Allergies', 'RSVP at'];
const REGISTRY_HEADER = ['Item', 'Store', 'Brand', 'Price', 'Status', 'Claimed by', 'Claimer email', 'Claimed at', 'Received at', 'Thanked at'];

describe('cells and files', () => {
  it('quotes every cell and doubles inner quotes', () => {
    expect(csvCell('a"b,c')).toBe('"a""b,c"');
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('formula guard: a leading = + - @ TAB CR LF gets an apostrophe', () => {
    for (const p of ['=', '+', '-', '@', '\t', '\r', '\n']) expect(csvCell(p + 'x')).toBe('"\'' + p + 'x"');
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('a=1')).toBe('"a=1"');
    expect(csvCell(' =1')).toBe('" =1"');
    expect(csvCell("'already")).toBe(`"'already"`);
  });

  it('BOM first, CRLF line endings, no bare LF outside cells', () => {
    const s = toCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    expect(s).toBe('\uFEFF"a","b"\r\n"1","2"\r\n"3","4"\r\n');
    expect(Buffer.from(s, 'utf8').subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(s.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(toCsv(['a'], [])).toBe('\uFEFF"a"\r\n');
  });

  it('the BOM is written as an explicit escape in the source (no invisible literal)', () => {
    const src = readFileSync(new URL('../../src/csv.js', import.meta.url), 'utf8');
    expect(src.includes(String.fromCharCode(0xfeff))).toBe(false);
    expect(src).toContain("'\\uFEFF'");
    // 本测试文件同样只用转义：期望值里的不可见 BOM 一旦被编辑器吃掉，失败输出里两边看起来一模一样
    const self = readFileSync(new URL(import.meta.url), 'utf8');
    expect(self.includes(String.fromCharCode(0xfeff))).toBe(false);
  });
});

describe('csvDate', () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    // process.env 赋 undefined 会变成字符串 'undefined'，所以没设过就删掉
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it('DD-MM-YYYY HH:mm in local time; blank for empty or invalid', () => {
    expect(csvDate(new Date(2026, 0, 5, 9, 7).getTime())).toBe('05-01-2026 09:07');
    expect(csvDate(new Date(2026, 11, 31, 23, 59).getTime())).toBe('31-12-2026 23:59');
    expect(csvDate(new Date(2026, 0, 5, 0, 3).getTime(), false)).toBe('05-01-2026');
    expect(csvDate(new Date(2026, 9, 14, 0, 1).getTime(), false)).toBe('14-10-2026');
    for (const v of [0, null, undefined, 'not a date', NaN]) expect(csvDate(v)).toBe('');
    expect(csvDate(new Date(2025, 5, 1, 13, 45).toISOString())).toBe('01-06-2025 13:45'); // 老记录里的 ISO 字符串
  });

  it('follows the host’s time zone, not UTC (the same instant is a different local day)', () => {
    const inst = Date.UTC(2026, 9, 13, 16, 30);
    const at = (tz) => {
      process.env.TZ = tz;
      return csvDate(inst) + '|' + csvDate(inst, false);
    };
    expect(at('UTC')).toBe('13-10-2026 16:30|13-10-2026');
    expect(at('Asia/Tokyo')).toBe('14-10-2026 01:30|14-10-2026');
    expect(at('America/Los_Angeles')).toBe('13-10-2026 09:30|13-10-2026');
  });
});

const guests = [
  { id: 'host-hostexamplecom', name: 'host', email: 'host@example.com', sentAt: null, isHost: true, rsvp: null },
  { id: 'u1', name: '=HYPERLINK("http://x","y")', email: 'evil@example.com', sentAt: new Date(2026, 9, 1, 10, 0).getTime(), remindedAt: new Date(2026, 9, 2, 9, 15).getTime(), isHost: false, rsvp: { attending: 'no', adults: 3, kids: 2, dietary: '', allergies: '', at: new Date(2026, 9, 2, 11, 30).getTime() } },
  { id: 'u2', name: 'Renée "Ree" Núñez, Jr. 张伟', email: 'renee@example.com', sentAt: new Date(2026, 9, 1, 10, 0).getTime(), isHost: false, rsvp: { attending: 'yes', adults: 2, kids: 1, dietary: "\t=cmd|' /C calc'!A0", allergies: '@peanuts\nshellfish, "tree nuts"', at: new Date(2026, 9, 3, 8, 5).getTime(), byHost: true } },
  { id: 'u3', name: 'Pending Pat', email: 'pat@example.com', sentAt: null, isHost: false, rsvp: null },
  { id: 'u4', name: 'Yes NoCounts', email: 'y@example.com', sentAt: 1, isHost: false, rsvp: { attending: 'yes', at: 0 } },
];

describe('guestsCsv', () => {
  it('columns, values and roster order', () => {
    const rows = parse(guestsCsv(guests));
    expect(rows[0]).toEqual(GUEST_HEADER);
    for (const r of rows) expect(r).toHaveLength(11);
    expect(rows.slice(1).map((r) => r[1])).toEqual(guests.map((g) => g.email));
    expect(rows[1]).toEqual(['host', 'host@example.com', 'Host', '', '', 'No reply', '', '', '', '', '']);
    expect(rows[2]).toEqual([`'=HYPERLINK("http://x","y")`, 'evil@example.com', 'Sent', '01-10-2026 10:00', '02-10-2026 09:15', 'Declined', '0', '0', '', '', '02-10-2026 11:30']);
    expect(rows[3]).toEqual(['Renée "Ree" Núñez, Jr. 张伟', 'renee@example.com', 'Sent', '01-10-2026 10:00', '', 'Attending', '2', '1', `'=cmd|' /C calc'!A0`, `'@peanuts\nshellfish, "tree nuts"`, '03-10-2026 08:05']);
    expect(rows[4]).toEqual(['Pending Pat', 'pat@example.com', 'Not sent', '', '', 'No reply', '', '', '', '', '']);
    expect(rows[5].slice(5)).toEqual(['Attending', '0', '0', '', '', '']);
    expect(guestsCsv([])).toBe('\uFEFF' + GUEST_HEADER.map((h) => `"${h}"`).join(',') + '\r\n');
  });

  it('a declined guest’s stale dietary / allergies are left blank', () => {
    const at = new Date(2026, 9, 4, 9, 0).getTime();
    const rows = parse(
      guestsCsv([
        { id: 'd1', name: 'Changed Mind', email: 'cm@example.com', sentAt: at, rsvp: { attending: 'no', adults: 2, kids: 1, dietary: '  vegan ', allergies: 'peanuts', at } },
        { id: 'd2', name: 'Odd Value', email: 'ov@example.com', sentAt: at, rsvp: { attending: 'maybe', dietary: 'halal', allergies: 'shellfish', at } },
        { id: 'd3', name: 'Coming', email: 'c@example.com', sentAt: at, rsvp: { attending: 'yes', adults: 1, dietary: '  vegan ', allergies: 'peanuts', at } },
      ])
    );
    expect(rows[1].slice(5)).toEqual(['Declined', '0', '0', '', '', '04-10-2026 09:00']);
    expect(rows[2].slice(5, 10)).toEqual(['Declined', '0', '0', '', '']);
    expect(rows[3].slice(5, 10)).toEqual(['Attending', '1', '0', 'vegan', 'peanuts']);
  });

  it('Reminded at: blank when never reminded or the stamp is bad', () => {
    const inv = new Date(2026, 9, 1, 10, 0).getTime();
    const rem = new Date(2026, 9, 13, 19, 5).getTime();
    const rows = parse(
      guestsCsv([
        { id: 'p1', name: 'P1', email: 'p1@example.com', sentAt: inv, remindedAt: rem, rsvp: null },
        { id: 'p2', name: 'P2', email: 'p2@example.com', sentAt: inv, rsvp: null },
        { id: 'p3', name: 'P3', email: 'p3@example.com', sentAt: inv, remindedAt: rem, rsvp: { attending: 'yes', adults: 1, at: rem + 60000 } },
        { id: 'p4', name: 'P4', email: 'p4@example.com', sentAt: inv, remindedAt: 'garbage', rsvp: null },
      ])
    );
    expect(rows[1].slice(2, 6)).toEqual(['Sent', '01-10-2026 10:00', '13-10-2026 19:05', 'No reply']);
    expect(rows[2][4]).toBe('');
    expect(rows[3].slice(4, 6)).toEqual(['13-10-2026 19:05', 'Attending']);
    expect(rows[3][10]).toBe('13-10-2026 19:06');
    expect(rows[4][4]).toBe('');
  });
});

describe('registryCsv', () => {
  const claimAt = new Date(2026, 9, 10, 14, 20).getTime();
  const items = [
    { id: 'g1', name: 'Storage Baskets', store: 'Baby Store', brand: '', price: '$56.00', claimedBy: 'host', claimedAt: claimAt, claimedById: 'host-hostexamplecom', was: '$65' },
    { id: 'g4', name: 'Stacking Rings', store: 'Toy Shop', brand: 'Acme', price: '$32.50' },
    { id: 'g5', name: 'Rhyme Book', store: 'Bookshop', price: '$27.50' }, // 老条目：没有 brand 键
    { id: 'x1', name: 'Unsorted thing', store: '', brand: 'NoStore', price: '' },
    { id: 'g2', name: 'Drying Rack', store: 'baby store', brand: 'Baby Store', price: '$24.95', claimedBy: 'Old Name', claimedAt: claimAt, claimedById: '' }, // 老格式认领
    { id: 'c1', name: '-2+3', store: '+Shop', brand: '@Brand', price: '$10' },
    { id: 'g6', name: 'Pram Organiser', store: 'Baby Store', brand: '', price: '$44.00', claimedBy: 'Renée "Ree" Núñez, Jr. 张伟', claimedAt: claimAt, claimedById: 'u2' },
    { id: 'g7', name: 'Ghost claimer', store: 'Toy Shop', claimedBy: '', claimedAt: claimAt, claimedById: 'gone' },
    { id: 'g8', name: 'Bad date', store: 'Toy Shop', claimedBy: 'Someone', claimedAt: 'garbage', claimedById: '' },
  ];

  it('columns, legacy claims, claimer email from the roster, groupByStore order, no `was`', () => {
    const text = registryCsv(items, guests);
    const rows = parse(text);
    expect(rows[0]).toEqual(REGISTRY_HEADER);
    expect(rows).toHaveLength(items.length + 1);
    const { ungrouped, groups } = groupByStore(items);
    const expected = [...ungrouped, ...groups.flatMap((s) => s.items)].map((it) => it.name);
    expect(rows.slice(1).map((r) => r[0].replace(/^'(?=[=+\-@\t\r\n])/, ''))).toEqual(expected);
    expect(rows.slice(1).map((r) => r[1])).toEqual(['', "'+Shop", 'Baby Store', 'baby store', 'Baby Store', 'Bookshop', 'Toy Shop', 'Toy Shop', 'Toy Shop']);
    const by = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
    expect(by['Storage Baskets']).toEqual(['Storage Baskets', 'Baby Store', '', '$56.00', 'Claimed', 'host', 'host@example.com', '10-10-2026 14:20', '', '']);
    expect(by['Drying Rack']).toEqual(['Drying Rack', 'baby store', 'Baby Store', '$24.95', 'Claimed', 'Old Name', '', '10-10-2026 14:20', '', '']);
    expect(by['Rhyme Book']).toEqual(['Rhyme Book', 'Bookshop', '', '$27.50', 'Available', '', '', '', '', '']);
    expect(by["'-2+3"]).toEqual(["'-2+3", "'+Shop", "'@Brand", '$10', 'Available', '', '', '', '', '']);
    expect(by['Pram Organiser'].slice(4, 7)).toEqual(['Claimed', 'Renée "Ree" Núñez, Jr. 张伟', 'renee@example.com']);
    expect(by['Ghost claimer'].slice(4, 8)).toEqual(['Claimed', '', '', '10-10-2026 14:20']);
    expect(by['Bad date'].slice(4, 8)).toEqual(['Claimed', 'Someone', '', '']);
    expect(text).not.toContain('$65');
    expect(parse(registryCsv([], guests))).toHaveLength(1);
  });

  it('claimer name falls back to the roster name when claimedBy is blank', () => {
    const rows = parse(registryCsv([{ id: 'q', name: 'Q', store: 'S', claimedBy: '', claimedById: 'u3', claimedAt: claimAt }], guests));
    expect(rows[1].slice(4)).toEqual(['Claimed', 'Pending Pat', 'pat@example.com', '10-10-2026 14:20', '', '']);
  });

  it('Received at / Thanked at only on claimed rows', () => {
    const recAt = new Date(2026, 9, 12, 9, 5).getTime();
    const thxAt = new Date(2026, 9, 13, 18, 45).getTime();
    const rows = parse(
      registryCsv(
        [
          { id: 'r1', name: 'Received only', store: 'S', claimedBy: 'Renée', claimedById: 'u2', claimedAt: claimAt, receivedAt: recAt, thankedAt: null },
          { id: 'r2', name: 'Both', store: 'S', claimedBy: 'host', claimedById: 'host-hostexamplecom', claimedAt: claimAt, receivedAt: recAt, thankedAt: thxAt },
          { id: 'r5', name: 'Unclaimed stray', store: 'S', receivedAt: recAt, thankedAt: thxAt },
          { id: 'r6', name: 'Bad stamps', store: 'S', claimedBy: 'y', claimedById: '', claimedAt: claimAt, receivedAt: 'garbage', thankedAt: NaN },
        ],
        guests
      )
    );
    const by = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
    expect(by['Received only'].slice(7)).toEqual(['10-10-2026 14:20', '12-10-2026 09:05', '']);
    expect(by['Both'].slice(7)).toEqual(['10-10-2026 14:20', '12-10-2026 09:05', '13-10-2026 18:45']);
    expect(by['Unclaimed stray'].slice(4)).toEqual(['Available', '', '', '', '', '']);
    expect(by['Bad stamps'].slice(7)).toEqual(['10-10-2026 14:20', '', '']);
  });
});
