// 默认头像（用户决定；上传头像在子项目 2）：昵称的第一个字符，背景色由用户 id 固定算出。放在 shared：
// 以后的 App 也用同一套规则，同一个人在哪里看都是同一个颜色。

// 12 种颜色，和白色文字的对比度都在 4.9:1 以上（WCAG AA 要求 4.5:1）。
export const AVATAR_COLORS = [
  "#b91c1c",
  "#c2410c",
  "#b45309",
  "#4d7c0f",
  "#15803d",
  "#0f766e",
  "#0e7490",
  "#0369a1",
  "#1d4ed8",
  "#6d28d9",
  "#a21caf",
  "#be123c",
] as const;

// FNV-1a（32 位）：简单、分布均匀，前后端算出来一样。不用于任何安全用途。
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

export function avatarColor(userId: string): string {
  return AVATAR_COLORS[hash(userId) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** 昵称的第一个字符（按码点：表情、生僻字都算一个）；英文字母转成大写。昵称是空的时候用"?"。 */
export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  if (!first) {
    return "?";
  }
  return /^[a-z]$/.test(first) ? first.toUpperCase() : first;
}
