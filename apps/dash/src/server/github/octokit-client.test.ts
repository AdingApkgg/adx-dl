import { describe, expect, mock, test } from "bun:test";
import { Octokit as OctokitCtor } from "octokit";

import { GitDataStepError, GitHubRequestError } from "./client";
import { createOctokitGitHubClient, noRetryOnRateLimit, type OctokitClientConfig } from "./octokit-client";

// 这个文件测四类东西：
//   1. withOctokit 的缓存契约——哪些失败该清缓存、哪些不该（I-4）。
//   2. 限流时真的不等不重试（I-1 的第二个问题）。
//   3.「GitHub 字段名 → DTO」的映射（文件下半部分「字段映射」「outbound
//      映射」「决策」几组 describe）。这部分以前是刻意不测的（见 2026-09-21
//      progress.md 的 Task 8 记录）——fake-client.ts 直接返回已经是
//      camelCase 的 DTO，把 octokit-client.ts 里 snake_case→camelCase 这层
//      映射整个绕过去了，真正把字段名搞错也不会有任何测试变红。这里补上：
//      假的是 octokit 的 HTTP 层（`mintOctokit` 铸出一个真 Octokit 实例，
//      只把 `request.fetch` 换成手写的桩），不是 GitHubClient 接口，所以
//      toRunSummary 和各方法体内联的映射代码是真的在跑，喂给它的是从安装
//      的 `octokit` 包自身方法签名派生出的、结构上等价于 GitHub 真实
//      wire 格式的 fixture（不是凭记忆造的字段名）。
//   4. 19 个 octokit 调用点每一个都真的挂了超时 signal（文件末尾「请求
//      超时」那一组）。它排在最后，是因为要同时用上面两套桩——`router`
//      那根假 fetch 和 `fakeOctokit` 那套手写 rest 桩——才能把 11 个
//      repo/actions 调用点和 8 个 content 调用点一次走完。

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

  test("已经是 GitHubRequestError 的错误原样上抛，不被重新包成基类", async () => {
    // GitDataStepError 这类子类带着 step/conflictPaths，重新包一次就只剩
    // message 和 status 了。用一个最小的子类来钉住这条契约，不依赖
    // GitDataStepError 本身是否已经写好。
    class TaggedError extends GitHubRequestError {
      constructor(readonly tag: string) {
        super("tagged failure", 500);
      }
    }
    const thrown = new TaggedError("keep-me");
    const kit = {
      rest: {
        repos: {
          get: async () => {
            throw thrown;
          },
        },
      },
    } as any;
    const client = createOctokitGitHubClient(config, async () => kit);

    const error = await client.getRepoInfo().catch((e: unknown) => e);
    expect(error).toBe(thrown);
    expect((error as TaggedError).tag).toBe("keep-me");
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

// ============================================================================
// 字段映射：假的是 octokit 的 HTTP 层，不是 GitHubClient 接口
// ============================================================================
//
// 上面几组 describe 都在验证「失败之后该不该清缓存」「等不等 retryAfter」
// 这类跟响应体长什么样完全无关的行为，用的假 kit 要么整个绕过 REST 方法
// （`makeFakeKit` 手写一个只有 `rest.repos.get` 的对象），要么虽然接了真
// 限流插件但响应体本身没人读。这一段反过来：把 GitHub 真实形状的 JSON
// 喂给一个真的 Octokit 实例（同一个 `octokit` 包），只在 `request.fetch`
// 这个缝隙上插一根手写的桩，于是 toRunSummary 和各方法体内联的映射代码
// ——把 snake_case 的 wire 字段读成 camelCase 的 DTO 字段那部分——是真的在
// 跑，不是被 fake-client.ts 那种「直接返回已经是 DTO 形状的对象」绕过去。
//
// fetch 缝隙已经被验证过、不是本次新发现：`createOctokitGitHubClient` 的
// `mintOctokit` 参数本来就是为「限流」那组测试加的（见 defaultMintOctokit
// 上面的注释），那组测试已经在用 `new OctokitCtor({ request: { fetch } })`
// 把网络换成假 fetch。这里的新东西只是喂更真实的响应体，缝隙本身没变。
// 另外直接读过安装版本的 `@octokit/request@10.0.16`
// （node_modules/.bun/@octokit+request@10.0.16/.../fetch-wrapper.js）确认
// 过注入点：`const fetch = requestOptions.request?.fetch || globalThis.fetch`
// ——`request.fetch` 优先于全局 fetch，且是唯一的网络出口，不存在「设了
// 还是会漏到 globalThis.fetch」的可能。
//
// 不可能连到真网络：
//   1. `auth: "test-token"` 是纯字符串 token。`@octokit/auth-token` 对字符
//      串 token 只做本地格式判断（是不是 JWT、是不是 `v1.`/`ghs_`/`ghu_`
//      前缀），不发任何请求（见 auth-token 包的 dist-src/auth.js）——不会
//      绕过 `App.getInstallationOctokit` 换安装态 token 那条真会敲 GitHub
//      的路径；生产代码的 `defaultMintOctokit` 才会走那条路径，测试从不
//      调用它。
//   2. 每个测试的假 fetch（下面的 `router`）只认识自己明确列出的
//      `方法 + URL 路径」，其余一律 throw——不会有请求静默漏到
//      `globalThis.fetch` 上；找不到路由本身就是「这次调用发出了一个
//      预期之外的请求」的证据，而不是被吞掉。
//   3. `bun test` 默认不带 `--preload` 网络墙一类的沙箱，但上面两条已经
//      让「拨号出去」在结构上不可达：没有任何代码路径会调用未被替换的
//      `fetch`。
//
// fixture 的类型从哪来：不新增依赖（不直接 `import` `@octokit/openapi-
// types`——那不是 apps/dash 的直接依赖，虽然在 lockfile 里，但从这个文件
// 按 Node/Bun 的模块解析规则走不到），而是从已经在用的 `octokit` 包自己
// 的方法签名反推：`Awaited<ReturnType<Kit["rest"]["repos"]["get"]>>["data"]`
// 这类表达式取到的就是 `RestEndpointMethodTypes["repos"]["get"]["response"]
// ["data"]`，跟生产代码里 `kit.rest.repos.get(...)` 返回的 `data` 是同一个
// 类型——概念上等价于 `components["schemas"]["full-repository"]`，但不需要
// 声明新的 import 路径。这条路径在写这份测试之前专门用一个临时探针文件
// 跑过 `tsc --noEmit` 验证过（详见报告），包括验证过 `DeepPartial<T>
// satisfies` 这个写法真的会在字段名写错时编译失败——不是「文档说能行」。

type Kit = InstanceType<typeof OctokitCtor>;

type RepoData = Awaited<ReturnType<Kit["rest"]["repos"]["get"]>>["data"];
type WorkflowsListData = Awaited<ReturnType<Kit["rest"]["actions"]["listRepoWorkflows"]>>["data"];
type WorkflowData = WorkflowsListData["workflows"][number];
type BranchesListData = Awaited<ReturnType<Kit["rest"]["repos"]["listBranches"]>>["data"];
type BranchData = BranchesListData[number];
// `getWorkflowRun`（单条）和 `listWorkflowRunsForRepo`（列表）在 GitHub 的
// schema 里读的是同一个 `workflow-run` 对象——下面只从前者派生 `RunData`，
// 列表端点的数组元素直接结构兼容，不需要另开一个类型名。
type RunData = Awaited<ReturnType<Kit["rest"]["actions"]["getWorkflowRun"]>>["data"];
type JobsListData = Awaited<ReturnType<Kit["rest"]["actions"]["listJobsForWorkflowRun"]>>["data"];
type JobData = JobsListData["jobs"][number];

/**
 * `Partial<T>` 只展开最外层一层——`owner`/`commit` 这类嵌套对象一旦出现在
 * fixture 里，就要求把 `simple-user`/`{sha,url}` 的全部必填字段都填满，
 * 否则没法只写测试关心的两三个字段。这里递归展开到叶子类型为止，同时
 * 仍然保留「多余属性检查」——字段名写错（比如 `head_branch` 写成
 * `head_ref`）在赋值处直接编译失败，这是保证 fixture 字段名不是凭记忆
 *编出来的第一道关卡，第二道关卡才是下面 mutation testing 要验证的运行时
 * 断言。
 */
type DeepPartial<T> = T extends (infer E)[]
  ? DeepPartial<E>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function repoPath(suffix = ""): string {
  return `/repos/${config.owner}/${config.repo}${suffix}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

/** dispatchWorkflow 的真实响应：204，无 body（`@octokit/request` 对 204/205
 * 直接短路返回，不解析 body，所以连 content-type 都不需要）。 */
function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/**
 * `init` 里专门列出 `signal`：`@octokit/request@10.0.16` 的
 * `dist-src/fetch-wrapper.js` 把 `requestOptions.request?.signal` 原样塞进真
 * fetch 的 init（那个文件里 `signal:` 只出现这一处），所以这根假 fetch 看得见
 * 每一次请求实际带着的超时 signal——调用点漏了 `request: { signal: ... }`，
 * 这里收到的就是 `undefined`。文件末尾「请求超时」那一组靠的正是这个缝隙。
 */
type MockFetch = (
  url: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal | null }
) => Promise<Response>;
type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  /** 这次请求实际带的超时 signal；调用点没挂时是 undefined。 */
  signal?: AbortSignal | null;
};

/**
 * 按「HTTP 方法 + URL 路径」（不含查询串——查询串留给测试自己去 `calls`
 * 里断言，路由不靠它区分）精确匹配到对应的响应。没有规则命中就直接
 * throw：这既是「测试发出了一个没人预期的请求」的信号（比如
 * getFailedStepLog 在没有失败 job 时本不该去下载日志——如果它去了，这里
 * 会因为找不到 "/actions/jobs/{job_id}/logs" 的路由而炸，而不是静默用某个默认
 * 响应糊过去），也是「不可能连到真网络」这条保证的具体实现：没有兜底
 * 分支会把请求放过去。
 */
function router(
  rules: Record<string, (url: URL, method: string, body: unknown) => Response | Promise<Response>>
): {
  fetch: MockFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: MockFetch = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const rawBody = init?.body;
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    calls.push({ method, path: url.pathname + url.search, body, signal: init?.signal });
    const respond = rules[`${method} ${url.pathname}`];
    if (!respond) throw new Error(`测试假 fetch 没有认识的路由：${method} ${url.pathname}${url.search}`);
    return await respond(url, method, body);
  };
  return { fetch: fetchImpl, calls };
}

/**
 * 把一个真的 Octokit 实例（走假 fetch，`mintOctokit` 直接返回它、从不
 * 调用 `App.getInstallationOctokit`）包成 GitHubClient。
 *
 * `throttle.id` 必须每个实例都不一样，不能省略——`@octokit/plugin-
 * throttling` 把 write 请求（非 GET/HEAD）的限流器存在*模块级*的
 * `groups.write`（`Bottleneck.Group`，`minTime: 1000`），按 `throttle.id`
 * 分组，不传就固定是 `"no-id"`。同一进程里所有没显式设置过这个 id 的
 * Octokit 实例——包括这个文件里不同的测试各自新建的实例——会落进同一个
 * key，连续的写请求（dispatchWorkflow/rerunRun/cancelRun）被迫至少间隔
 * 1 秒，`bun test` 会把这 1 秒计进每个测试的墙钟时间。这不是猜测：本地
 * 用一段独立探针脚本对比过「每个实例给不同 id」和「都用同一个 id」，
 * 前者两次 POST 都在 40ms 内，后者第二次稳定卡在约 1000ms——跟
 * `groups.write` 的 `minTime: 1000` 完全对得上。给每个测试一个独立 id，
 * 让它拿到自己独立的限流器，不跟其它测试抢同一个节流队列；
 * `onRateLimit`/`onSecondaryRateLimit` 仍然接到 `noRetryOnRateLimit`——
 * 跟生产的 `defaultMintOctokit` 用的是同一个处理函数，真的撞到限流响应时
 * 行为跟生产一致（立刻失败，不等待），而不是静默换成默认的「等待再重试
 * 一次」。
 */
function makeClient(fetchImpl: MockFetch) {
  const kit = new OctokitCtor({
    auth: "test-token",
    throttle: {
      id: `octokit-client.test-${crypto.randomUUID()}`,
      onRateLimit: noRetryOnRateLimit,
      onSecondaryRateLimit: noRetryOnRateLimit,
    },
    request: { fetch: fetchImpl },
  });
  return createOctokitGitHubClient(config, async () => kit);
}

function makeRepoData(overrides: DeepPartial<RepoData> = {}): RepoData {
  const base = {
    id: 830_111_222,
    node_id: "R_kgDOMbFhrw",
    name: "adx-dl",
    full_name: "AdingApkgg/adx-dl",
    owner: {
      login: "AdingApkgg",
      id: 55_667_788,
      node_id: "U_kg55667788",
      avatar_url: "https://avatars.githubusercontent.com/u/55667788",
      gravatar_id: "",
      url: "https://api.github.com/users/AdingApkgg",
      html_url: "https://github.com/AdingApkgg",
      type: "User",
      site_admin: false,
    },
    private: false,
    html_url: "https://github.com/AdingApkgg/adx-dl",
    description: "AstroDX 的下载/构建控制台后端",
    fork: false,
    url: `https://api.github.com${repoPath()}`,
    default_branch: "main",
  } satisfies DeepPartial<RepoData>;
  return { ...base, ...overrides } as RepoData;
}

function makeWorkflowData(overrides: DeepPartial<WorkflowData> = {}): WorkflowData {
  const base = {
    id: 2,
    node_id: "W_kgDOMbFhrw",
    name: "Dash check",
    path: ".github/workflows/dash-check.yml",
    state: "active",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    url: `https://api.github.com${repoPath("/actions/workflows/2")}`,
    html_url: "https://github.com/AdingApkgg/adx-dl/blob/main/.github/workflows/dash-check.yml",
    badge_url: "https://github.com/AdingApkgg/adx-dl/workflows/Dash%20check/badge.svg",
  } satisfies DeepPartial<WorkflowData>;
  return { ...base, ...overrides } as WorkflowData;
}

function makeBranchData(overrides: DeepPartial<BranchData> = {}): BranchData {
  const base = {
    name: "main",
    commit: {
      sha: "a706bac0000000000000000000000000000000",
      url: `https://api.github.com${repoPath("/commits/a706bac")}`,
    },
    protected: true,
  } satisfies DeepPartial<BranchData>;
  return { ...base, ...overrides } as BranchData;
}

function makeRunData(overrides: DeepPartial<RunData> = {}): RunData {
  const base = {
    id: 1001,
    name: "Build and Publish gh-pages",
    node_id: "WFR_kg1001",
    head_branch: "main",
    head_sha: "a706bac0000000000000000000000000000000",
    path: ".github/workflows/deploy-gh-pages.yml",
    run_number: 95,
    event: "push",
    status: "completed",
    conclusion: "success",
    workflow_id: 1,
    url: `https://api.github.com${repoPath("/actions/runs/1001")}`,
    html_url: "https://github.com/AdingApkgg/adx-dl/actions/runs/1001",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:06:00Z",
  } satisfies DeepPartial<RunData>;
  return { ...base, ...overrides } as RunData;
}

function makeJobData(overrides: DeepPartial<JobData> = {}): JobData {
  const base = {
    id: 5001,
    run_id: 1001,
    name: "deploy",
    // 故意和 job 自己的 name 不同——mutation 4（见报告）验证的就是
    // getFailedStepLog 有没有不小心读了这个字段而不是 job.name。
    workflow_name: "Build and Publish gh-pages",
    status: "completed",
    conclusion: "success",
    started_at: "2026-09-20T10:00:10Z",
    completed_at: "2026-09-20T10:06:00Z",
    head_sha: "a706bac0000000000000000000000000000000",
    url: `https://api.github.com${repoPath("/actions/jobs/5001")}`,
    html_url: "https://github.com/AdingApkgg/adx-dl/actions/runs/1001/job/5001",
    steps: [
      {
        name: "Build catalog",
        status: "completed",
        conclusion: "success",
        number: 1,
        started_at: "2026-09-20T10:00:10Z",
        completed_at: "2026-09-20T10:02:10Z",
      },
      {
        name: "Build site",
        status: "completed",
        conclusion: "success",
        number: 2,
        started_at: "2026-09-20T10:02:10Z",
        completed_at: "2026-09-20T10:06:00Z",
      },
    ],
  } satisfies DeepPartial<JobData>;
  return { ...base, ...overrides } as JobData;
}

describe("字段映射：getRepoInfo", () => {
  test("owner/repo/defaultBranch 分别来自 owner.login/name/default_branch，不是 full_name 等形近字段", async () => {
    // full_name（"AdingApkgg/adx-dl-mirror"）和 default_branch（"pre"）都
    // 故意跟「正确答案」长得不一样：如果 getRepoInfo 不小心从 full_name
    // 切仓库名，或者把默认分支硬编码成 "main"，这条测试能抓到，而不是靠
    // 巧合蒙混过关。
    const repo = makeRepoData({
      name: "adx-dl",
      full_name: "AdingApkgg/adx-dl-mirror",
      default_branch: "pre",
      owner: { login: "AdingApkgg" },
    });
    const { fetch } = router({ [`GET ${repoPath()}`]: () => jsonResponse(repo) });
    const client = makeClient(fetch);

    const result = await client.getRepoInfo();

    expect(result).toEqual({ owner: "AdingApkgg", repo: "adx-dl", defaultBranch: "pre" });
  });
});

describe("字段映射：listWorkflows", () => {
  test("id/name/path/state 直接来自同名 wire 字段", async () => {
    const workflows = [
      makeWorkflowData({
        id: 1,
        name: "Build and Publish gh-pages",
        path: ".github/workflows/deploy-gh-pages.yml",
        state: "active",
      }),
      makeWorkflowData({
        id: 2,
        name: "Dash check",
        path: ".github/workflows/dash-check.yml",
        state: "disabled_manually",
      }),
    ];
    const { fetch } = router({
      [`GET ${repoPath("/actions/workflows")}`]: () => jsonResponse({ total_count: workflows.length, workflows }),
    });
    const client = makeClient(fetch);

    const result = await client.listWorkflows();

    expect(result).toEqual([
      { id: 1, name: "Build and Publish gh-pages", path: ".github/workflows/deploy-gh-pages.yml", state: "active" },
      { id: 2, name: "Dash check", path: ".github/workflows/dash-check.yml", state: "disabled_manually" },
    ]);
  });
});

describe("字段映射：listBranches", () => {
  test("name/protected 直接来自同名 wire 字段；commit 等其它字段不进 DTO", async () => {
    const branches = [makeBranchData({ name: "main", protected: true }), makeBranchData({ name: "dev", protected: false })];
    const { fetch } = router({
      [`GET ${repoPath("/branches")}`]: () => jsonResponse(branches),
    });
    const client = makeClient(fetch);

    const result = await client.listBranches();

    expect(result).toEqual([
      { name: "main", protected: true },
      { name: "dev", protected: false },
    ]);
  });
});

describe("字段映射：listRuns 与 toRunSummary", () => {
  test("每个字段都来自正确的 wire 字段", async () => {
    const run = makeRunData({
      id: 1001,
      name: "Build and Publish gh-pages",
      status: "completed",
      conclusion: "success",
      event: "push",
      head_branch: "main",
      head_sha: "a706bac0000000000000000000000000000000",
      created_at: "2026-09-20T10:00:00Z",
      updated_at: "2026-09-20T10:06:00Z",
      run_number: 95,
      html_url: "https://github.com/AdingApkgg/adx-dl/actions/runs/1001",
    });
    const { fetch, calls } = router({
      [`GET ${repoPath("/actions/runs")}`]: () => jsonResponse({ total_count: 1, workflow_runs: [run] }),
    });
    const client = makeClient(fetch);

    const result = await client.listRuns();

    expect(result).toEqual([
      {
        id: 1001,
        name: "Build and Publish gh-pages",
        status: "completed",
        conclusion: "success",
        event: "push",
        branch: "main",
        sha: "a706bac0000000000000000000000000000000",
        createdAt: "2026-09-20T10:00:00Z",
        updatedAt: "2026-09-20T10:06:00Z",
        runNumber: 95,
        htmlUrl: "https://github.com/AdingApkgg/adx-dl/actions/runs/1001",
      },
    ]);
    expect(calls[0]?.path).toBe(`${repoPath("/actions/runs")}?per_page=30`); // 默认 perPage=30。
  });

  test("perPage 选项原样透传给 GitHub 的 per_page 查询参数", async () => {
    const { fetch, calls } = router({
      [`GET ${repoPath("/actions/runs")}`]: () => jsonResponse({ total_count: 0, workflow_runs: [] }),
    });
    const client = makeClient(fetch);

    await client.listRuns({ perPage: 5 });

    expect(calls[0]?.path).toBe(`${repoPath("/actions/runs")}?per_page=5`);
  });

  test("head_branch 为 null（GitHub 对 detached HEAD/tag 触发这样标注，DTO 的 branch 字段不是可空类型）：落到空字符串", async () => {
    const run = makeRunData({ head_branch: null });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs")}`]: () => jsonResponse({ total_count: 1, workflow_runs: [run] }),
    });
    const client = makeClient(fetch);

    const [result] = await client.listRuns();

    expect(result?.branch).toBe("");
  });

  test("name 为 null（GitHub 允许工作流运行不带名字）：落到 '(unnamed)' 占位符", async () => {
    const run = makeRunData({ name: null });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs")}`]: () => jsonResponse({ total_count: 1, workflow_runs: [run] }),
    });
    const client = makeClient(fetch);

    const [result] = await client.listRuns();

    expect(result?.name).toBe("(unnamed)");
  });

  test("status/conclusion 为空：??兜底——status 落到 'queued'，conclusion 落到 null", async () => {
    const run = makeRunData({ status: null, conclusion: null });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs")}`]: () => jsonResponse({ total_count: 1, workflow_runs: [run] }),
    });
    const client = makeClient(fetch);

    const [result] = await client.listRuns();

    expect(result?.status).toBe("queued");
    expect(result?.conclusion).toBeNull();
  });

  test("status/conclusion 用 `as` 断言成字面量联合类型、没有运行时校验：GitHub 送一个 DTO 联合类型之外的取值会原样穿透", async () => {
    // GitHub 自己的 schema 里 run 级别的 status/conclusion 就是裸的
    // `string | null`，没有枚举——是 DTO 这边（RunSummary["status"]/
    // ["conclusion"]）声称了一个更窄的字面量联合类型，toRunSummary 用
    // `as` 断言过去，不做运行时校验。这不是本次要修的 bug——是已知的、
    // 2026-09-21 progress.md 里 Task 8 minor 记录过的既有设计决策——这条
    // 测试单纯把「GitHub 送一个没见过的取值时，代码实际怎么做」钉住：
    // 原样穿透，而不是被过滤、被转成某个默认值，或者抛错。
    const run = makeRunData({ status: "startup_failure", conclusion: "size_limit_exceeded" });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs")}`]: () => jsonResponse({ total_count: 1, workflow_runs: [run] }),
    });
    const client = makeClient(fetch);

    const [result] = await client.listRuns();

    // `as any`：这两个取值按 DTO 的类型声明本不该出现在 `result.status`/
    // `result.conclusion` 上——这条测试验证的正是「类型声明说不会」和
    // 「运行时真的不会」是两回事。
    expect((result as any)?.status).toBe("startup_failure");
    expect((result as any)?.conclusion).toBe("size_limit_exceeded");
  });
});

