export type DashEnv = {
  port: number;
  accessTeamDomain: string;
  accessAud: string;
  githubAppId: string;
  githubPrivateKey: string;
  githubInstallationId: number;
  repoOwner: string;
  repoName: string;
  clientRoot: string;
  /** 浏览器实际看到的公网 origin（如 https://dash.saop.cc），喂给 csrf() 的 Origin 白名单。 */
  dashPublicOrigin: string;
};

type Source = Record<string, string | undefined>;

export function parseEnv(source: Source): DashEnv {
  const problems: string[] = [];

  const stripQuotes = (value: string): string => {
    // Remove matching quotes (single or double) from both ends.
    // Handles values arriving quoted from Docker Compose env_file.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  };

  const required = (key: string): string => {
    let value = source[key]?.trim() ?? "";
    if (!value) {
      problems.push(`${key} 未设置`);
      return "";
    }
    // Strip quotes: first, because they're part of the container env format, not the value itself.
    // Then handle newlines, so escaped sequences inside quotes are correctly unescaped.
    value = stripQuotes(value);
    return value;
  };

  // Optional values that may be unset or quoted. Strips quotes (if present) and returns
  // the provided defaultValue if unset or empty. Ensures all optional variables undergo
  // the same quote-stripping path, preventing future optional fields from accidentally
  // skipping this processing.
  const optional = (key: string, defaultValue: string): string => {
    let value = source[key]?.trim() ?? "";
    if (!value) {
      return defaultValue;
    }
    value = stripQuotes(value);
    return value;
  };

  const accessTeamDomain = required("CF_ACCESS_TEAM_DOMAIN").replace(/\/+$/, "");
  const accessAud = required("CF_ACCESS_AUD");
  const githubAppId = required("GITHUB_APP_ID");
  // env 里的私钥可能有三种形式：
  // 1. 单行，字面 \n（两个字符 \ 和 n）要还原成真换行（octokit 无法导入原样的 PEM）
  // 2. 引号包裹的值（Docker Compose 可能保留），会在 required() 中去掉引号
  // 3. 已有真实换行的值（某些 env 解析器会展开）——replace 是幂等的，因为只匹配 \n 序列
  const githubPrivateKey = required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const rawInstallationId = required("GITHUB_APP_INSTALLATION_ID");
  const repoOwner = required("GITHUB_REPO_OWNER");
  const repoName = required("GITHUB_REPO_NAME");
  // 部署在 cloudflared tunnel 后面：Hono 自己算出来的「本源」可能是
  // http://localhost:12702，而浏览器发来的 Origin 是公网域名——两者不相等。
  // 所以不能让 csrf() 用默认的「跟请求 URL 比」，必须显式给一个白名单值。
  // 这是安全控制项，故意做成必填（parseEnv 现有的 fail-fast 惯例）：宁可
  // 容器起不来，也不要一个「看着健康、CSRF 防护其实是空的」的部署。
  const dashPublicOrigin = required("DASH_PUBLIC_ORIGIN").replace(/\/+$/, "");

  // Validate CF_ACCESS_TEAM_DOMAIN has a scheme (http:// or https://).
  // Used as-is in JWKS URL and JWT issuer claim; missing scheme breaks auth at runtime.
  if (accessTeamDomain && !accessTeamDomain.match(/^https?:\/\//)) {
    problems.push(`CF_ACCESS_TEAM_DOMAIN 必须带 http:// 或 https:// scheme，收到 ${accessTeamDomain}`);
  }

  // 同样的道理：csrf() 拿它跟请求的 Origin 头做字符串相等比较，Origin 头
  // 本身永远是 scheme://host[:port] 这个形状，没有 scheme 的值永远不可能匹配，
  // 等于把 CSRF 防护静默关掉——所以在启动时就挡住，而不是等到第一次 POST 被
  // 误拒（或者更糟：因为拼错永远不匹配，第一次真实攻击也被放行）才发现。
  if (dashPublicOrigin && !dashPublicOrigin.match(/^https?:\/\//)) {
    problems.push(`DASH_PUBLIC_ORIGIN 必须带 http:// 或 https:// scheme，收到 ${dashPublicOrigin}`);
  }

  const githubInstallationId = Number(rawInstallationId);
  if (rawInstallationId && !Number.isInteger(githubInstallationId)) {
    problems.push(`GITHUB_APP_INSTALLATION_ID 必须是整数，收到 ${rawInstallationId}`);
  }

  const rawPort = optional("PORT", "");
  const port = rawPort ? Number(rawPort) : 3000;
  if (rawPort && !Number.isInteger(port)) {
    problems.push(`PORT 必须是整数，收到 ${rawPort}`);
  }

  const clientRoot = optional("DASH_CLIENT_ROOT", "./build/client");

  if (problems.length > 0) {
    // 一次列全。容器起不来时只看得到一行日志，逐个报错等于逐个重启。
    throw new Error(`环境变量有问题：\n- ${problems.join("\n- ")}`);
  }

  return {
    port,
    accessTeamDomain,
    accessAud,
    githubAppId,
    githubPrivateKey,
    githubInstallationId,
    repoOwner,
    repoName,
    clientRoot,
    dashPublicOrigin,
  };
}
