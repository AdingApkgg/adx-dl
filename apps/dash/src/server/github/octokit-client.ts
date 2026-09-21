import { App, Octokit as OctokitCtor } from "octokit";

import type { RepoInfo } from "@/shared/dto";

import { GitHubRequestError, type GitHubClient } from "./client";

export type OctokitClientConfig = {
  appId: string;
  privateKey: string;
  installationId: number;
  owner: string;
  repo: string;
};

// 不用 `Awaited<ReturnType<App["getInstallationOctokit"]>>`：octokit@5.0.5 里
// `App` 的类型是「显式大对象构造签名」与「@octokit/app 的泛型 App 类」两个构造签名的
// 交叉类型，`InstanceType` 对交叉的构造签名取的是后一个（泛型、默认 TOptions），
// 结果丢了 rest/paginate/retry —— 用 tsc 的 TypeChecker 实测验证过。
// `App` 内部用同一个 `Octokit` 类构造实例（dist-src/app.js: `DefaultApp.defaults({ Octokit })`），
// 所以直接从这个类取实例类型，运行时形状与类型完全一致。
type Octokit = InstanceType<typeof OctokitCtor>;

/** 把 octokit 抛出来的任意错误收敛成我们自己的错误类型。 */
function toRequestError(error: unknown): GitHubRequestError {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    const message = error instanceof Error ? error.message : String(error);
    return new GitHubRequestError(message, typeof status === "number" ? status : null);
  }
  return new GitHubRequestError(error instanceof Error ? error.message : String(error), null);
}

export function createOctokitGitHubClient(config: OctokitClientConfig): GitHubClient {
  const app = new App({ appId: config.appId, privateKey: config.privateKey });

  // 缓存的是 octokit 实例，不是 token —— token 的换取、缓存与到期刷新
  // 由 @octokit/auth-app 在实例内部处理，我们不重复造一份会过期的状态。
  let cached: Promise<Octokit> | null = null;
  const octokit = () => {
    cached ??= app.getInstallationOctokit(config.installationId);
    return cached;
  };

  return {
    async getRepoInfo(): Promise<RepoInfo> {
      try {
        const kit = await octokit();
        const { data } = await kit.rest.repos.get({
          owner: config.owner,
          repo: config.repo,
        });
        return {
          owner: data.owner.login,
          repo: data.name,
          defaultBranch: data.default_branch,
        };
      } catch (error) {
        // 认证失败时把缓存清掉，下次请求重新建实例——否则一次凭据问题
        // 会把这个进程钉死在坏实例上，直到重启。
        cached = null;
        throw toRequestError(error);
      }
    },
  };
}
