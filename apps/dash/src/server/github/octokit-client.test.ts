import { describe, expect, test } from "bun:test";
import { Octokit as OctokitCtor } from "octokit";

import { createOctokitGitHubClient, noRetryOnRateLimit, type OctokitClientConfig } from "./octokit-client";

// 这里不测「GitHub 字段名 → DTO」的映射——那是刻意不测的部分（见
// octokit-client.ts 顶部注释与 Task 8 报告）。这个文件测两件事：
//   1. withOctokit 的缓存契约——哪些失败该清缓存、哪些不该（I-4）。
//   2. 限流时真的不等不重试（I-1 的第二个问题）。

const config: OctokitClientConfig = {
  appId: "test-app-id",
  privateKey: "unused-in-test",
  installationId: 1,
  owner: "AdingApkgg",
  repo: "adx-dl",
};

/**
 * 假 octokit 实例：`rest.repos.get` 按需成功或失败，其余字段用不到。
 * `failStatus` 决定失败时错误对象上的 `.status`——区分凭证类失败
 * （401/403，该清缓存）和普通失败（404/429/5xx，不该清缓存）。
 */
function makeFakeKit(behavior: "ok" | "fail", failStatus = 500) {
  return {
    rest: {
      repos: {
        get: async () => {
          if (behavior === "fail") {
            const error = new Error("simulated GitHub failure");
            (error as unknown as { status: number }).status = failStatus;
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
  test("铸造本身失败（mintOctokit 抛错）会清掉缓存，下一次调用真的重新铸造", async () => {
    // 这条对应 withOctokit 里第一个 try——`await octokit()` 本身失败，跟
    //「铸出来的实例后来在某次调用里失败」是两条不同的路径，必须分开测：
    // 前者缓存的是一个已经 reject 的 promise，不清掉的话 mintOctokit
    // 再也不会被真的调用第二次。
    let mintCount = 0;
    let mintShouldFail = true;

    const mintOctokit = async () => {
      mintCount += 1;
      if (mintShouldFail) {
        throw new Error("simulated mint failure（凭证错误或网络不通）");
      }
      return makeFakeKit("ok");
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

    await expect(client.getRepoInfo()).rejects.toThrow();
    expect(mintCount).toBe(1);

    mintShouldFail = false;
    const repo = await client.getRepoInfo();

    expect(mintCount).toBe(2);
    expect(repo).toEqual({ owner: config.owner, repo: config.repo, defaultBranch: "main" });
  });

  test("凭证类失败（401）会清掉缓存，下一次调用真的换一个新实例", async () => {
    let mintCount = 0;
    let nextBehavior: "ok" | "fail" = "fail";

    const mintOctokit = async () => {
      mintCount += 1;
      return makeFakeKit(nextBehavior, 401);
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

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

  test("凭证类失败（403）会清掉缓存，下一次调用真的换一个新实例", async () => {
    let mintCount = 0;
    let nextBehavior: "ok" | "fail" = "fail";

    const mintOctokit = async () => {
      mintCount += 1;
      return makeFakeKit(nextBehavior, 403);
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

    await expect(client.getRepoInfo()).rejects.toThrow();
    expect(mintCount).toBe(1);

    nextBehavior = "ok";
    const repo = await client.getRepoInfo();

    expect(mintCount).toBe(2);
    expect(repo).toEqual({ owner: config.owner, repo: config.repo, defaultBranch: "main" });
  });

  test("404 这类非凭证失败不会清掉缓存：下一次调用复用同一个实例，不会重新铸造", async () => {
    let mintCount = 0;
    const mintOctokit = async () => {
      mintCount += 1;
      // 这个实例被永久配置成失败——如果 withOctokit 因为这次 404 清掉了
      // 缓存，下一次调用会触发第二次铸造（mintCount 变成 2）。如果没清，
      // 下一次调用复用同一个坏实例，mintCount 停在 1，且还是同样报 404
      // （不会变成别的错误）。
      return makeFakeKit("fail", 404);
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

    const firstError = await client.getRepoInfo().catch((error) => error);
    expect(firstError).toBeInstanceOf(Error);
    expect((firstError as { status?: number }).status).toBe(404);
    expect(mintCount).toBe(1);

    const secondError = await client.getRepoInfo().catch((error) => error);
    expect((secondError as { status?: number }).status).toBe(404);
    expect(mintCount).toBe(1);
  });

  test("500 这类上游故障不会清掉缓存：下一次调用复用同一个实例，不会重新铸造", async () => {
    // Task 8/9 把轮询间隔收到 5 秒之后，这条尤其重要：GitHub 侧持续故障
    // 期间，如果每次 5xx 都清缓存，进程会每 5 秒换一次 installation
    // token，给本来就在挣扎的 GitHub App 认证端点火上浇油。
    let mintCount = 0;
    const mintOctokit = async () => {
      mintCount += 1;
      return makeFakeKit("fail", 500);
    };

    const client = createOctokitGitHubClient(config, mintOctokit);

    await client.getRepoInfo().catch(() => {});
    expect(mintCount).toBe(1);

    await client.getRepoInfo().catch(() => {});
    expect(mintCount).toBe(1);
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

describe("请求超时：每个真实调用都挂了 AbortSignal", () => {
  test("传给 octokit 的调用参数里带了一个还没触发的 AbortSignal", async () => {
    // 不用真的等超时触发（20s/45s，会让测试慢得没法用）——这里只证明
    //「超时机制真的接到了这次调用上」：捕获 rest.repos.get 收到的参数，
    // 断言 request.signal 是一个尚未 aborted 的 AbortSignal 实例。如果
    // 有人以后把某个调用点的 `request: { signal: timeoutSignal(...) }`
    // 删掉，这条测试会红。
    let capturedOptions: any;
    const mintOctokit = async () => ({
      rest: {
        repos: {
          get: async (options: any) => {
            capturedOptions = options;
            return {
              data: {
                owner: { login: config.owner },
                name: config.repo,
                default_branch: "main",
              },
            };
          },
        },
      },
    });

    const client = createOctokitGitHubClient(config, mintOctokit as any);
    await client.getRepoInfo();

    expect(capturedOptions.request?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedOptions.request.signal.aborted).toBe(false);
  });
});

describe("限流时的策略：不等、不重试，立刻失败", () => {
  // 用真实的 octokit 类（跟生产代码同一个 `octokit` 包），拼上跟
  // `defaultMintOctokit` 里完全一样的 `noRetryOnRateLimit` 处理函数，
  // 只是用一个可控的假 fetch 代替真网络——这样测的是「真的接进 octokit
  // 限流插件之后，行为是不是我们想要的那样」，而不是孤立地测一个
  // 只会返回 false 的函数本身。

  test("primary 限流（403 + x-ratelimit-remaining: 0）：只打一次请求，不等待就失败", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
        },
      });
    };

    const ConfiguredOctokit = OctokitCtor.defaults({
      throttle: { onRateLimit: noRetryOnRateLimit, onSecondaryRateLimit: noRetryOnRateLimit },
    });
    const kit = new ConfiguredOctokit({ auth: "test-token", request: { fetch: mockFetch } });

    const t0 = performance.now();
    const error = await kit.rest.repos.get({ owner: config.owner, repo: config.repo }).catch(
      (e: unknown) => e
    );
    const elapsed = performance.now() - t0;

    expect(calls).toBe(1); // 默认策略会重试一次；我们的策略不重试。
    expect(elapsed).toBeLessThan(2_000); // 默认策略会先等掉 retryAfter（这里配的是一小时）。
    expect((error as { status?: number }).status).toBe(403);
  });

  test("secondary 限流（message 命中 secondary rate + retry-after）：只打一次请求，不等待就失败", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({ message: "You have exceeded a secondary rate limit. Please wait." }),
        {
          status: 403,
          headers: { "content-type": "application/json", "retry-after": "60" },
        }
      );
    };

    const ConfiguredOctokit = OctokitCtor.defaults({
      throttle: { onRateLimit: noRetryOnRateLimit, onSecondaryRateLimit: noRetryOnRateLimit },
    });
    const kit = new ConfiguredOctokit({ auth: "test-token", request: { fetch: mockFetch } });

    const t0 = performance.now();
    const error = await kit.rest.repos.get({ owner: config.owner, repo: config.repo }).catch(
      (e: unknown) => e
    );
    const elapsed = performance.now() - t0;

    expect(calls).toBe(1);
    expect(elapsed).toBeLessThan(2_000);
    expect((error as { status?: number }).status).toBe(403);
  });

  test("对照组：octokit 默认策略确实会等待 retryAfter 再重试（证明上面两条不是巧合）", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "0",
          // reset 定在 3 秒后，不是 1 秒——@octokit/plugin-throttling 算
          // retryAfter 时对 x-ratelimit-reset 做的是整秒截断
          // （`Math.floor(Date.now() / 1000)` 生成 header，`Math.ceil((reset
          // - Date.now()) / 1000) + 1` 算 retryAfter），如果 reset 只定在
          // 1 秒后，retryAfter 实际会在 1～2 秒之间摆动，取决于测试跑的
          // 那一刻恰好落在当前这一整秒的开头还是结尾——这不是假设，是在
          // 这个文件里真实翻过车的 flaky：某次运行 elapsed 量到
          // 1032ms，断言「> 1500」直接炸。定在 3 秒后能把 retryAfter 的下界
          // 稳定推到 3 秒（同样的截断误差只在 3～4 秒之间摆动，不会再跌到
          // 2 秒以下），断言阈值相应地留出安全余量，不再是「刚好卡在边界」。
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3),
        },
      });
    };

    // 不传 throttle 覆盖——用 octokit 包自带的默认 onRateLimit。
    const kit = new OctokitCtor({ auth: "test-token", request: { fetch: mockFetch } });

    const t0 = performance.now();
    await kit.rest.repos.get({ owner: config.owner, repo: config.repo }).catch(() => {});
    const elapsed = performance.now() - t0;

    expect(calls).toBeGreaterThan(1); // 默认策略重试了。
    // 下界稳定在 3 秒（见上面注释），2.5 秒的阈值留了 500ms 安全余量，
    // 不会因为整秒截断的抖动变成 flaky。
    expect(elapsed).toBeGreaterThan(2_500); // 默认策略真的等了。
  });
});
