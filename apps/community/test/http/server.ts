import { fileURLToPath } from "node:url";

import { testDatabaseUrl, testRedisUrl } from "../../src/server/testing/services";
import { prepareTestQueues } from "../../src/server/testing/test-boss";

export type RunningServer = {
  origin: string;
  url(path: string): string;
  stop(): void;
};

const appRoot = fileURLToPath(new URL("../..", import.meta.url));

/** 构建产物用的 BETTER_AUTH_SECRET：测试要自己签会话 Cookie 时用它。 */
export const HTTP_TEST_AUTH_SECRET = "http-test-secret-http-test-secret-0123456789";

// 启动 bun run build 的产物。必须在 apps/community 下启动：静态资源的路径相对于当前目录。
export async function startBuiltServer(): Promise<RunningServer> {
  // 页面会读会话，表必须已经建好；pg-boss 的表和队列也要在（/readyz 查它们，注销要投递任务），
  // 和部署时先跑 db:migrate 一样。单独跑 test:http 时也不依赖先跑过 bun run check。
  await prepareTestQueues();

  const port = 40_000 + Math.floor(Math.random() * 10_000);
  const origin = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(["bun", "./build/server/index.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOST: "127.0.0.1",
      PUBLIC_ORIGIN: origin,
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: testRedisUrl(),
      BETTER_AUTH_SECRET: HTTP_TEST_AUTH_SECRET,
      GOOGLE_CLIENT_ID: "http-test-google-client",
      GOOGLE_CLIENT_SECRET: "http-test-google-secret",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      // 生产模式不许用控制台发送器。这里的 NapCat 地址不会被连到：HTTP 测试不发验证码，
      // 机器人状态也只从 Redis 读。
      QQ_SENDER: "napcat",
      QQ_CODE_HMAC_KEY: "http-test-hmac-http-test-hmac-0123456789ab",
      NAPCAT_HTTP_URL: "http://127.0.0.1:9",
      NAPCAT_WS_URL: "ws://127.0.0.1:9",
      NAPCAT_ACCESS_TOKEN: "http-test-napcat-token-0123456789abcdef",
      NAPCAT_BOT_QQ: "10001",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited early with code ${proc.exitCode}`);
    }
    try {
      if ((await fetch(`${origin}/healthz`)).ok) {
        return { origin, url: (path) => `${origin}${path}`, stop: () => proc.kill() };
      }
    } catch {
      // 还没起来。
    }
    await Bun.sleep(200);
  }
  proc.kill();
  throw new Error("server did not become healthy within 20s");
}
