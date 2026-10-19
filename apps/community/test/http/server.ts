import { storageFixtureConfig } from "../storage/fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeRestoreState } from "../../ops/backup/restore";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

import { RedisClient } from "bun";

import { httpTestRedisUrl, testDatabaseUrl } from "../../src/server/testing/services";
import { prepareTestQueues } from "../../src/server/testing/test-boss";

export type RunningServer = {
  origin: string;
  url(path: string): string;
  stop(): Promise<void>;
};

const appRoot = fileURLToPath(new URL("../..", import.meta.url));

/** 构建产物用的 BETTER_AUTH_SECRET：测试要自己签会话 Cookie 时用它。 */
export const HTTP_TEST_AUTH_SECRET = "http-test-secret-http-test-secret-0123456789";

// Reserve both listeners while checking: fixture PostgreSQL/S3 ports may occupy the internal offset.
async function freePortPair():Promise<number>{
 for(let attempt=0;attempt<100;attempt++){
  const port=40000+Math.floor(Math.random()*10000),listeners:ReturnType<typeof createServer>[]=[];
  try{for(const selected of [port,port+10000]){const server=createServer();listeners.push(server);await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(selected,"127.0.0.1",()=>resolve());});}return port;}
  catch{}finally{await Promise.all(listeners.map(server=>new Promise<void>(resolve=>{if(server.listening)server.close(()=>resolve());else resolve();})));}
 }
 throw Error("HTTP_TEST_PORT_PAIR_UNAVAILABLE");
}

// 启动 bun run build 的产物。必须在 apps/community 下启动：静态资源的路径相对于当前目录。
// extraEnv 盖在默认的环境变量上（比如开统计的那组）。
export async function startBuiltServer(extraEnv: Record<string, string> = {}): Promise<RunningServer> {
  // 页面会读会话，表必须已经建好；pg-boss 的表和队列也要在（/readyz 查它们，注销要投递任务），
  // 和部署时先跑 db:migrate 一样。单独跑 test:http 时也不依赖先跑过 bun run check。
  await prepareTestQueues();
  // 1 号库只给 test:http 用（httpTestRedisUrl 的注释）。每次启动前清空：上一轮留下的限流计数、机器人状态不带进来。
  const redis = new RedisClient(httpTestRedisUrl());
  await redis.connect();
  await redis.send("FLUSHDB", []);
  redis.close();

  const restoreStateDirectory = await mkdtemp(join(tmpdir(), "community-http-restore-state-"));
  await initializeRestoreState(restoreStateDirectory);
  const storage=await storageFixtureConfig();
  const port = await freePortPair();
  const origin = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(["bun", "./build/server/index.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOST: "127.0.0.1",
      PUBLIC_ORIGIN: origin,
      PUBLIC_CONTACT_EMAIL: "privacy@example.test",
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: httpTestRedisUrl(),
      BETTER_AUTH_SECRET: HTTP_TEST_AUTH_SECRET,
      STORAGE_RESTORE_STATE_DIR: restoreStateDirectory,
      STORAGE_INTERNAL_PORT: String(port+10000),
      STORAGE_S3_ENDPOINT: storage.endpoint,
      STORAGE_WEB_ACCESS_KEY_ID: storage.accessKeyId,
      STORAGE_WEB_SECRET_ACCESS_KEY: storage.secretAccessKey,
      STORAGE_TEMP_DIR: storage.tempDir,
      STORAGE_CAPACITY_DIR: storage.tempDir,
      STORAGE_RECIPE_BUILD: storage.recipeBuild,
      STORAGE_INTERNAL_MEDIA_SECRET: "http-test-internal-media-secret-0123456789",
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
      ...extraEnv,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      await rm(restoreStateDirectory, { recursive: true, force: true });
      throw new Error(`server exited early with code ${proc.exitCode}`);
    }
    try {
      if ((await fetch(`${origin}/healthz`)).ok) {
        return { origin, url: (path) => `${origin}${path}`, stop: async () => { proc.kill(); await proc.exited; await rm(restoreStateDirectory, { recursive: true, force: true }); } };
      }
    } catch {
      // 还没起来。
    }
    await Bun.sleep(200);
  }
  proc.kill();
  await proc.exited;
  await rm(restoreStateDirectory, { recursive: true, force: true });
  throw new Error("server did not become healthy within 20s");
}
