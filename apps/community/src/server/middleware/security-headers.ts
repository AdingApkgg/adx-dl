import { NONCE, secureHeaders } from "hono/secure-headers";

const TURNSTILE = "https://challenges.cloudflare.com";

// spec 第 8.2 节的 CSP 基线。外部来源只放行 Turnstile：Google 登录是整页跳转，
// 统计脚本走本站的 /_s/。style-src 带 'unsafe-inline' 是因为 React 渲染出的
// style 属性也受它约束。
const contentSecurityPolicy = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", NONCE, TURNSTILE],
  frameSrc: [TURNSTILE],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "blob:"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

export function securityHeaders({ isProduction }: { isProduction: boolean }) {
  return secureHeaders({
    // 开发环境 Vite 会注入不带 nonce 的脚本，只报告不拦截。
    ...(isProduction
      ? { contentSecurityPolicy }
      : { contentSecurityPolicyReportOnly: contentSecurityPolicy }),
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    // HSTS 在 Cloudflare 上开（spec 第 12.2 节）。
    strictTransportSecurity: false,
    // 不列出 publickey-credentials-*，让它们保持默认的 self，通行密钥才能用。
    permissionsPolicy: {
      camera: false,
      microphone: false,
      geolocation: false,
      payment: false,
      usb: false,
      bluetooth: false,
      serial: false,
      hid: false,
      midi: false,
    },
  });
}
