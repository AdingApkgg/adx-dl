import type { Hono } from "hono";

import type { MeResponse } from "@/shared/dto";

import type { GitHubClient } from "../github/client";
import type { AccessVariables } from "../middleware/access-jwt";

export type MeDeps = {
  github: GitHubClient;
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
    }

    return c.json<MeResponse>({ email: identity.email, repo, repoError });
  });
}
