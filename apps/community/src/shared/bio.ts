// 简介规则（spec 第 10.5 节）：最多 300 个字符，纯文本，可以换行。放在 shared：服务端保存前规整和校验，
// 前端表单用同一套规则计数、提前提示。
export const BIO_MAX = 300;

// 换行以外的控制字符（先把 \r\n、\r 统一成 \n，Tab 换成空格），外加能把文字方向倒过来冒充别人的
// 双向控制符、零宽空格和 BOM（和昵称的规则一样）。零宽连接符（U+200D）不去：组合表情要靠它。
const FORBIDDEN = /(?!\n)[\p{Cc}\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/** 统一换行、去掉禁止的字符、最多留一个空行、去掉首尾空白。不截断。 */
export function normalizeBio(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(FORBIDDEN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 按字符（码点）数，不按 UTF-16 码元：表情和生僻字各算一个。 */
export function bioLength(bio: string): number {
  return Array.from(bio).length;
}

/** 用户提交的简介：规整后不超过 300 个字符就返回规整后的值，超了返回 null。不替用户截断。 */
export function parseBio(raw: unknown): string | null {
  const bio = normalizeBio(raw);
  return bioLength(bio) <= BIO_MAX ? bio : null;
}
