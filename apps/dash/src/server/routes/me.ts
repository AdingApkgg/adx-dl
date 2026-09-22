import type { Hono } from "hono";

import type { MeResponse } from "@/shared/dto";

import type { RepoClient } from "../github/client";
import type { AccessVariables } from "../middleware/access-jwt";

export type MeDeps = {
  // 只依赖 getRepoInfo 这一个方法——这个路由不查分支，没有理由要求调用方
  // 连 RepoClient 里的 listBranches 也一并实现（更不用说整个
  // ActionsClient）。跟 run-poller.ts 的 `Pick<ActionsClient, "listRuns">`
  // 同一条规则：窄到消费方实际调用的方法集合，不是「用得到的领域」——
  // 域接口（RepoClient/ActionsClient）本身只在两处出现：实现要满足它
  // （octokit-client.ts/fake-client.ts）、或者消费方真的要用到该域全部
  // 方法（比如 routes/actions.ts 横跨两个域，直接依赖组合后的
  // GitHubClient）。
  github: Pick<RepoClient, "getRepoInfo">;
};

export function registerMeRoute(
  app: Hono<{ Variables: AccessVariables }>,
  deps: MeDeps
) {
  app.get("/api/me", async (c) => {
    const identity = c.get("identity");

    // 这个端点是连通性自检的数据源，所以 GitHub 那边挂了它自己也要活着：
    // 200 + repoError 能让界面显示原因，500 只会给出一片白。
    let repo: MeResponse["repo"] = null;
    let repoError: MeResponse["repoError"] = null;
    try {
      repo = await deps.github.getRepoInfo();
    } catch (error) {
      repoError = error instanceof Error ? error.message : String(error);
      // 这条分支故意不抛错、也不改状态码（见上面的注释），所以它永远不会
      // 走到 createApp 里那个集中记日志的 app.onError —— 这是整个服务端
      // 唯一还需要在这里单独打一行日志的地方。不记 token/私钥，只记消息。
      console.error(`[me] getRepoInfo failed: ${repoError}`);
    }

    return c.json<MeResponse>({ email: identity.email, repo, repoError });
  });
}
