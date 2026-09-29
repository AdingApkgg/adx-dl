// 测试用的软件认证器：用 WebCrypto 生成 P-256 密钥，拼出真实的 WebAuthn 注册、断言响应。
// 不打补丁、不 mock，@simplewebauthn/server 按真实流程校验它。
type Bytes = Uint8Array<ArrayBuffer>;

const subtle = globalThis.crypto.subtle;

export function b64url(bytes: Bytes): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromB64url(s: string): Bytes {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

// ---- 最小 CBOR 编码器：只覆盖 WebAuthn 用到的类型 ----
type Cbor = number | string | Bytes | Map<Cbor, Cbor> | { [k: string]: Cbor } | Cbor[];

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

export function cbor(value: Cbor): Bytes {
  const out: number[] = [];
  const enc = (x: Cbor) => {
    if (typeof x === "number") {
      out.push(...(x >= 0 ? head(0, x) : head(1, -1 - x)));
    } else if (typeof x === "string") {
      const b = new TextEncoder().encode(x);
      out.push(...head(3, b.length), ...b);
    } else if (x instanceof Uint8Array) {
      out.push(...head(2, x.length), ...x);
    } else if (Array.isArray(x)) {
      out.push(...head(4, x.length));
      for (const item of x) enc(item);
    } else {
      const entries: [Cbor, Cbor][] = x instanceof Map ? [...x] : Object.entries(x);
      out.push(...head(5, entries.length));
      for (const [k, v] of entries) {
        enc(k);
        enc(v);
      }
    }
  };
  enc(value);
  return new Uint8Array(out);
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle.digest("SHA-256", data));
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function u32(n: number): Bytes {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

// WebCrypto 的 ECDSA 签名是 r||s（各 32 字节），WebAuthn 要 ASN.1 DER。
function rawToDer(raw: Bytes): Bytes {
  const int = (b: Bytes): Bytes => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v: Bytes = b.slice(i);
    if ((v[0] ?? 0) & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

export type SoftCredential = { id: Bytes; keyPair: CryptoKeyPair; signCount: number; userHandle: string };

export class SoftAuthenticator {
  readonly credentials: SoftCredential[] = [];

  constructor(
    readonly origin: string,
    readonly rpId: string
  ) {}

  /** 输入 generate-register-options 的返回值，输出 verify-registration 要的 response。 */
  async createCredential(
    options: { challenge: string; user: { id: string }; rp: { id?: string } },
    credentialId: Bytes = crypto.getRandomValues(new Uint8Array(16))
  ): Promise<Record<string, unknown>> {
    const keyPair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await subtle.exportKey("jwk", keyPair.publicKey);
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, fromB64url(jwk.x ?? "")],
      [-3, fromB64url(jwk.y ?? "")],
    ]);
    const rpIdHash = await sha256(new TextEncoder().encode(options.rp.id ?? this.rpId));
    // flags: UP(0x01) | UV(0x04) | BE(0x08) | BS(0x10) | AT(0x40)
    const flags = new Uint8Array([0x01 | 0x04 | 0x08 | 0x10 | 0x40]);
    const aaguid = new Uint8Array(16); // 全 0：和 Apple 在 attestation:"none" 下一样
    const idLength = new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]);
    const authData = concat(rpIdHash, flags, u32(0), aaguid, idLength, credentialId, cbor(coseKey));
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin, crossOrigin: false })
    );
    this.credentials.push({ id: credentialId, keyPair, signCount: 0, userHandle: options.user.id });
    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(cbor({ fmt: "none", attStmt: {}, authData })),
        transports: ["internal", "hybrid"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** 输入 generate-authenticate-options 的返回值，输出 verify-authentication 要的 response。 */
  async getAssertion(
    options: { challenge: string; rpId?: string },
    credential: SoftCredential | undefined = this.credentials[0]
  ): Promise<Record<string, unknown>> {
    if (!credential) throw new Error("no credential registered on this soft authenticator");
    credential.signCount += 1;
    const rpIdHash = await sha256(new TextEncoder().encode(options.rpId ?? this.rpId));
    const authenticatorData = concat(rpIdHash, new Uint8Array([0x01 | 0x04 | 0x08 | 0x10]), u32(credential.signCount));
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: this.origin, crossOrigin: false })
    );
    const signed = concat(authenticatorData, await sha256(clientDataJSON));
    const raw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, credential.keyPair.privateKey, signed));
    return {
      id: b64url(credential.id),
      rawId: b64url(credential.id),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(rawToDer(raw)),
        userHandle: credential.userHandle, // options.user.id 本来就是 base64url
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
