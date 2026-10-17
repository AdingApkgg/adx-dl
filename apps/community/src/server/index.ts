import { serve, type ServerType } from "@hono/node-server";
import type { Socket } from "node:net";
import { createStorageContext } from "./storage/runtime";
import { createStorageIOTracker } from "./storage/maintenance";
import { startStorageRole, assertMediaProcess } from "./storage/runtime-role";
import { superviseStorageRole } from "./storage/process-supervision";
import { createMediaDrain } from "./storage/drain";
import { STORAGE_QUEUES } from "./jobs/queues";
import { assertNormalStorageStartup } from "../../ops/backup/restore";
import { RouterContextProvider } from "react-router";
import { createHonoServer } from "react-router-hono-server/node";

import { describeError } from "@/shared/describe-error";
import { createLogger } from "@/shared/log";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext, requestMetaContext } from "@/shared/router-context";

import { createApp } from "./app";
import type { AppEnv } from "./app-env";
import { createAuth } from "./auth/auth";
import { limitGoogleTokenExchange } from "./auth/google-timeout";
import { createRedisQqCodeStore } from "./auth/qq/codes";
import { createQqHasher } from "./auth/qq/hasher";
import { createConsoleSender } from "./auth/qq/sender";
import { createTurnstileVerifier } from "./auth/turnstile";
import { getDb, pingDb } from "./db/client";
import { parseEnv } from "./env";
import { createInProcessApi } from "./in-process-api";
import { assertQueueExists, getSender, stopSender } from "./jobs/boss";
import { USER_PURGE_QUEUE, MEDIA_PURGE_QUEUE } from "./jobs/queues";
import { createRedisRateLimitStore } from "./middleware/rate-limit";
import { createOneBotClient } from "./napcat/client";
import { createNapcatSender } from "./napcat/sender";
import { connectRedis, getRedis, pingRedis } from "./redis/client";
import { createLoginOptions } from "./services/login-options";
import { DELETION_HANDLERS } from "./services/user-deletion";
import { throttledErrorLog } from "./throttled-log";

await assertNormalStorageStartup();
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

const verifyTurnstile = createTurnstileVerifier({
  secretKey: env.turnstile.secretKey,
  expectedHostname: new URL(env.publicOrigin).hostname,
  log,
});
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
  awmc: env.awmc,
  rateLimitStore,
  rateLimitEnabled: env.nodeEnv === "production",
  verifyTurnstile,
  qq: {
    codes: createRedisQqCodeStore({ redis, limits: rateLimitStore }),
    sender: qqSender,
    hasher: createQqHasher(env.qqCodeHmacKey),
  },
});
// 换 Google 令牌这一步加上超时（原因写在 google-timeout.ts）。
await limitGoogleTokenExchange(auth);

const tracker = createStorageIOTracker();
const controller = new AbortController();
const storage = createStorageContext({db,boss:getBoss,log,role:"web",tracker,signal:controller.signal});
if(storage.config.role!=="web") throw new Error("STORAGE_WEB_REQUIRED");
const mediaDrain = createMediaDrain({db,secret:storage.config.internalMediaSecret});
const role = await startStorageRole({databaseUrl:env.databaseUrl,role:"web",tracker});
let publicServer: ServerType | undefined;
let internalServer: ServerType | undefined;
const sockets = new Set<Socket>();
const observe = (server: ServerType) => {
 server.on("connection",socket=>{sockets.add(socket);socket.once("close",()=>sockets.delete(socket));});
};
let stopping: Promise<void> | undefined;
function shutdown(): Promise<void> {
 if (stopping) return stopping;
 stopping = (async () => {
 tracker.pause();controller.abort();mediaDrain.shutdown();
 const closed=[publicServer,internalServer].map(server=>server ? new Promise<void>(resolve=>server.close(()=>resolve())) : Promise.resolve());
 for(const socket of sockets)socket.destroy();
 await Promise.all(closed);
 await tracker.pauseAndDrain(AbortSignal.timeout(30000));
 await role.stop();
 redis.close();await stopSender();await pool.end();
 })();
 return stopping;
}
superviseStorageRole(role.failure, shutdown, 35000);

const app = createApp({
  mediaDrain,
  log,
  isProduction: env.nodeEnv === "production",
  publicOrigin: env.publicOrigin,
  umamiInternalUrl: env.umami?.internalUrl ?? null,
  checks: {
    db: () => pingDb(db),
    storage: () => storage.driver.ready(AbortSignal.timeout(1800)),
    media: () => assertMediaProcess(env.databaseUrl),
    runtime: async () => role.ready(),
    redis: () => pingRedis(redis),
    // 部署脚本轮询 /readyz：pg-boss 的表或 user.purge 队列不在（迁移没跑），这里就是 fail。
    jobs: async () => {
      const boss = await getBoss();
      await assertQueueExists(boss, USER_PURGE_QUEUE);
      await assertQueueExists(boss, MEDIA_PURGE_QUEUE);
      for(const {name} of STORAGE_QUEUES) await assertQueueExists(boss,name);
    },
  },
  rateLimitStore,
  auth,
  services: {
    adminPublicIds: env.adminPublicIds,
    storage,
    db,
    boss: getBoss,
    loginOptions: createLoginOptions({
      turnstileSiteKey: env.turnstile.siteKey,
      awmc: Boolean(env.awmc),
      qq: env.qq,
      redis,
      onRedisError: throttledErrorLog(log, "login_options_redis_error"),
    }),
    deletionHandlers: DELETION_HANDLERS,
  },
});

// Node owns the public listener. Never default-export Hono.fetch to the Bun CLI.
const honoApp = await createHonoServer<AppEnv>({
  app,
  defaultLogger: false,
  port: env.port,
  hostname: env.host,
  overrideGlobalObjects: false,
  onServe(server) {
    publicServer=server; observe(server);
    internalServer=serve({hostname:env.host,port:Number(process.env.STORAGE_INTERNAL_PORT ?? 3001),overrideGlobalObjects:false,fetch:request=>mediaDrain.handle(request)});
    observe(internalServer);
  },
  beforeAll(server) {
    // Run after the adapter's static middleware has materialized its final response.
    server.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.status === 200 && /\/[^/]+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(c.req.path))
        c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    });
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
      umamiWebsiteId: env.umami?.websiteId ?? null,
      publicContactEmail: env.publicContactEmail,
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
 });
process.once("SIGTERM",()=>void shutdown());
process.once("SIGINT",()=>void shutdown());
export default import.meta.env.DEV ? honoApp : undefined;
