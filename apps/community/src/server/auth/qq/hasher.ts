export type QqHasher = {
  /** QQ 号的 HMAC：Redis 的键和验证码记录里都只放它，不放 QQ 号本身。 */
  qqKey(qq: string): Promise<string>;
  /** 验证码的 HMAC，和这次发码的 nonce、QQ 号绑在一起（spec 第 10.3 节）。 */
  codeHash(nonce: string, qq: string, code: string): Promise<string>;
};

export function createQqHasher(secret: string): QqHasher {
  const key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const hmac = async (message: string) =>
    Buffer.from(await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(message))).toString("hex");
  // 两种输入加不同前缀，不会互相撞上。
  return {
    qqKey: (qq) => hmac(`qq:${qq}`),
    codeHash: (nonce, qq, code) => hmac(`code:${nonce}:${qq}:${code}`),
  };
}
