// 会出现在网址里的 id（spec 第 9.2 节）：10 位，去掉 0、1、i、l、o 的 31 个字符，约 49.5 bit。
export const SHORT_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

// 31 不能整除 256：只收 < 248（= 31 × 8）的字节，避免取模偏差。
export function shortId(size = 10): string {
  const out: string[] = [];
  while (out.length < size) {
    for (const byte of crypto.getRandomValues(new Uint8Array(size * 2))) {
      if (byte < 248 && out.length < size) {
        out.push(SHORT_ID_ALPHABET.charAt(byte % 31));
      }
    }
  }
  return out.join("");
}

const SHORT_ID_PATTERN = new RegExp(`^[${SHORT_ID_ALPHABET}]{10}$`);

/** 网址里拿来的用户 id：先检查格式再去查库，格式不对的直接当作不存在。 */
export function isShortId(value: string): boolean {
  return SHORT_ID_PATTERN.test(value);
}
