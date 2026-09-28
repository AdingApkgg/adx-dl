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
import { createRedisRateLimitStore } from "./middleware/rate-limit";
import { createOneBotClient } from "./napcat/client";
import { createNapcatSender } from "./napcat/sender";
import { connectRedis, getRedis, pingRedis } from "./redis/client";

const env = parseEnv(process.env);
const log = createLogger();
const { db, pool } = getDb(env.databaseUrl, {
  onPoolError: (error) => log.error("pg_pool_error", describeError(error)),
});
const redis = getRedis(env.redisUrl);
await connectRedis(redis, log);
const rateLimitStore = createRedisRateLimitStore(redis);

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
  checks: { db: () => pingDb(db), redis: () => pingRedis(redis) },
  rateLimitStore,
  auth,
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
    context.set(
      apiContext,
      createInProcessApi(app, c.req.raw, { origin: env.publicOrigin, requestId, clientIp: c.get("clientIp") })
    );
    context.set(queryClientContext, makeQueryClient());
    return context;
  },
  onGracefulShutdown: async () => {
    redis.close();
    await pool.end();
  },
});
