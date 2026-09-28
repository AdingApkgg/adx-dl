import { TEST_PUBLIC_ORIGIN, TEST_USER_AGENT } from "./constants";

type RequestTarget = { request(input: Request): Response | Promise<Response> };

export type BrowserResponse = { status: number; headers: Headers; text: string; json: any };

export type BrowserOptions = { ip?: string; country?: string; userAgent?: string };

// 测试用的"浏览器"：请求直接交给 app.request（不走网络），自带 Cookie 罐；默认带同源的 Origin、
// Cloudflare 会加的访客 IP 和国家，以及一个真实的 User-Agent。
export class Browser {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly target: RequestTarget,
    private readonly options: BrowserOptions = {}
  ) {}

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /** origin 传 null 表示不带 Origin 头（比如顶层 GET 导航）。 */
  async request(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; origin?: string | null } = {}
  ): Promise<BrowserResponse> {
    const headers = new Headers({
      "cf-connecting-ip": this.options.ip ?? "203.0.113.7",
      "cf-ipcountry": this.options.country ?? "JP",
      "user-agent": this.options.userAgent ?? TEST_USER_AGENT,
    });
    const origin = init.origin === undefined ? TEST_PUBLIC_ORIGIN : init.origin;
    if (origin !== null) {
      headers.set("origin", origin);
    }
    if (this.cookies.size > 0) {
      headers.set("cookie", this.cookieHeader());
    }
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      headers.set(name, value);
    }
    const response = await this.target.request(
      new Request(`${TEST_PUBLIC_ORIGIN}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    );
    this.absorb(response);
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json };
  }

  private absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (value === "" || expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}