describe("字段映射：getRun（run 详情 + jobs + steps）", () => {
  test("run 复用 toRunSummary；job 与 step 的每个字段都来自正确的 wire 字段", async () => {
    const run = makeRunData({ id: 1001, head_branch: "main" });
    const job = makeJobData({
      id: 5001,
      name: "deploy",
      status: "completed",
      conclusion: "success",
      started_at: "2026-09-20T10:00:10Z",
      completed_at: "2026-09-20T10:06:00Z",
      steps: [
        {
          name: "Build catalog",
          status: "completed",
          conclusion: "success",
          number: 1,
          started_at: "2026-09-20T10:00:10Z",
          completed_at: "2026-09-20T10:02:10Z",
        },
      ],
    });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001")}`]: () => jsonResponse(run),
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
    });
    const client = makeClient(fetch);

    const result = await client.getRun(1001);

    expect(result.run.id).toBe(1001);
    expect(result.run.branch).toBe("main");
    expect(result.jobs).toEqual([
      {
        id: 5001,
        name: "deploy",
        status: "completed",
        conclusion: "success",
        startedAt: "2026-09-20T10:00:10Z",
        completedAt: "2026-09-20T10:06:00Z",
        steps: [
          {
            name: "Build catalog",
            status: "completed",
            conclusion: "success",
            number: 1,
            startedAt: "2026-09-20T10:00:10Z",
            completedAt: "2026-09-20T10:02:10Z",
          },
        ],
      },
    ]);
  });

  test("job 仍在进行中：completed_at/conclusion 为 null 时原样落到 null", async () => {
    const job = makeJobData({ status: "in_progress", conclusion: null, completed_at: null, steps: [] });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001")}`]: () => jsonResponse(makeRunData()),
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
    });
    const client = makeClient(fetch);

    const result = await client.getRun(1001);

    expect(result.jobs[0]?.conclusion).toBeNull();
    expect(result.jobs[0]?.completedAt).toBeNull();
  });

  test("job.steps 整个字段缺失（可选）：落到空数组，不是 undefined 或抛错", async () => {
    const job = makeJobData();
    delete (job as any).steps; // 模拟 wire 上这个可选字段整个不存在，而不是空数组。
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001")}`]: () => jsonResponse(makeRunData()),
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
    });
    const client = makeClient(fetch);

    const result = await client.getRun(1001);

    expect(result.jobs[0]?.steps).toEqual([]);
  });

  test("step 的 started_at/completed_at 可选且可空：整个缺席和显式 null 都要落到 null", async () => {
    const job = makeJobData({
      steps: [
        { name: "缺字段", status: "queued", conclusion: null, number: 1 },
        { name: "显式 null", status: "queued", conclusion: null, number: 2, started_at: null, completed_at: null },
      ],
    });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001")}`]: () => jsonResponse(makeRunData()),
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
    });
    const client = makeClient(fetch);

    const result = await client.getRun(1001);

    expect(result.jobs[0]?.steps[0]).toMatchObject({ startedAt: null, completedAt: null });
    expect(result.jobs[0]?.steps[1]).toMatchObject({ startedAt: null, completedAt: null });
  });

  // 没有单独测「run 和 jobs 是不是真的用 Promise.all 并发发出」：试过用
  // 「run 的 handler 里 await 几次 microtask 之后检查 jobs 是否已经被
  // 请求」来证明，结果发现即使让够 8 轮 microtask，`jobsRequested` 仍然
  // read 不到 true——`kit.rest.actions.X(...)` 到真正调用 `request.fetch`
  // 之间经过的异步跳数比想象的更多、更不确定（hook 组合链、认证策略解析
  // 等），拿固定跳数当同步证据本质上是在赌时序，不是在测行为。这不是本次
  // 任务要测的东西（任务要测的是字段映射，不是并发时序），上面几条测试
  // 只要 run/jobs 任何一个没被真的请求到，router 就会因为找不到匹配路由
  // 而 throw——两个 URL 都被打到过这件事已经被间接覆盖了，没有必要为了
  // 「是不是严格并发」单开一条容易 flaky 的测试。
});

