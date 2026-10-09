// 默认指向 compose.dev.yaml 起的服务；CI 通过环境变量指向服务容器。
export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? "postgres://community:community@127.0.0.1:55432/community_test";
}

export function testRedisUrl(): string {
  return process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379";
}

// test:http 启动的构建产物用同一个 Redis 的 1 号库：napcat:health、rl:* 是固定的键名，和开发服务器（0 号库）
// 共用就会互相串。bun test src 里的测试仍用 0 号库，它们的键都带随机前缀。
export function httpTestRedisUrl(): string {
  const url = new URL(testRedisUrl());
  url.pathname = "/1";
  return url.href;
}
