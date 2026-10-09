#!/usr/bin/env bash
# 给 .env 补上还空着的随机密钥（上线手册；本机开发也能用）。已经有值的一律不动：BETTER_AUTH_SECRET 换了所有人要重新登录，
# POSTGRES_PASSWORD、UMAMI_DB_PASSWORD 只在数据库第一次启动时写进库里，换了就连不上。只打印变量名，从不打印值。
# 用法：ops/fill-secrets.sh [.env 的路径]，默认是 apps/community/.env。只用 bash、od、awk，GNU 和 BSD 上都能跑。
set -euo pipefail

file="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
SECRETS="BETTER_AUTH_SECRET QQ_CODE_HMAC_KEY NAPCAT_ACCESS_TOKEN NAPCAT_WEBUI_TOKEN POSTGRES_PASSWORD UMAMI_DB_PASSWORD UMAMI_APP_SECRET"

if [ ! -f "$file" ]; then
  echo "$file 不存在：先 cp .env.example .env" >&2
  exit 1
fi

# 32 字节的随机数，写成 64 个十六进制字符：放进数据库连接串、compose 的插值都不用转义。
random_hex() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

# 这一项现在的值（最后一行算数），去掉成对的引号。没有这一行时是空的（grep 找不到不算出错）。
current_value() {
  local value
  value="$({ grep -E "^$1=" "$2" || true; } | tail -n 1 | cut -d= -f2-)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

umask 077
tmp="$(mktemp "$file.XXXXXX")"
trap 'rm -f "$tmp" "$tmp.next"' EXIT
cat "$file" > "$tmp"
# 最后一行没有换行时先补上，否则补在末尾的变量会接在它后面。
if [ -s "$tmp" ] && [ -n "$(tail -c 1 "$tmp")" ]; then
  echo >> "$tmp"
fi

for key in $SECRETS; do
  if [ -n "$(current_value "$key" "$tmp")" ]; then
    echo "$key: 已有，不动"
    continue
  fi
  value="$(random_hex)"
  if grep -Eq "^$key=" "$tmp"; then
    # 空着的那一行（或几行）就地填上，位置不变。
    awk -v key="$key" -v value="$value" 'index($0, key "=") == 1 { print key "=" value; next } { print }' "$tmp" > "$tmp.next"
    mv "$tmp.next" "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  echo "$key: 已生成"
done

# 新文件只有所有者能读写（umask 077 建的），替换掉原来的。
mv "$tmp" "$file"
trap - EXIT
