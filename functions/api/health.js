// 健康检查端点：确认 Pages Functions 运行、KV/R2 绑定是否注入成功。
// 这是全站唯一的匿名端点之一，不要往里加任何配置细节（比如邮件模式）。
export function onRequestGet({ env }) {
  return Response.json({
    ok: true,
    kv: !!env.BS_KV,
    r2: !!env.BS_R2,
  });
}
