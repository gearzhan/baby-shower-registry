// functions/lib/calendar.js："加入日历"的纯逻辑。输入校验（往返、IANA 形状）、场地本地时间 → UTC（含夏令时边界）、
// .ics（RFC 5545 转义 / 折行 / CRLF / 防注入）与 Google Calendar 链接。
import { describe, it, expect } from 'vitest';
import { cleanLocal, cleanTz, zonedToUtc, calendarTimes, addMinutesLocal, buildIcs, googleCalendarUrl } from '../../functions/lib/calendar.js';

const site = 'https://example.com/';
const NOW = new Date('2026-10-13T00:00:00Z');
const base = { hosts: 'Alex & Sam', baby: 'Baby Bean', venueName: 'Hall 2; Level 3, Suburb', mapsUrl: '', startsAt: '2027-03-14T14:00', endsAt: '2027-03-14T17:00', tz: 'Asia/Tokyo' };
const prop = (ics, name) => {
  const l = ics.split('\r\n').find((x) => x.startsWith(name + ':'));
  return l == null ? null : l.slice(name.length + 1);
};
const unfold = (ics) => ics.replace(/\r\n /g, '');
const iso = (ms) => (ms == null ? ms : new Date(ms).toISOString());
const u8 = (s) => Buffer.byteLength(s, 'utf8');

describe('cleanLocal', () => {
  it.each([
    ['', ''],
    [undefined, ''],
    [null, ''],
    ['2027-03-14T13:00', '2027-03-14T13:00'],
    ['2027-03-14T13:00:30', '2027-03-14T13:00'],
    ['2028-02-29T10:00', '2028-02-29T10:00'],
  ])('%j → %j', (v, want) => expect(cleanLocal(v)).toBe(want));

  it.each([
    '2027-02-30T10:00', // V8 会滚到 03-02：往返校验拦住
    '2027-03-14T24:00',
    '2027-02-29T10:00',
    '2027-03-14T13:60',
    '2027-03-14T13:00:60',
    '2027-13-01T10:00',
    '2027-03-14 13:00',
    '2027-03-14T13:00\r\nX:1',
    '2027-03-14T13:00\n',
    '2027-03-14T13:00Z',
    42,
    {},
    '２０２７-03-14T13:00',
  ])('rejects %j', (v) => expect(cleanLocal(v)).toBeNull());
});

describe('cleanTz', () => {
  it('accepts IANA names, empty is ""', () => {
    expect(cleanTz('')).toBe('');
    expect(cleanTz(undefined)).toBe('');
    for (const z of ['Europe/London', 'UTC', 'America/Argentina/Buenos_Aires', 'Etc/GMT+10']) expect(cleanTz(z)).toBe(z);
  });

  it('rejects offsets (Intl may accept them, Google ctz= does not), unknown zones, CRLF, non-strings, > 64 chars', () => {
    for (const z of ['+10:00', '-05:00', 'Mars/Base', 'A'.repeat(65), 'Europe/London\r\nX', 10]) expect(cleanTz(z)).toBeNull();
  });

  it('accepts every zone this runtime’s Intl knows', () => {
    const bad = Intl.supportedValuesOf('timeZone').filter((z) => cleanTz(z) !== z);
    expect(bad).toEqual([]);
  });
});

