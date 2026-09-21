import { createRunPoller } from "./actions/run-poller";
import { createApp } from "./app";
import { createOctokitGitHubClient } from "./github/octokit-client";
import { parseEnv } from "./env";

const env = parseEnv(process.env);

// 同一个 client 喂给 app（路由按需读）和 poller（后台按间隔轮询）——
// 两边共用一份 octokit/installation token 缓存，不用各起一份。
const github = createOctokitGitHubClient({
  appId: env.githubAppId,
  privateKey: env.githubPrivateKey,
  installationId: env.githubInstallationId,
  owner: env.repoOwner,
  repo: env.repoName,
});

const poller = createRunPoller({ github });
poller.start();

const app = createApp({
  clientRoot: env.clientRoot,
  github,
  poller,
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
