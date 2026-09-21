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
});
