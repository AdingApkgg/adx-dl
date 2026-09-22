import type { Hono } from "hono";

import type { MeResponse } from "@/shared/dto";

import type { RepoClient } from "../github/client";
import type { AccessVariables } from "../middleware/access-jwt";

export type MeDeps = {
  // 只依赖仓库元数据：这个路由只调用 getRepoInfo，不该要求调用方也实现
  // 整个 GitHub Actions 领域。
  github: RepoClient;
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
