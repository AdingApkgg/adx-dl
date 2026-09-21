import { describe, expect, test } from "bun:test";

import { createOctokitGitHubClient, type OctokitClientConfig } from "./octokit-client";

// 这里不测「GitHub 字段名 → DTO」的映射——那是刻意不测的部分（见
// octokit-client.ts 顶部注释与 Task 8 报告）。这个文件只测 withOctokit
// 的缓存契约本身：失败要清缓存、下次调用要真的换一个新实例，而不是
// 复用那个已经坏掉的旧实例。用 getRepoInfo 当载体，因为它的映射最简单，
// 不会喧宾夺主。

const config: OctokitClientConfig = {
  appId: "test-app-id",
  privateKey: "unused-in-test",
  installationId: 1,
  owner: "AdingApkgg",
  repo: "adx-dl",
};

/** 假 octokit 实例：`rest.repos.get` 按需成功或失败，其余字段用不到。 */
function makeFakeKit(behavior: "ok" | "fail") {
  return {
    rest: {
      repos: {
        get: async () => {
          if (behavior === "fail") {
            const error = new Error("simulated GitHub failure");
            (error as unknown as { status: number }).status = 500;
            throw error;
          }
          return {
            data: { owner: { login: config.owner }, name: config.repo, default_branch: "main" },
          };
        },
      },
    },
    // 只有 rest.repos.get 会被用到；`as any` 是故意的，测试假实现不需要
    // 满足完整的 Octokit 类型（那个类型有几十个字段，跟这里要测的东西无关）。
  } as any;
}

describe("createOctokitGitHubClient 的缓存契约", () => {
  test("失败会清掉缓存，下一次调用真的换一个新实例，而不是复用坏实例", async () => {
    let mintCount = 0;
    let nextBehavior: "ok" | "fail" = "fail";

    const mintOctokit = async () => {
      mintCount += 1;
      return makeFakeKit(nextBehavior);
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

    // 第一次调用：铸出一个之后会失败的实例。
    await expect(client.getRepoInfo()).rejects.toThrow();
    expect(mintCount).toBe(1);

    // 切到「成功」再调一次——如果 withOctokit 没清缓存，这里拿到的还是
    // 上面那个已经失败过的旧实例（它的行为在铸造时就定死了），会继续抛错，
    // mintCount 也不会变成 2。
    nextBehavior = "ok";
    const repo = await client.getRepoInfo();

    expect(mintCount).toBe(2);
    expect(repo).toEqual({ owner: config.owner, repo: config.repo, defaultBranch: "main" });
  });

  test("没失败就不重新铸造：同一个实例被复用", async () => {
    let mintCount = 0;
    const mintOctokit = async () => {
      mintCount += 1;
      return makeFakeKit("ok");
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

    await client.getRepoInfo();
    await client.getRepoInfo();

    expect(mintCount).toBe(1);
  });
});
