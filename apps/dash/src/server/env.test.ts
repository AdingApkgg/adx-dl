import { describe, expect, test } from "bun:test";

import { parseEnv } from "./env";

const complete = {
  CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud-tag-abc",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nline1\\nline2\\n-----END RSA PRIVATE KEY-----",
  GITHUB_APP_INSTALLATION_ID: "7890",
  GITHUB_REPO_OWNER: "AdingApkgg",
  GITHUB_REPO_NAME: "adx-dl",
  DASH_PUBLIC_ORIGIN: "https://your-dash-domain.example.com",
};

describe("parseEnv", () => {
  test("解析完整配置", () => {
    const env = parseEnv(complete);

    expect(env.accessTeamDomain).toBe("https://example.cloudflareaccess.com");
    expect(env.accessAud).toBe("aud-tag-abc");
    expect(env.githubAppId).toBe("123456");
    expect(env.githubInstallationId).toBe(7890);
    expect(env.repoOwner).toBe("AdingApkgg");
    expect(env.repoName).toBe("adx-dl");
    expect(env.dashPublicOrigin).toBe("https://your-dash-domain.example.com");
  });

  test("把私钥里的字面 \\n 还原成真换行", () => {
    const env = parseEnv(complete);

    expect(env.githubPrivateKey.split("\n")).toHaveLength(4);
    expect(env.githubPrivateKey.startsWith("-----BEGIN RSA PRIVATE KEY-----\n")).toBe(true);
  });

  test("端口有默认值，也可覆盖", () => {
    expect(parseEnv(complete).port).toBe(3000);
    expect(parseEnv({ ...complete, PORT: "8080" }).port).toBe(8080);
  });

  test("团队域名末尾的斜杠会被去掉", () => {
    // 这个值会被拼成 `${domain}/cdn-cgi/access/certs`，多一道斜杠就拿不到 JWKS。
    const env = parseEnv({ ...complete, CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com/" });

    expect(env.accessTeamDomain).toBe("https://example.cloudflareaccess.com");
  });

  test("缺项时一次报全，不是报第一个就停", () => {
    expect(() => parseEnv({ GITHUB_REPO_OWNER: "AdingApkgg" })).toThrow(/CF_ACCESS_AUD/);

    try {
      parseEnv({ GITHUB_REPO_OWNER: "AdingApkgg" });
      throw new Error("应当抛错");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("CF_ACCESS_TEAM_DOMAIN");
      expect(message).toContain("CF_ACCESS_AUD");
      expect(message).toContain("GITHUB_APP_ID");
      expect(message).toContain("GITHUB_APP_PRIVATE_KEY");
      expect(message).toContain("GITHUB_APP_INSTALLATION_ID");
    }
  });

  test("installation id 不是数字时报错", () => {
    expect(() => parseEnv({ ...complete, GITHUB_APP_INSTALLATION_ID: "abc" })).toThrow(
      /GITHUB_APP_INSTALLATION_ID/
    );
  });

  // Finding I-2 — DASH_PUBLIC_ORIGIN 是必填项，故意 fail-fast：一个悄悄
  // 不做 CSRF 校验但看起来健康的容器，比一个直接起不来的容器更危险。
  test("DASH_PUBLIC_ORIGIN 未设置时报错", () => {
    const { DASH_PUBLIC_ORIGIN, ...withoutOrigin } = complete;
    expect(() => parseEnv(withoutOrigin)).toThrow(/DASH_PUBLIC_ORIGIN/);
  });

  test("DASH_PUBLIC_ORIGIN 不带 scheme 时报错", () => {
    expect(() => parseEnv({ ...complete, DASH_PUBLIC_ORIGIN: "your-dash-domain.example.com" })).toThrow(
      /DASH_PUBLIC_ORIGIN/
    );
  });

  test("DASH_PUBLIC_ORIGIN 末尾的斜杠会被去掉", () => {
    // Origin 请求头永远不带尾部斜杠；留着它，字符串相等比较永远不会命中。
    const env = parseEnv({ ...complete, DASH_PUBLIC_ORIGIN: "https://your-dash-domain.example.com/" });
    expect(env.dashPublicOrigin).toBe("https://your-dash-domain.example.com");
  });

  // Fix round 1: Finding 1 — CF_ACCESS_TEAM_DOMAIN scheme validation
  test("团队域名不带 scheme 时报错", () => {
    expect(() => parseEnv({ ...complete, CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com" })).toThrow(
      /CF_ACCESS_TEAM_DOMAIN/
    );
  });

  test("团队域名带 http:// 也接受", () => {
    const env = parseEnv({ ...complete, CF_ACCESS_TEAM_DOMAIN: "http://example.cloudflareaccess.com" });
    expect(env.accessTeamDomain).toBe("http://example.cloudflareaccess.com");
  });

  test("scheme 校验错误与其他错误一起报告", () => {
    try {
      parseEnv({
        ...complete,
        CF_ACCESS_TEAM_DOMAIN: "no-scheme.cloudflareaccess.com",
        CF_ACCESS_AUD: "", // Empty to trigger missing error
      });
      throw new Error("应当抛错");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("CF_ACCESS_TEAM_DOMAIN"); // scheme error
      expect(message).toContain("CF_ACCESS_AUD"); // missing error
    }
  });

  // Fix round 1: Finding 2 — Quote handling and newline idempotence
  test("双引号包裹的私钥带转义 newline", () => {
    const quotedKey = '"-----BEGIN RSA PRIVATE KEY-----\\nline1\\nline2\\n-----END RSA PRIVATE KEY-----"';
    const env = parseEnv({ ...complete, GITHUB_APP_PRIVATE_KEY: quotedKey });

    expect(env.githubPrivateKey).toBe("-----BEGIN RSA PRIVATE KEY-----\nline1\nline2\n-----END RSA PRIVATE KEY-----");
    expect(env.githubPrivateKey.split("\n")).toHaveLength(4);
  });

  test("单引号包裹的普通值去掉引号", () => {
    const env = parseEnv({ ...complete, GITHUB_REPO_NAME: "'adx-dl'" });
    expect(env.repoName).toBe("adx-dl");
  });

  test("私钥已有真实 newline，幂等处理", () => {
    const keyWithRealNewlines = "-----BEGIN RSA PRIVATE KEY-----\nline1\nline2\n-----END RSA PRIVATE KEY-----";
    const env = parseEnv({ ...complete, GITHUB_APP_PRIVATE_KEY: keyWithRealNewlines });

    expect(env.githubPrivateKey).toBe(keyWithRealNewlines);
    expect(env.githubPrivateKey.split("\n")).toHaveLength(4);
  });

  // Fix round 2: Optional variables quote handling
  test("引号包裹的 PORT 被去掉后解析为数字", () => {
    const env = parseEnv({ ...complete, PORT: '"8080"' });
    expect(env.port).toBe(8080);
  });

  test("引号包裹的 DASH_CLIENT_ROOT 被去掉", () => {
    const env = parseEnv({ ...complete, DASH_CLIENT_ROOT: "'/custom/path'" });
    expect(env.clientRoot).toBe("/custom/path");
  });

  test("PORT 未设置时仍然默认为 3000", () => {
    const env = parseEnv({ ...complete, PORT: "" });
    expect(env.port).toBe(3000);
  });

  test("PORT 非数字时报错（包含引号去掉后的值）", () => {
    expect(() => parseEnv({ ...complete, PORT: "notaport" })).toThrow(/PORT/);

    try {
      parseEnv({ ...complete, PORT: '"notaport"' });
      throw new Error("应当抛错");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("PORT");
      expect(message).toContain("notaport"); // 应显示去掉引号后的值
    }
  });
});
