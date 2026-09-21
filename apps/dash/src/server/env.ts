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

  const required = (key: string): string => {
    const value = source[key]?.trim();
    if (!value) {
      problems.push(`${key} 未设置`);
      return "";
    }
    return value;
  };

  const accessTeamDomain = required("CF_ACCESS_TEAM_DOMAIN").replace(/\/+$/, "");
  const accessAud = required("CF_ACCESS_AUD");
  const githubAppId = required("GITHUB_APP_ID");
  // env 里的私钥是单行的，字面 \n 要还原成真换行，否则 octokit 无法导入该 PEM。
  const githubPrivateKey = required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const rawInstallationId = required("GITHUB_APP_INSTALLATION_ID");
  const repoOwner = required("GITHUB_REPO_OWNER");
  const repoName = required("GITHUB_REPO_NAME");

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
    clientRoot: source.DASH_CLIENT_ROOT?.trim() || "./build/client",
  };
}
