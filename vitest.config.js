import { defineConfig } from 'vitest/config';

// 单测配置（npm test → vitest run）：只跑 tests/ 下的 *.test.js，纯 Node 环境 ——
// 不起 wrangler、不连网，KV / R2 / fetch 全用 tests/helpers/env.js 里的替身。
// 时区固定成 UTC，日期断言在任何机器（含 CI）上结果一致；csv 的"按本地时区"用例在用例内部临时切换 TZ。
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    // console 邮件模式会把每封信打印出来：测试输出里一律静音（需要断言收件人的用例用 captureEmails()）
    onConsoleLog: (log) => (log.startsWith('[EMAIL:console]') ? false : undefined),
    // 每个用例开始前自动还原 vi.spyOn / vi.stubGlobal（fetch、setTimeout、console 的替身不会串到下一个用例）。
    // Vitest 4 起 restoreMocks 只还原 vi.spyOn 的替身、不再清空 vi.fn() 的调用记录；
    // 清调用记录交给 Vitest 5 默认开启的 clearMocks。用例里的 vi.fn() 都在用例 / beforeEach 内新建，不跨用例复用。
    restoreMocks: true,
    unstubGlobals: true,
  },
});