describe("outbound 映射：dispatchWorkflow / rerunRun / cancelRun", () => {
  test("dispatchWorkflow：workflowId 进 URL 路径，ref 进请求体；204 响应视为成功", async () => {
    const { fetch, calls } = router({
      [`POST ${repoPath("/actions/workflows/7/dispatches")}`]: () => noContentResponse(),
    });
    const client = makeClient(fetch);

    await expect(client.dispatchWorkflow(7, "dev")).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ ref: "dev" });
  });

  test("rerunRun：runId 进 URL 路径；201 响应视为成功", async () => {
    const { fetch, calls } = router({
      [`POST ${repoPath("/actions/runs/1001/rerun")}`]: () => jsonResponse({}, 201),
    });
    const client = makeClient(fetch);

    await expect(client.rerunRun(1001)).resolves.toBeUndefined();
    expect(calls[0]?.path).toBe(repoPath("/actions/runs/1001/rerun"));
  });

  test("cancelRun：runId 进 URL 路径；202 响应视为成功", async () => {
    const { fetch, calls } = router({
      [`POST ${repoPath("/actions/runs/1001/cancel")}`]: () => jsonResponse({}, 202),
    });
    const client = makeClient(fetch);

    await expect(client.cancelRun(1001)).resolves.toBeUndefined();
    expect(calls[0]?.path).toBe(repoPath("/actions/runs/1001/cancel"));
  });
});