describe('zonedToUtc', () => {
  it.each([
    ['2027-03-14T14:00', 'Asia/Tokyo', '2027-03-14T05:00:00.000Z'], // +9，无夏令时
    ['2027-07-10T14:00', 'Europe/London', '2027-07-10T13:00:00.000Z'], // 夏令时 BST +1
    ['2027-01-16T14:00', 'Europe/London', '2027-01-16T14:00:00.000Z'], // 冬令时 GMT +0
    ['2027-03-14T13:00', 'UTC', '2027-03-14T13:00:00.000Z'],
    ['2027-10-30T23:00', 'Europe/London', '2027-10-30T22:00:00.000Z'], // 回拨前一天（10-31 01:00 UTC 回拨）
    ['2027-10-31T04:00', 'Europe/London', '2027-10-31T04:00:00.000Z'], // 回拨后
    ['2027-03-28T00:30', 'Europe/London', '2027-03-28T00:30:00.000Z'], // 跳表前（03-28 01:00 UTC 跳到 02:00）
    ['2027-03-28T02:30', 'Europe/London', '2027-03-28T01:30:00.000Z'], // 跳表后
    ['2027-03-28T01:30', 'Europe/London', '2027-03-28T01:30:00.000Z'], // 不存在的时刻 → 切换前的偏移（GMT +0）
    ['2027-03-14T02:30', 'America/New_York', '2027-03-14T06:30:00.000Z'],
    ['2027-03-14T03:00', 'America/New_York', '2027-03-14T07:00:00.000Z'],
    ['2027-11-07T00:30', 'America/New_York', '2027-11-07T04:30:00.000Z'],
    ['2027-11-07T03:00', 'America/New_York', '2027-11-07T08:00:00.000Z'],
    ['2027-03-14T00:00', 'Asia/Tokyo', '2027-03-13T15:00:00.000Z'], // 本地午夜 → UTC 的前一天
    ['2027-03-14T13:00', 'Asia/Kolkata', '2027-03-14T07:30:00.000Z'],
    ['2027-03-14T13:00', 'Asia/Kathmandu', '2027-03-14T07:15:00.000Z'],
  ])('%s in %s → %s', (local, tz, want) => expect(iso(zonedToUtc(local, tz))).toBe(want));

  it('the repeated fall-back hour picks one of its two instants', () => {
    expect(['2027-10-31T00:30:00.000Z', '2027-10-31T01:30:00.000Z']).toContain(iso(zonedToUtc('2027-10-31T01:30', 'Europe/London')));
  });

  it('bad zone or date → null', () => {
    expect(zonedToUtc('2027-03-14T13:00', 'Mars/Base')).toBeNull();
    expect(zonedToUtc('2027-02-30T13:00', 'UTC')).toBeNull();
  });
});

describe('calendarTimes / addMinutesLocal', () => {
  it('needs all three fields, valid, with end after start', () => {
    const ct = calendarTimes(base);
    expect(iso(ct.start)).toBe('2027-03-14T05:00:00.000Z');
    expect(iso(ct.end)).toBe('2027-03-14T08:00:00.000Z');
    expect(ct.tz).toBe('Asia/Tokyo');
    expect(calendarTimes({ ...base, endsAt: '2027-03-14T12:00' })).toBeNull();
    expect(calendarTimes({ ...base, endsAt: base.startsAt })).toBeNull();
    expect(calendarTimes({ ...base, tz: '' })).toBeNull();
    expect(calendarTimes({ ...base, startsAt: '' })).toBeNull();
    expect(calendarTimes({ hosts: 'A', baby: 'B' })).toBeNull(); // 未登录的 teaser
    expect(calendarTimes(undefined)).toBeNull();
    expect(calendarTimes({ ...base, startsAt: '2027-03-14T22:00', endsAt: '2027-03-15T01:00' })).not.toBeNull();
  });

  it('adds minutes to a wall-clock time', () => {
    expect(addMinutesLocal('2027-03-14T14:00', 180)).toBe('2027-03-14T17:00');
    expect(addMinutesLocal('2027-03-14T22:30', 180)).toBe('2027-03-15T01:30');
    expect(addMinutesLocal('2027-12-31T23:00', 180)).toBe('2028-01-01T02:00');
    expect(addMinutesLocal('', 180)).toBe('');
  });
});

