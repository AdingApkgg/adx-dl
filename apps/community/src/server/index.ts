import { RouterContextProvider } from "react-router";
import { createHonoServer } from "react-router-hono-server/bun";

import { describeError } from "@/shared/describe-error";
import { createLogger } from "@/shared/log";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext, requestMetaContext } from "@/shared/router-context";

import { createApp } from "./app";
import type { AppEnv } from "./app-env";
import { createAuth } from "./auth/auth";
import { createRedisQqCodeStore } from "./auth/qq/codes";
import { createQqHasher } from "./auth/qq/hasher";
import { createConsoleSender } from "./auth/qq/sender";
import { createTurnstileVerifier } from "./auth/turnstile";
import { getDb, pingDb } from "./db/client";
import { parseEnv } from "./env";
import { createInProcessApi } from "./in-process-api";
import { assertQueueExists, getSender, stopSender } from "./jobs/boss";
import { USER_PURGE_QUEUE } from "./jobs/queues";
import { createRedisRateLimitStore } from "./middleware/rate-limit";
import { createOneBotClient } from "./napcat/client";
import { createNapcatSender } from "./napcat/sender";
import { connectRedis, getRedis, pingRedis } from "./redis/client";
import { createLoginOptions } from "./services/login-options";

const env = parseEnv(process.env);
const log = createLogger();
const { db, pool } = getDb(env.databaseUrl, {
  onPoolError: (error) => log.error("pg_pool_error", describeError(error)),
});
const redis = getRedis(env.redisUrl);
await connectRedis(redis, log);
const rateLimitStore = createRedisRateLimitStore(redis);

// pg-boss 的发送端：用到时才启动，失败不缓存。这里先启动一次，只为让配置问题（比如迁移还没跑）尽早出现在日志里。
const getBoss = () => getSender(env.databaseUrl, (error) => log.error("pgboss_error", describeError(error)));
void getBoss().catch((error) => log.error("pgboss_start_failed", describeError(error)));

const verifyTurnstile = createTurnstileVerifier({ secretKey: env.turnstile.secretKey, log });
const qqSender =
  env.qq.sender === "napcat"
    ? createNapcatSender(createOneBotClient({ httpUrl: env.qq.httpUrl, accessToken: env.qq.accessToken }), log)
    : createConsoleSender();

const auth = createAuth({
  db,
  log,
  publicOrigin: env.publicOrigin,
  secret: env.betterAuthSecret,
  google: env.google,
  rateLimitStore,
  rateLimitEnabled: env.nodeEnv === "production",
  verifyTurnstile,
  qq: {
    codes: createRedisQqCodeStore({ redis, limits: rateLimitStore }),
    sender: qqSender,
    hasher: createQqHasher(env.qqCodeHmacKey),
  },
});

const app = createApp({
  log,
  isProduction: env.nodeEnv === "production",
  publicOrigin: env.publicOrigin,
  checks: {
    db: () => pingDb(db),
    redis: () => pingRedis(redis),
    // 部署脚本轮询 /readyz：pg-boss 的表或 user.purge 队列不在（迁移没跑），这里就是 fail。
    jobs: async () => assertQueueExists(await getBoss(), USER_PURGE_QUEUE),
  },
  rateLimitStore,
  auth,
  services: {
    db,
    boss: getBoss,
    loginOptions: createLoginOptions({ turnstileSiteKey: env.turnstile.siteKey, qq: env.qq, redis }),
  },
});

// 生产环境里，这个模块一被 import 就会自己调用 Bun.serve。默认导出必须原样是
// createHonoServer 的返回值：换成别的 fetch，Bun 会再按默认导出起一个服务，端口冲突。
export default await createHonoServer<AppEnv>({
  app,
  defaultLogger: false,
  port: env.port,
  customBunServer: { hostname: env.host },
  serveStaticOptions: {
    // 构建产物文件名带哈希，内容永远不变；默认的缓存头里没有 immutable。
    clientAssets: {
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    },
  },
  // 必须返回 RouterContextProvider：React Router 8 用 instanceof 检查。
  // 它在我们的中间件都跑过之后才调用，所以请求 ID、nonce、访客 IP 都已经有了。
  getLoadContext(c) {
    const requestId = c.get("requestId");
    const context = new RouterContextProvider();
    context.set(requestMetaContext, {
      requestId,
      nonce: c.get("secureHeadersNonce"),
      origin: env.publicOrigin,
    });
    // 进程内请求收到的 Set-Cookie（会话续期）先收在这里，createApp 里的中间件再补到页面响应上。
    const setCookies: string[] = [];
    c.set("inProcessSetCookies", setCookies);
    context.set(
      apiContext,
      createInProcessApi(
        app,
        c.req.raw,
        { origin: env.publicOrigin, requestId, clientIp: c.get("clientIp") },
        (cookie) => setCookies.push(cookie)
      )
    );
    context.set(queryClientContext, makeQueryClient());
    return context;
  },
  onGracefulShutdown: async () => {
    redis.close();
    // 发送端有自己的连接池，先停它，再关 Drizzle 的池。
    await stopSender();
    await pool.end();
  },
});
