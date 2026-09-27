import { createHonoServer } from "react-router-hono-server/bun";

import { createApp } from "./app";
import type { AppEnv } from "./app-env";
import { getDb, pingDb } from "./db/client";
import { parseEnv } from "./env";
import { createLogger } from "./log";
import { createRedisRateLimitStore } from "./middleware/rate-limit";
import { getRedis, pingRedis } from "./redis/client";

const env = parseEnv(process.env);
const log = createLogger();
const { db, pool } = getDb(env.databaseUrl);
const redis = getRedis(env.redisUrl);

// 生产环境里，这个模块一被 import 就会自己调用 Bun.serve。默认导出必须原样是
// createHonoServer 的返回值：换成别的 fetch，Bun 会再按默认导出起一个服务，端口冲突。
export default await createHonoServer<AppEnv>({
  app: createApp({
    log,
    isProduction: env.nodeEnv === "production",
    checks: { db: () => pingDb(db), redis: () => pingRedis(redis) },
    rateLimitStore: createRedisRateLimitStore(redis),
    publicOrigin: env.publicOrigin,
  }),
  defaultLogger: false,
  port: env.port,
  customBunServer: { hostname: env.host },
  onGracefulShutdown: async () => {
    redis.close();
    await pool.end();
  },
});
