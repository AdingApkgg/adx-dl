// 登录后跳回的地址只接受站内路径：以 / 开头，但不能以 // 或 /\ 开头（浏览器会当成别的网站），
// 也不能带控制字符。其余一律换成 fallback。
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw?.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /\p{Cc}/u.test(raw)) {
    return fallback;
  }
  return raw;
}