describe("决策：getFailedStepLog", () => {
  test("没有失败的 job（cancelled 不是 failure）：返回 null，且根本不会去下载日志", async () => {
    const jobs = [makeJobData({ id: 5001, conclusion: "cancelled" }), makeJobData({ id: 5002, conclusion: "success" })];
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: jobs.length, jobs }),
      // 故意不给 /actions/jobs/*/logs 注册路由——如果实现在没有失败 job
      // 时仍然去下载日志，router 会因为找不到匹配规则而 throw，测试直接
      // 失败，而不是静默放行。
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result).toBeNull();
  });

  test("失败的 job 里没有任何失败的 step：stepName 落到占位符，jobName 仍然正确", async () => {
    const job = makeJobData({
      id: 5001,
      name: "deploy",
      conclusion: "failure",
      steps: [
        { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
        { name: "Build catalog", status: "completed", conclusion: "cancelled", number: 2 },
      ],
    });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
      [`GET ${repoPath("/actions/jobs/5001/logs")}`]: () => textResponse("setup error\n"),
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result?.jobName).toBe("deploy");
    expect(result?.stepName).toBe("(未知步骤)");
  });

  test("正常情况：从失败 job 里挑出失败 step（不是第一个/最后一个，证明按 conclusion 找，不是按下标取）", async () => {
    const job = makeJobData({
      id: 5001,
      name: "deploy",
      conclusion: "failure",
      steps: [
        { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
        { name: "Build catalog", status: "completed", conclusion: "failure", number: 2 },
        { name: "Build site", status: "completed", conclusion: "cancelled", number: 3 },
      ],
    });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
      [`GET ${repoPath("/actions/jobs/5001/logs")}`]: () => textResponse("boom\n"),
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result?.jobName).toBe("deploy");
    expect(result?.stepName).toBe("Build catalog");
  });

  test("多个 job 只有一个失败：挑的是失败的那个，不是第一个", async () => {
    const jobs = [
      makeJobData({ id: 5001, name: "lint", conclusion: "success", steps: [] }),
      makeJobData({
        id: 5002,
        name: "deploy",
        conclusion: "failure",
        steps: [{ name: "Build site", status: "completed", conclusion: "failure", number: 1 }],
      }),
    ];
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: jobs.length, jobs }),
      [`GET ${repoPath("/actions/jobs/5002/logs")}`]: () => textResponse("boom\n"),
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result?.jobName).toBe("deploy");
  });

  test("日志短于 200 行：过滤空行后原样保留，不补齐也不截断", async () => {
    const job = makeJobData({
      id: 5001,
      conclusion: "failure",
      steps: [{ name: "s", status: "completed", conclusion: "failure", number: 1 }],
    });
    const rawLines = ["line-1", "", "line-2", "  ", "line-3"];
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
      [`GET ${repoPath("/actions/jobs/5001/logs")}`]: () => textResponse(rawLines.join("\n")),
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result?.lines).toEqual(["line-1", "line-2", "line-3"]);
  });

  test("日志超过 200 行：只保留过滤空行之后的最后 200 行", async () => {
    const rawLines = Array.from({ length: 250 }, (_, i) => `line-${i + 1}`);
    const job = makeJobData({
      id: 5001,
      conclusion: "failure",
      steps: [{ name: "s", status: "completed", conclusion: "failure", number: 1 }],
    });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
      [`GET ${repoPath("/actions/jobs/5001/logs")}`]: () => textResponse(rawLines.join("\n")),
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result?.lines).toHaveLength(200);
    expect(result?.lines[0]).toBe("line-51"); // 250 行取最后 200 行，从第 51 行开始。
    expect(result?.lines[199]).toBe("line-250");
  });

  test("先过滤空行、再取尾部 200 行——顺序反过来会把本该保留的行漏掉", async () => {
    // 构造 250 行：前 50 行非空、中间 100 行是空行、后 100 行非空。过滤后
    // 一共 150 行非空，不到 200，所以“先过滤再取尾部 200”会把全部 150 行
    // 都保留下来。如果实现变成“先切原始最后 200 行、再过滤空行”：原始最后
    // 200 行是「中间 100 空行 + 后 100 行非空」，过滤后只剩 100 行——前
    // 50 行会被错误地丢掉。这条测试能分辨这两种实现顺序，而不只是分辨
    // 「是不是真的按 200 行截断」。
    const prefix = Array.from({ length: 50 }, (_, i) => `prefix-line-${i + 1}`);
    const blanks = Array.from({ length: 100 }, () => "");
    const tail = Array.from({ length: 100 }, (_, i) => `tail-line-${i + 151}`);
    const rawLines = [...prefix, ...blanks, ...tail];
    expect(rawLines).toHaveLength(250);

    const job = makeJobData({
      id: 5001,
      conclusion: "failure",
      steps: [{ name: "s", status: "completed", conclusion: "failure", number: 1 }],
    });
    const { fetch } = router({
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () => jsonResponse({ total_count: 1, jobs: [job] }),
      [`GET ${repoPath("/actions/jobs/5001/logs")}`]: () => textResponse(rawLines.join("\n")),
    });
    const client = makeClient(fetch);

    const result = await client.getFailedStepLog(1001);

    expect(result?.lines).toHaveLength(150);
    expect(result?.lines[0]).toBe("prefix-line-1");
    expect(result?.lines[49]).toBe("prefix-line-50");
    expect(result?.lines[50]).toBe("tail-line-151");
    expect(result?.lines[149]).toBe("tail-line-250");
  });
});

