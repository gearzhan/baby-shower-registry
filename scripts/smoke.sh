#!/usr/bin/env bash
# 冒烟测试：对一台正在运行的本地服务（npm run cf / wrangler pages dev）走一遍 CLAUDE.md 的 "Verify a change" 流程。
#   健康检查 → 未登录的 401 → 主人凭 devCode 真实登录 → /api/me 是主人 → /api/admin/all 与 /api/public 200。
# 任何一步失败即以非零退出。cookie 罐放在 mktemp 临时目录里、退出时删掉 —— 它是一枚可用的主人会话，绝不能落进仓库。
#
# 用法：  scripts/smoke.sh                       （默认 http://localhost:8788，主人 host@example.com）
#         BASE=http://localhost:8788 HOST_EMAIL=host@example.com scripts/smoke.sh
# 前提：  服务跑在 EMAIL_MODE=console + localhost 的 PUBLIC_BASE_URL 上（.dev.vars 的默认值），否则拿不到 devCode。
# 注意：  同一邮箱 60 秒内只能要一次验证码 —— 连跑两次，第二次会在 auth/start 处 429。
set -euo pipefail

BASE="${BASE:-http://localhost:8788}"
HOST_EMAIL="${HOST_EMAIL:-host@example.com}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/cookies.txt"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok    %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL  %s\n' "$1"; }

# 响应体前 200 字节（失败时附在说明后面；连不上时没有响应体）
snippet() { head -c 200 "$TMP/body" 2>/dev/null || true; }

# status <METHOD> <path> [curl 参数…] → 打印 HTTP 状态码；响应体写到 $TMP/body（先删掉上一个，免得读到旧的）
status() {
  local method="$1" path="$2"
  shift 2
  rm -f "$TMP/body"
  # 连不上时 curl 自己会经 -w 打出 000 并以非零退出：吞掉退出码，交给调用方按状态码判断
  curl -sS -o "$TMP/body" -w '%{http_code}' -X "$method" "$@" "$BASE$path" 2>/dev/null || true
}

# expect <期望状态码> <说明> <METHOD> <path> [curl 参数…]
expect() {
  local want="$1" label="$2"
  shift 2
  local got
  got="$(status "$@")"
  if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label: expected $want, got $got — $(snippet)"; fi
}

# 读 $TMP/body 里的 JSON 字段（点分路径，如 guest.isHost；null / 缺失都是空串）；用 node，仓库本来就要求装 Node
field() {
  node -e '
    let v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const k of process.argv[2].split(".")) v = v == null ? undefined : v[k];
    process.stdout.write(v == null ? "" : String(v));
  ' "$TMP/body" "$1" 2>/dev/null || true
}

echo "Smoke test against $BASE"

# 1. 健康检查：Functions 在跑，KV / R2 绑定都注入了
got="$(status GET /api/health)"
if [ "$got" = 200 ] && [ "$(field ok)" = true ] && [ "$(field kv)" = true ] && [ "$(field r2)" = true ]; then
  ok "health: functions up, KV + R2 bound"
else
  bad "health: got $got — $(snippet)"
  echo "Is the server running? Try: npm run cf" >&2
  exit 1
fi

# 2. 未登录：全站在门后
expect 401 "signed out: /api/public" GET /api/public
expect 401 "signed out: /api/registry" GET /api/registry
expect 401 "signed out: /api/admin/all" GET /api/admin/all
got="$(status GET /api/me)"
if [ "$got" = 200 ] && [ -z "$(field guest)" ] && [ -z "$(field teaser.dateLabel)" ] && [ -z "$(field teaser.venueName)" ]; then
  ok "signed out: /api/me is a teaser only (no date / venue)"
else
  bad "signed out: /api/me — $got $(snippet)"
fi

# 3. 主人真实登录：要验证码（devCode 只在本地 console 模式回传）→ 换 cookie
got="$(status POST /api/auth/start -H 'content-type: application/json' --data "{\"email\":\"$HOST_EMAIL\"}")"
code="$(field devCode)"
if [ "$got" = 200 ] && [ -n "$code" ]; then
  ok "auth/start: devCode issued for $HOST_EMAIL"
else
  bad "auth/start: got $got — $(snippet) (EMAIL_MODE=console and a localhost PUBLIC_BASE_URL are required; one code per address per 60 s)"
  echo "$pass passed, $fail failed"
  exit 1
fi
got="$(status POST /api/auth/verify -c "$JAR" -H 'content-type: application/json' --data "{\"email\":\"$HOST_EMAIL\",\"code\":\"$code\"}")"
if [ "$got" = 200 ] && grep -q bs_session "$JAR"; then ok "auth/verify: session cookie set"; else bad "auth/verify: got $got — $(snippet)"; fi

# 4. 登录后
got="$(status GET /api/me -b "$JAR")"
if [ "$got" = 200 ] && [ "$(field guest.isHost)" = true ]; then ok "/api/me: guest.isHost === true"; else bad "/api/me: got $got — $(snippet)"; fi
expect 200 "signed in: /api/admin/all" GET /api/admin/all -b "$JAR"
expect 200 "signed in: /api/public" GET /api/public -b "$JAR"
expect 200 "signed in: /api/registry" GET /api/registry -b "$JAR"

# 5. 退出登录：服务端清 cookie
expect 200 "auth/signout clears the cookie" POST /api/auth/signout -b "$JAR" -c "$JAR"
expect 401 "after sign-out (cookie cleared): /api/admin/all" GET /api/admin/all -b "$JAR"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
