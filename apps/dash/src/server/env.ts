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

  // Validate CF_ACCESS_TEAM_DOMAIN has a scheme (http:// or https://).
  // Used as-is in JWKS URL and JWT issuer claim; missing scheme breaks auth at runtime.
  if (accessTeamDomain && !accessTeamDomain.match(/^https?:\/\//)) {
    problems.push(`CF_ACCESS_TEAM_DOMAIN 必须带 http:// 或 https:// scheme，收到 ${accessTeamDomain}`);
  }

  const githubInstallationId = Number(rawInstallationId);
  if (rawInstallationId && !Number.isInteger(githubInstallationId)) {
    problems.push(`GITHUB_APP_INSTALLATION_ID 必须是整数，收到 ${rawInstallationId}`);
  }

  const rawPort = source.PORT?.trim();
  const port = rawPort ? Number(rawPort) : 3000;
  if (rawPort && !Number.isInteger(port)) {
    problems.push(`PORT 必须是整数，收到 ${rawPort}`);
  }

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
    clientRoot: stripQuotes(source.DASH_CLIENT_ROOT?.trim() || "./build/client"),
  };
}