// ============================================================================
// 内容领域（Git Data API）：六步编排与错误语义
// ============================================================================
//
// 这一段测的是 commitFiles 的**编排**（哪一步先跑、拿到的 sha 往哪一步传、
// 哪一步失败会怎样），不是「GitHub 字段名 → DTO」的映射，所以用的是上半部分
// `makeFakeKit` 那种手写假 kit 的风格，而不是「铸一个真 Octokit、只换
// request.fetch」那种：后者要为 git/blob/tree/commit/ref 五个端点各造一份
// 结构完整的 wire fixture，而这里真正要钉住的是调用之间传的那几个 sha。
//
// `createContentMethods` 既不导出也不接参数（它是 createOctokitGitHubClient
// 内部的嵌套函数，闭包同一个 withOctokit——见那里的注释），所以测试一律走
// 工厂注入假 kit：`createOctokitGitHubClient(config, async () => octokit)`。

/** 造一个带 `.status` 的错误——octokit 抛出来的就长这样。 */
function httpError(status: number): Error {
  const error = new Error(`simulated GitHub failure ${status}`);
  (error as unknown as { status: number }).status = status;
  return error;
}

type FakeOctokitOptions = {
  /** 按调用顺序回调，用来断言六步真的按顺序跑了。 */
  onCall?: (name: string) => void;
  /** getRef 回的 HEAD commit sha。 */
  refSha?: string;
  /** getCommit 回的 tree sha——base_tree 该用的就是它，不是上面那个 commit sha。 */
  commitTreeSha?: string;
  /** verify-blob 那一步看到的「仓库现状」：路径 → 当前 blob sha。 */
  blobShaByPath?: Record<string, string>;
  /**
   * 路径不在 blobShaByPath 里时怎么回：true 抛 404（文件被删了），
   * false（默认）回一个数组（GitHub 对目录就是这么回的）。两条分支在实现里
   * 走的是不同的代码路径，结论都该是「冲突」。
   */
  missingIs404?: boolean;
  newBlobSha?: string;
  newTreeSha?: string;
  newCommitSha?: string;
  /** 给某一步配一个 HTTP 状态码，让它抛错。 */
  getRefStatus?: number;
  getCommitStatus?: number;
  createBlobStatus?: number;
  createTreeStatus?: number;
  createCommitStatus?: number;
  updateRefStatus?: number;
  /** getContentFile 用：正文与它的 blob sha。 */
  fileContent?: string;
  fileSha?: string;
  /**
   * getContent 回的 encoding。真实 API 对 1MB 以下的文件回 "base64"；
   * 1MB–100MB 的文件照样是 type: "file"，但 content 是空串、encoding 是
   * "none"。默认 "base64" 是常规那一档。
   */
  fileEncoding?: string;
  /** 让 getContent 回一个数组（目录），验证实现不会把它当成空文件。 */
  contentIsDirectory?: boolean;
};

