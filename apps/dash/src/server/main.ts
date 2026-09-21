import { createApp } from "./app";
import { createOctokitGitHubClient } from "./github/octokit-client";
import { parseEnv } from "./env";

const env = parseEnv(process.env);

const app = createApp({
  clientRoot: env.clientRoot,
  github: createOctokitGitHubClient({
    appId: env.githubAppId,
    privateKey: env.githubPrivateKey,
    installationId: env.githubInstallationId,
    owner: env.repoOwner,
    repo: env.repoName,
  }),
  accessConfig: {
    teamDomain: env.accessTeamDomain,
    aud: env.accessAud,
  },
});

console.log(`dash listening on :${env.port} (repo ${env.repoOwner}/${env.repoName})`);

// Bun 约定：默认导出 { port, fetch } 即可启动服务，不需要 Bun.serve，
// 也就不需要为 Bun 全局引入 @types/bun（它会与 DOM lib 冲突）。
export default {
  port: env.port,
  fetch: app.fetch,
};