describe('buildIcs', () => {
  const ics = buildIcs(base, site, NOW);

  it('emits the event in UTC with a stable UID and a time-based SEQUENCE', () => {
    expect(prop(ics, 'DTSTART')).toBe('20270314T050000Z');
    expect(prop(ics, 'DTEND')).toBe('20270314T080000Z');
    expect(prop(ics, 'DTSTAMP')).toBe('20261013T000000Z');
    expect(prop(ics, 'SEQUENCE')).toBe('1791849600');
    expect(Number(prop(buildIcs(base, site, new Date('2026-10-14T00:00:00Z')), 'SEQUENCE'))).toBe(1791849600 + 86400);
    expect(prop(ics, 'UID')).toBe('baby-shower@example.com');
    expect(prop(ics, 'SUMMARY')).toBe('Baby Shower for Baby Bean');
    expect(prop(ics, 'LOCATION')).toBe('Hall 2\\; Level 3\\, Suburb');
    expect(prop(ics, 'URL')).toBe(site);
    expect(prop(unfold(ics), 'DESCRIPTION')).toBe('Hosted by Alex & Sam.\\nInvitation\\, RSVP & registry: https://example.com/');
  });

  it('CRLF everywhere, header and footer in order', () => {
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(/[^\r]\n/.test(ics) || /\r[^\n]/.test(ics)).toBe(false);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Baby Shower//Invitation//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\n')).toBe(true);
  });

  it('null when the calendar fields are unusable', () => {
    expect(buildIcs({ ...base, endsAt: '2027-03-14T12:00' }, site, NOW)).toBeNull();
    expect(buildIcs({ ...base, tz: '' }, site, NOW)).toBeNull();
  });

  it('omits empty parts and keeps only http(s) map links', () => {
    const empty = buildIcs({ ...base, hosts: '', baby: '', venueName: '   ' }, site, NOW);
    expect(prop(empty, 'SUMMARY')).toBe('Baby Shower');
    expect(prop(empty, 'LOCATION')).toBeNull();
    expect(prop(unfold(empty), 'DESCRIPTION')).toBe('Invitation\\, RSVP & registry: https://example.com/');
    expect(prop(unfold(buildIcs({ ...base, mapsUrl: 'https://maps.google.com/?q=a,b' }, site, NOW)), 'DESCRIPTION')).toMatch(/\\nMap: https:\/\/maps\.google\.com\/\?q=a\\,b$/);
    expect(prop(unfold(buildIcs({ ...base, mapsUrl: 'javascript:alert(1)' }, site, NOW)), 'DESCRIPTION')).not.toContain('javascript');
  });

  it('host text can’t inject properties: escapes \\ ; , and newlines, strips control characters', () => {
    const evil = buildIcs({ ...base, hosts: 'A\\B;C,D\r\nEND:VEVENT\nX\rY', baby: 'Bean\u0000\u0007\u001b\u007f!', venueName: 'Line1\nLine2\tTab' }, site, NOW);
    expect(evil.split('\r\n').filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(/[\x00-\x08\x0B-\x1F\x7F]/.test(evil.replace(/\r\n/g, ''))).toBe(false);
    expect(prop(evil, 'SUMMARY')).toBe('Baby Shower for Bean!');
    expect(prop(unfold(evil), 'LOCATION')).toBe('Line1\\nLine2\tTab');
    expect(prop(unfold(evil), 'DESCRIPTION').startsWith('Hosted by A\\\\B\\;C\\,D\\nEND:VEVENT\\nX\\nY.')).toBe(true);
  });

  it('folds at 75 octets without splitting a UTF-8 character', () => {
    const longVenue = '🎉🍼 宝宝派对 ' + 'Ünïcödé Hall, 東京都渋谷区 '.repeat(8) + '👶🏽👨‍👩‍👧 end';
    const long = buildIcs({ ...base, venueName: longVenue, hosts: 'é'.repeat(200), baby: '日'.repeat(100) }, site, NOW);
    const lines = long.split('\r\n').slice(0, -1);
    expect(lines.filter((l) => u8(l) > 75)).toEqual([]);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
    for (const l of lines) expect(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(l, 'utf8'))).not.toThrow();
    expect(prop(unfold(long), 'LOCATION')).toBe(longVenue.replace(/,/g, '\\,'));
    // 恰好 75 字节不折，76 字节折
    const pad = (n) => 'x'.repeat(n - 'SUMMARY:Baby Shower for '.length);
    expect(buildIcs({ ...base, baby: pad(75) }, site, NOW).split('\r\n')).toContain('SUMMARY:Baby Shower for ' + pad(75));
    expect(buildIcs({ ...base, baby: pad(76) }, site, NOW).split('\r\n')).toContain(' x');
  });

  it('a lone surrogate never throws', () => {
    expect(() => buildIcs({ ...base, venueName: 'Hall \uD800 x' }, site, NOW)).not.toThrow();
  });
});

describe('googleCalendarUrl', () => {
  it('builds an encoded template link', () => {
    const g = googleCalendarUrl(base, site);
    expect(g.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=Baby%20Shower%20for%20Baby%20Bean')).toBe(true);
    expect(g).toContain('&dates=20270314T050000Z/20270314T080000Z&ctz=Asia%2FTokyo');
    expect(g).toContain('&location=Hall%202%3B%20Level%203%2C%20Suburb');
    expect(g).toContain('&details=Hosted%20by%20Alex%20%26%20Sam.%0AInvitation%2C%20RSVP%20%26%20registry%3A%20https%3A%2F%2Fexample.com%2F');
  });

  it('empty when unusable; no location param when no venue; lone surrogate → U+FFFD', () => {
    expect(googleCalendarUrl({ ...base, endsAt: '2027-03-14T12:00' }, site)).toBe('');
    expect(googleCalendarUrl({ hosts: 'A', baby: 'B' }, site)).toBe('');
    expect(googleCalendarUrl({ ...base, venueName: '' }, site)).not.toContain('&location=');
    expect(googleCalendarUrl({ ...base, venueName: 'Hall \uD800 x' }, site)).toContain('%EF%BF%BD');
  });
});
