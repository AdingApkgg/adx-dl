import { z } from "zod";

export type CommunityEnv = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  host: string;
  /** 浏览器看到的站点地址，如 https://community.example.com。CSRF 校验和 Better Auth 都用它。 */
  publicOrigin: string;
  databaseUrl: string;
  redisUrl: string;
};

const REQUIRED = ["PUBLIC_ORIGIN", "DATABASE_URL", "REDIS_URL"] as const;

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_ORIGIN: z.string().regex(/^https?:\/\/[^/]+$/, "必须是 scheme://host[:port]，不带路径"),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "必须以 postgres:// 或 postgresql:// 开头"),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "必须以 redis:// 或 rediss:// 开头"),
});

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

export function parseEnv(source: Record<string, string | undefined>): CommunityEnv {
  const read = (key: string) => normalize(source[key]);
  const problems: string[] = [];

  for (const key of REQUIRED) {
    if (!read(key)) {
      problems.push(`${key} 未设置`);
    }
  }

  const result = schema.safeParse({
    NODE_ENV: read("NODE_ENV"),
    PORT: read("PORT"),
    HOST: read("HOST"),
    PUBLIC_ORIGIN: read("PUBLIC_ORIGIN")?.replace(/\/+$/, ""),
    DATABASE_URL: read("DATABASE_URL"),
    REDIS_URL: read("REDIS_URL"),
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
  };
}