/**
 * 造一个假的 REST 方法。
 *
 * 参数声明成 `options: any` 并真的传给 `record`/`result`，不是摆设：无参的
 * `mock()` 推出来的 Args 是 `[]`，`mock.calls[0][0]` 会直接编译失败——而
 * 「createTree 收到的 base_tree 是什么」正是这一组测试最要紧的断言。
 */
function restStub<T>(
  name: string,
  record: (name: string) => void,
  status: number | undefined,
  result: (options: any) => T
) {
  return mock(async (options: any) => {
    record(name);
    if (status !== undefined) throw httpError(status);
    return result(options);
  });
}

function fakeOctokit(options: FakeOctokitOptions = {}) {
  const blobShaByPath = options.blobShaByPath ?? {};
  const record = (name: string) => options.onCall?.(name);

  const getContent = restStub("getContent", record, undefined, (opts: { path: string }) => {
    if (options.contentIsDirectory) return { data: [] as unknown[] };
    // getContentFile 的测试配 fileContent；commitFiles 的 verify-blob 查的是
    // blobShaByPath（仓库现状）。两组测试不会同时配这两个字段。
    if (options.fileContent !== undefined) {
      return {
        data: {
          type: "file",
          content: Buffer.from(options.fileContent, "utf-8").toString("base64"),
          encoding: options.fileEncoding ?? "base64",
          sha: options.fileSha ?? "sha1",
        },
      };
    }
    const sha = blobShaByPath[opts.path];
    if (sha === undefined) {
      if (options.missingIs404) throw httpError(404);
      return { data: [] as unknown[] };
    }
    return { data: { type: "file", content: "", sha } };
  });

  return {
    rest: {
      repos: { getContent },
      git: {
        getRef: restStub("getRef", record, options.getRefStatus, () => ({
          data: { object: { sha: options.refSha ?? "head1" } },
        })),
        getCommit: restStub("getCommit", record, options.getCommitStatus, () => ({
          data: { tree: { sha: options.commitTreeSha ?? "tree1" } },
        })),
        createBlob: restStub("createBlob", record, options.createBlobStatus, () => ({
          data: { sha: options.newBlobSha ?? "blobNew" },
        })),
        createTree: restStub("createTree", record, options.createTreeStatus, () => ({
          data: { sha: options.newTreeSha ?? "treeNew" },
        })),
        createCommit: restStub("createCommit", record, options.createCommitStatus, () => ({
          data: { sha: options.newCommitSha ?? "commitNew" },
        })),
        updateRef: restStub("updateRef", record, options.updateRefStatus, () => ({ data: {} })),
      },
    },
  };
}

/** 把假 kit 包成客户端——`as any` 同 makeFakeKit：假实现不需要满足完整 Octokit 类型。 */
function makeContentClient(octokit: ReturnType<typeof fakeOctokit>) {
  return createOctokitGitHubClient(config, async () => octokit as any);
}

describe("createContentMethods.commitFiles", () => {
  test("commits every file in one commit, parented on the head it just read", async () => {
    const calls: string[] = [];
    const octokit = fakeOctokit({
      onCall: (name) => calls.push(name),
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "a.json": "shaA", "b.json": "shaB" },
      newBlobSha: "blobNew",
      newTreeSha: "treeNew",
      newCommitSha: "commitNew",
    });
    const client = makeContentClient(octokit);

    const result = await client.commitFiles({
      branch: "main",
      message: "content: 更新",
      files: [
        { path: "a.json", content: "{}\n", baseSha: "shaA" },
        { path: "b.json", content: "[]\n", baseSha: "shaB" },
      ],
    });

    expect(result.commitSha).toBe("commitNew");
    expect(result.commitUrl).toBe(
      `https://github.com/${config.owner}/${config.repo}/commit/commitNew`
    );
    expect(octokit.rest.git.createBlob).toHaveBeenCalledTimes(2);
    expect(octokit.rest.git.createCommit).toHaveBeenCalledTimes(1);
    expect(octokit.rest.git.createCommit.mock.calls[0][0]).toMatchObject({
      message: "content: 更新",
      tree: "treeNew",
      parents: ["head1"],
    });
    expect(octokit.rest.git.updateRef.mock.calls[0][0]).toMatchObject({
      ref: "heads/main",
      sha: "commitNew",
      force: false,
    });
    // 六步真的按顺序跑了，且 createTree/createCommit/updateRef 各只跑一次
    // ——「多文件一个 commit」这件事本身。
    expect(calls).toEqual([
      "getRef",
      "getCommit",
      "getContent",
      "getContent",
      "createBlob",
      "createBlob",
      "createTree",
      "createCommit",
      "updateRef",
    ]);
    // verify 读的是刚拿到的那个 HEAD，不是一个浮动的「最新」——否则第一层锁
    // 校验的仓库状态和 commit 挂上去的 parent 可能根本不是同一个快照。
    for (const call of octokit.rest.repos.getContent.mock.calls) {
      expect(call[0]).toMatchObject({ ref: "head1" });
    }
  });

  test("createTree gets the base commit's TREE sha, never the commit sha", async () => {
    // GitHub 只接受 tree 对象的 sha 作为 base_tree。把 commit sha 传进去是
    // 一个「看起来能跑」的写法（两者都是 40 位 hex），但会得到一棵空树，
    // 结果是这次 commit 把仓库里其他所有文件都删掉。
    const octokit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "a.json": "shaA" },
    });
    const client = makeContentClient(octokit);
    await client.commitFiles({
      branch: "main",
      message: "m",
      files: [{ path: "a.json", content: "{}\n", baseSha: "shaA" }],
    });

    const treeOptions = octokit.rest.git.createTree.mock.calls[0][0];
    expect(treeOptions).toMatchObject({ base_tree: "tree1" });
    // refSha 与 commitTreeSha 故意取了两个不同的值，所以上面那条断言真的能
    // 分辨「传了 tree sha」和「传了 commit sha」，不是碰巧相等而蒙混过关。
    expect(treeOptions.base_tree).not.toBe("head1");
    // 树里挂的是新建 blob 的 sha、模式是普通文件——写错这里同样会毁掉文件。
    expect(treeOptions.tree).toEqual([
      { path: "a.json", mode: "100644", type: "blob", sha: "blobNew" },
    ]);
  });

  test("a changed blob sha is a conflict naming the file, and nothing is written", async () => {
    const octokit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "a.json": "shaOTHER" },
    });
    const client = makeContentClient(octokit);

    const error = await client
      .commitFiles({
        branch: "main",
        message: "m",
        files: [{ path: "a.json", content: "{}\n", baseSha: "shaA" }],
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitDataStepError);
    expect(error).toMatchObject({ step: "verify-blob", status: 409, conflictPaths: ["a.json"] });
    expect(octokit.rest.git.createBlob).not.toHaveBeenCalled();
  });

  test("a deleted file is a conflict too, not a crash", async () => {
    const octokit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: {},
      missingIs404: true,
    });
    const client = makeContentClient(octokit);
    const error = await client
      .commitFiles({
        branch: "main",
        message: "m",
        files: [{ path: "a.json", content: "{}\n", baseSha: "shaA" }],
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ step: "verify-blob", status: 409, conflictPaths: ["a.json"] });
  });

  test("every conflicting file is named, not just the first", async () => {
    const octokit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "a.json": "x", "b.json": "y" },
    });
    const client = makeContentClient(octokit);
    const error = await client
      .commitFiles({
        branch: "main",
        message: "m",
        files: [
          { path: "a.json", content: "{}\n", baseSha: "shaA" },
          { path: "b.json", content: "{}\n", baseSha: "shaB" },
        ],
      })
      .catch((e: unknown) => e);
    expect((error as GitDataStepError).conflictPaths).toEqual(["a.json", "b.json"]);
  });

  test("updateRef's 422 becomes a 409, because non-fast-forward IS a conflict", async () => {
    const octokit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "a.json": "shaA" },
      updateRefStatus: 422,
    });
    const client = makeContentClient(octokit);
    const error = await client
      .commitFiles({
        branch: "main",
        message: "m",
        files: [{ path: "a.json", content: "{}\n", baseSha: "shaA" }],
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ step: "update-ref", status: 409 });
  });

  test("a failure in the middle carries the step it failed at", async () => {
    const octokit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "a.json": "shaA" },
      createTreeStatus: 500,
    });
    const client = makeContentClient(octokit);
    const error = await client
      .commitFiles({
        branch: "main",
        message: "m",
        files: [{ path: "a.json", content: "{}\n", baseSha: "shaA" }],
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ step: "create-tree", status: 500 });
  });
});

