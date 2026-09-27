// 默认指向 compose.dev.yaml 起的服务；CI 通过环境变量指向服务容器。
export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? "postgres://community:community@127.0.0.1:55432/community_test";
}

export function testRedisUrl(): string {
  return process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379";
}
