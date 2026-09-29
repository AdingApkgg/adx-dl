import { z } from "zod";

export type QqEnv =
  | { sender: "console" }
  | { sender: "napcat"; httpUrl: string; wsUrl: string; accessToken: string; botQq: string };

export type CommunityEnv = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  host: string;
  /** 浏览器看到的站点地址，如 https://community.example.com。CSRF 校验和 Better Auth 都用它。 */
  publicOrigin: string;
  databaseUrl: string;
  redisUrl: string;
  /** Better Auth 签 Cookie 和令牌用的密钥。 */
  betterAuthSecret: string;
  google: { clientId: string; clientSecret: string };
  turnstile: { siteKey: string; secretKey: string };
  /** QQ 验证码只以 HMAC(这把密钥, …) 的形式存进 Redis（spec 第 10.3 节）。 */
  qqCodeHmacKey: string;
  qq: QqEnv;
};

const REQUIRED = [
  "PUBLIC_ORIGIN",
  "DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "QQ_SENDER",
  "QQ_CODE_HMAC_KEY",
] as const;

// 机器人相关的四项只在 QQ_SENDER=napcat 时必填：本机开发用控制台发送器，用不到机器人。
const NAPCAT_REQUIRED = ["NAPCAT_HTTP_URL", "NAPCAT_WS_URL", "NAPCAT_ACCESS_TOKEN", "NAPCAT_BOT_QQ"] as const;

// NapCat 的访问令牌留空等于关掉它的鉴权，所以和密钥一样要求长度。
const secretKey = z.string().min(32, "至少要 32 个字符（可以用 openssl rand -base64 32 生成）");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_ORIGIN: z
    .string()
    .regex(/^https?:\/\/[^/]+$/, "必须是 scheme://host[:port]，不带路径")
    // 还得和浏览器 Origin 头的写法一字不差，即 new URL(值).origin。
    .refine(isCanonicalOrigin, "必须是规范写法：主机名小写，不写默认端口，不带查询串和用户名"),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "必须以 postgres:// 或 postgresql:// 开头"),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "必须以 redis:// 或 rediss:// 开头"),
  BETTER_AUTH_SECRET: secretKey,
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  TURNSTILE_SITE_KEY: z.string(),
  TURNSTILE_SECRET_KEY: z.string(),
  QQ_SENDER: z.enum(["napcat", "console"], { error: "只能是 napcat 或 console" }),
  QQ_CODE_HMAC_KEY: secretKey,
  NAPCAT_HTTP_URL: z.string().regex(/^https?:\/\//, "必须以 http:// 或 https:// 开头").optional(),
  NAPCAT_WS_URL: z.string().regex(/^wss?:\/\//, "必须以 ws:// 或 wss:// 开头").optional(),
  NAPCAT_ACCESS_TOKEN: secretKey.optional(),
  NAPCAT_BOT_QQ: z.string().regex(/^[1-9]\d{4,10}$/, "必须是 5 到 11 位数字，不以 0 开头").optional(),
});

type ParsedEnv = z.infer<typeof schema>;

function isCanonicalOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

// compose 的 env_file 可能把引号原样传进来；空字符串当作没设置，好让默认值生效。
function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function qqEnv(env: ParsedEnv): QqEnv {
  if (env.QQ_SENDER === "console") {
    return { sender: "console" };
  }
  const { NAPCAT_HTTP_URL: httpUrl, NAPCAT_WS_URL: wsUrl, NAPCAT_ACCESS_TOKEN: accessToken, NAPCAT_BOT_QQ: botQq } = env;
  // parseEnv 已经检查过这四项；这里再判断一次是为了让类型收窄。
  if (!httpUrl || !wsUrl || !accessToken || !botQq) {
    throw new Error("NAPCAT_* should have been checked by parseEnv");
  }
  return { sender: "napcat", httpUrl, wsUrl, accessToken, botQq };
}

export function parseEnv(source: Record<string, string | undefined>): CommunityEnv {
  const read = (key: string) => normalize(source[key]);
  const problems: string[] = [];

  for (const key of REQUIRED) {
    if (!read(key)) {
      problems.push(`${key} 未设置`);
    }
  }
  if (read("QQ_SENDER") === "napcat") {
    for (const key of NAPCAT_REQUIRED) {
      if (!read(key)) {
        problems.push(`${key} 未设置（QQ_SENDER=napcat 时必填）`);
      }
    }
  }

  const result = schema.safeParse({
    NODE_ENV: read("NODE_ENV"),
    PORT: read("PORT"),
    HOST: read("HOST"),
    PUBLIC_ORIGIN: read("PUBLIC_ORIGIN")?.replace(/\/+$/, ""),
    DATABASE_URL: read("DATABASE_URL"),
    REDIS_URL: read("REDIS_URL"),
    BETTER_AUTH_SECRET: read("BETTER_AUTH_SECRET"),
    GOOGLE_CLIENT_ID: read("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: read("GOOGLE_CLIENT_SECRET"),
    TURNSTILE_SITE_KEY: read("TURNSTILE_SITE_KEY"),
    TURNSTILE_SECRET_KEY: read("TURNSTILE_SECRET_KEY"),
    QQ_SENDER: read("QQ_SENDER"),
    QQ_CODE_HMAC_KEY: read("QQ_CODE_HMAC_KEY"),
    NAPCAT_HTTP_URL: read("NAPCAT_HTTP_URL"),
    NAPCAT_WS_URL: read("NAPCAT_WS_URL"),
    NAPCAT_ACCESS_TOKEN: read("NAPCAT_ACCESS_TOKEN"),
    NAPCAT_BOT_QQ: read("NAPCAT_BOT_QQ"),
  });

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]);
      // 缺项已经报过"未设置"，不再重复报类型错误。
      if (!problems.some((problem) => problem.startsWith(`${key} `))) {
        problems.push(`${key} ${issue.message}`);
      }
    }
  }

  // 控制台发送器把验证码打印到标准输出，生产环境里就进了日志。
  if (result.success && result.data.NODE_ENV === "production" && result.data.QQ_SENDER === "console") {
    problems.push("QQ_SENDER 生产环境不能用 console（验证码会被打印进日志）");
  }

  if (problems.length > 0 || !result.success) {
    // 一次列全：容器起不来时只看得到一段日志，逐个报错就要逐个重启。
    throw new Error(`环境变量有问题：\n- ${problems.join("\n- ")}`);
  }

  const env = result.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    publicOrigin: env.PUBLIC_ORIGIN,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    turnstile: { siteKey: env.TURNSTILE_SITE_KEY, secretKey: env.TURNSTILE_SECRET_KEY },
    qqCodeHmacKey: env.QQ_CODE_HMAC_KEY,
    qq: qqEnv(env),
  };
}