describe("createContentMethods.getContentFile", () => {
  test("decodes base64 content and returns the blob sha", async () => {
    const octokit = fakeOctokit({ fileContent: '{"a":1}\n', fileSha: "sha1" });
    const client = makeContentClient(octokit);
    expect(await client.getContentFile("a.json")).toEqual({
      path: "a.json",
      text: '{"a":1}\n',
      sha: "sha1",
    });
  });

  test("a directory response is an error, not a silent empty file", async () => {
    const octokit = fakeOctokit({ contentIsDirectory: true });
    const client = makeContentClient(octokit);
    await expect(client.getContentFile("some/dir")).rejects.toThrow();
  });

  test("超过 1MB 的文件 GitHub 不回正文，必须报错而不是解出一个空串", async () => {
    // GitHub 对 1MB–100MB 的文件仍然回 type: "file"，但 content 是空串、
    // encoding 是 "none"。照原样解 base64 会得到 ""，然后这个空串会被当成
    // 「文件的真实内容」提交回去——把文件清空。
    const octokit = fakeOctokit({ fileContent: "", fileEncoding: "none", fileSha: "sha1" });
    const client = makeContentClient(octokit);
    await expect(client.getContentFile("apps/web/content/community.json")).rejects.toThrow();
  });
});

/**
 * 这一组以前只有一条测试、只经过 `getRepoInfo` 一个调用点，标题却写着「每个
 * 真实调用都挂了 AbortSignal」，注释还声称「删掉任一调用点的 signal 这条测试
 * 就会红」。2026-09-22 逐点做变异测试实测，那句话是假的：
 *
 *     删 getRepoInfo 的 signal  →  红（43 pass / 1 fail）
 *     删 listBranches 的        →  全绿（44 pass / 0 fail）
 *     删 createTree 的          →  全绿
 *
 * 19 个调用点里有 18 个的超时没有任何测试在守。一句声称有覆盖而实际没有的
 * 注释比没有注释更糟——它恰好会让人在重构时放心地把某个超时删掉，而超时的
 * 存在理由（见 octokit-client.ts 顶部 READ_TIMEOUT_MS / WRITE_TIMEOUT_MS 的
 * 注释）是：不挂 signal 的话 `withOctokit` 里那个 await 永远不会 settle，
 * poller 的 `tick()` 和共用同一个实例的路由 handler 一起被钉死，且没有任何
 * 日志或界面提示。所以这里不是把标题改软，是把覆盖真的补齐到 19 个。
 *
 * 怎么做到「遍历全部调用点」而不手抄 19 份桩：两套桩各有一个天然收口点，
 * 断言下在收口点上，而不是下在某一个方法上。
 *
 *   - repo/actions 的 11 个调用点走 `router()` 那根假 fetch。
 *     `@octokit/request@10.0.16` 的 `dist-src/fetch-wrapper.js` 把
 *     `requestOptions.request?.signal` 原样传给真 fetch 的 init，所以假 fetch
 *     看得见每一次请求实际带的 signal，调用点漏了就是 `undefined`。
 *   - content 的 8 个调用点走 `fakeOctokit()` 那套手写 rest 桩。桩是 `mock()`
 *     造的，`.mock.calls[0][0]` 就是调用点传给 octokit 的整个 options 对象，
 *     `request.signal` 直接可读——`restStub` 把参数声明成 `options: any` 并
 *     真的透传，本来就是为这类断言留的缝。
 *
 * 这一组不断言超时的*时长*（READ 20s 还是 WRITE 45s）：`AbortSignal` 没有任何
 * 公开方式回头问「你是多少毫秒的」，真等它触发又要 20~45 秒。所以能钉住的是
 * 「挂了一个尚未触发的超时 signal」，钉不住「挂的是哪一档」——把
 * `timeoutSignal(READ_TIMEOUT_MS)` 错写成 `timeoutSignal(WRITE_TIMEOUT_MS)`
 * 这条，这里查不出来。
 */
