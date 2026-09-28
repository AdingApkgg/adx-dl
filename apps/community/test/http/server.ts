import { fileURLToPath } from "node:url";

import { testDatabaseUrl, testRedisUrl } from "../../src/server/testing/services";

export type RunningServer = {
  origin: string;
  url(path: string): string;
  stop(): void;
};

const appRoot = fileURLToPath(new URL("../..", import.meta.url));

// 启动 bun run build 的产物。必须在 apps/community 下启动：静态资源的路径相对于当前目录。
export async function startBuiltServer(): Promise<RunningServer> {
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
