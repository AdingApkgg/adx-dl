// 昵称规则（spec 第 10.5 节）：1 到 24 个字符，允许重名，去掉首尾空白，禁止控制字符。
// 放在 shared：服务端建号时规整，前端注册表单用同一套规则提前提示。
export const NICKNAME_MAX = 24;

// 控制字符（\p{Cc}），外加能把文字方向倒过来冒充别人的双向控制符、零宽空格和 BOM。
// 零宽连接符（U+200D）不去：组合表情要靠它。
const FORBIDDEN = /[\p{Cc}​‪-‮⁦-⁩﻿]/gu;

export function normalizeNickname(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .replace(FORBIDDEN, "")
    .trim();
  return Array.from(cleaned).slice(0, NICKNAME_MAX).join("").trim();
}