describe("请求超时：19 个调用点逐个确认都挂了 AbortSignal", () => {
  test("客户端的方法清单没变——新增方法必须同时回到下面两条遍历里补一条驱动", () => {
    // 下面两条测试是「驱动每个公开方法，再在收口点上断言」。它们守得住既有
    // 方法里新长出来的调用点（请求条数对不上就红），却守不住一个压根没人驱动
    // 的新方法。这条把方法清单本身钉死：新增方法会先让这里红，而红的位置正是
    // 「该去补驱动」的地方，不会悄悄多出一个没人看守的调用点。
    //
    // `mintOctokit` 给的是个空对象：客户端的铸造是惰性的（`cached ??=`），
    // 只取方法名不会真的去调用它。
    const client = createOctokitGitHubClient(config, async () => ({}) as any);

    expect(Object.keys(client).sort()).toEqual([
      "cancelRun",
      "commitFiles",
      "dispatchWorkflow",
      "getContentFile",
      "getFailedStepLog",
      "getRepoInfo",
      "getRun",
      "listBranches",
      "listRuns",
      "listWorkflows",
      "rerunRun",
    ]);
  });

  test("createRepoMethods / createActionsMethods 的 11 个调用点：每个发出的请求都带着尚未触发的 AbortSignal", async () => {
    // 这个 job 是 failure，getFailedStepLog 才会往下走到「下载日志」那个
    // 调用点；同一份 jobs 响应也喂给 getRun，两个方法共用一条路由规则。
    const failedJob = makeJobData({
      id: 5001,
      conclusion: "failure",
      steps: [{ name: "Build site", status: "completed", conclusion: "failure", number: 1 }],
    });
    const { fetch, calls } = router({
      [`GET ${repoPath()}`]: () => jsonResponse(makeRepoData()),
      [`GET ${repoPath("/branches")}`]: () => jsonResponse([makeBranchData()]),
      [`GET ${repoPath("/actions/workflows")}`]: () =>
        jsonResponse({ total_count: 1, workflows: [makeWorkflowData()] }),
      [`GET ${repoPath("/actions/runs")}`]: () =>
        jsonResponse({ total_count: 1, workflow_runs: [makeRunData()] }),
      [`GET ${repoPath("/actions/runs/1001")}`]: () => jsonResponse(makeRunData()),
      [`GET ${repoPath("/actions/runs/1001/jobs")}`]: () =>
        jsonResponse({ total_count: 1, jobs: [failedJob] }),
      [`GET ${repoPath("/actions/jobs/5001/logs")}`]: () => textResponse("boom\n"),
      [`POST ${repoPath("/actions/workflows/7/dispatches")}`]: () => noContentResponse(),
      [`POST ${repoPath("/actions/runs/1001/rerun")}`]: () => jsonResponse({}, 201),
      [`POST ${repoPath("/actions/runs/1001/cancel")}`]: () => jsonResponse({}, 202),
    });

    const reads = makeClient(fetch);
    await reads.getRepoInfo();
    await reads.listBranches();
    await reads.listWorkflows();
    await reads.listRuns();
    await reads.getRun(1001);
    await reads.getFailedStepLog(1001);

    // 三个写操作各用一个独立 client：见 `makeClient` 上面那段注释——
    // `@octokit/plugin-throttling` 的 `groups.write` 按 `throttle.id` 分组、
    // `minTime: 1000`，三个 POST 串在同一个实例上会被强制隔开 1 秒。这不是
    // 照搬那段注释的推论，是对照跑出来的：三个写操作共用一个 client 时本文件
    // 4.82s → 7.03s，差 2.21s，正好是两次 minTime 等待。它们共用同一根假
    // fetch，所以 `calls` 仍然是一条完整的流水。
    await makeClient(fetch).dispatchWorkflow(7, "dev");
    await makeClient(fetch).rerunRun(1001);
    await makeClient(fetch).cancelRun(1001);

    // 先钉住「这一趟到底发出了哪些请求」——多一条少一条都得回到这里改。这是
    // 新增调用点的闸门：以后谁在 getRun 里多 await 一个端点，这里会先因为条数
    // 对不上而红，改完之后那个新调用点就自动被下面的 signal 断言一起守住了。
    // 比较前去掉查询串（per_page 之类不是这条测试关心的）、排序（getRun 的两
    // 个请求是 Promise.all 并发发出的，先后顺序不保证）。
    expect(calls.map((call) => `${call.method} ${call.path.replace(/\?.*$/, "")}`).sort()).toEqual(
      [
        `GET ${repoPath()}`,
        `GET ${repoPath("/branches")}`,
        `GET ${repoPath("/actions/workflows")}`,
        `GET ${repoPath("/actions/runs")}`,
        `GET ${repoPath("/actions/runs/1001")}`,
        `GET ${repoPath("/actions/runs/1001/jobs")}`, // getRun 的
        `GET ${repoPath("/actions/runs/1001/jobs")}`, // getFailedStepLog 的
        `GET ${repoPath("/actions/jobs/5001/logs")}`,
        `POST ${repoPath("/actions/workflows/7/dispatches")}`,
        `POST ${repoPath("/actions/runs/1001/rerun")}`,
        `POST ${repoPath("/actions/runs/1001/cancel")}`,
      ].sort()
    );

    // 断言下在假 fetch 这个收口点上，而不是下在某一个方法上：11 次请求里任意
    // 一次缺 signal 都会被原地点名，失败信息直接就是「哪个端点漏了」。
    const missing = calls
      .filter((call) => !(call.signal instanceof AbortSignal))
      .map((call) => `${call.method} ${call.path}`);
    expect(missing).toEqual([]);

    // 还没触发：`AbortSignal.timeout()` 是一次性的，如果谁把它提到函数外面存
    // 成共享变量（`timeoutSignal` 的注释里点名警告过的那个改法），复用到的就
    // 会是一个已经 aborted 的 signal，请求还没发出去就直接判超时。
    const alreadyAborted = calls
      .filter((call) => call.signal?.aborted)
      .map((call) => `${call.method} ${call.path}`);
    expect(alreadyAborted).toEqual([]);
  });

  test("createContentMethods 的 8 个调用点：每个传给 octokit 的参数都带着尚未触发的 AbortSignal", async () => {
    // 两个独立的 fakeOctokit：它的 getContent 桩一旦配了 fileContent，就会对
    // 所有 getContent 调用回同一份文件正文，而 commitFiles 的 verify-blob 要走
    // 的是 blobShaByPath 那条分支（见 FakeOctokitOptions 上的注释：两组测试不
    // 会同时配这两个字段）。分开还顺带解决了一件事——repos.getContent 有两个
    // 不同的调用点（getContentFile 一个、verify-blob 一个），落在两个桩上，各
    // 自的 mock.calls 就是各自调用点的独立证据，不会混成一堆分不清谁是谁。
    const readerKit = fakeOctokit({ fileContent: "{}\n", fileSha: "blobA" });
    await makeContentClient(readerKit).getContentFile("apps/web/content/community.json");

    const writerKit = fakeOctokit({
      refSha: "head1",
      commitTreeSha: "tree1",
      blobShaByPath: { "data/a.json": "blobA", "data/b.json": "blobB" },
    });
    await makeContentClient(writerKit).commitFiles({
      branch: "main",
      message: "chore: 超时覆盖",
      // 喂两个文件：verify-blob 和 create-blob 这两个调用点在实现里是按文件
      // 循环/并发的，两个文件才能证明断言覆盖的是整个循环，而不是只碰到了第
      // 一次迭代就收工。
      files: [
        { path: "data/a.json", content: "a\n", baseSha: "blobA" },
        { path: "data/b.json", content: "b\n", baseSha: "blobB" },
      ],
    });

    const optionsOf = (stub: { mock: { calls: unknown[][] } }): any[] =>
      stub.mock.calls.map((call) => call[0]);

    // 八个调用点，按它们在 octokit-client.ts 里出现的顺序。
    const sites: { site: string; options: any[] }[] = [
      { site: "getContentFile → repos.getContent", options: optionsOf(readerKit.rest.repos.getContent) },
      { site: "commitFiles/read-head → git.getRef", options: optionsOf(writerKit.rest.git.getRef) },
      { site: "commitFiles/read-base-commit → git.getCommit", options: optionsOf(writerKit.rest.git.getCommit) },
      { site: "commitFiles/verify-blob → repos.getContent", options: optionsOf(writerKit.rest.repos.getContent) },
      { site: "commitFiles/create-blob → git.createBlob", options: optionsOf(writerKit.rest.git.createBlob) },
      { site: "commitFiles/create-tree → git.createTree", options: optionsOf(writerKit.rest.git.createTree) },
      { site: "commitFiles/create-commit → git.createCommit", options: optionsOf(writerKit.rest.git.createCommit) },
      { site: "commitFiles/update-ref → git.updateRef", options: optionsOf(writerKit.rest.git.updateRef) },
    ];

    // 八个调用点一个都不能是 0 次——否则「遍历了全部调用点」又成了一句空话。
    expect(sites.filter((entry) => entry.options.length === 0).map((entry) => entry.site)).toEqual([]);

    // 按文件循环的那两个调用点确实各跑了两遍，不是只碰到第一次迭代。
    expect(optionsOf(writerKit.rest.repos.getContent)).toHaveLength(2);
    expect(optionsOf(writerKit.rest.git.createBlob)).toHaveLength(2);

    // 两处 repos.getContent 确实是两个不同的调用点：读文件那个不带 ref，
    // verify-blob 那个带着刚读到的 head sha。
    expect(optionsOf(readerKit.rest.repos.getContent)[0].ref).toBeUndefined();
    expect(optionsOf(writerKit.rest.repos.getContent)[0].ref).toBe("head1");

    const missing = sites.flatMap((entry) =>
      entry.options.filter((options) => !(options.request?.signal instanceof AbortSignal)).map(() => entry.site)
    );
    expect(missing).toEqual([]);

    const alreadyAborted = sites.flatMap((entry) =>
      entry.options.filter((options) => options.request?.signal?.aborted).map(() => entry.site)
    );
    expect(alreadyAborted).toEqual([]);
  });
});
