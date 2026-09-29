import type { RedisClient } from "bun";

import { createRedis } from "../redis/client";
import { testRedisUrl } from "./services";

let client: RedisClient | undefined;
let connecting: Promise<void> | undefined;

// 测试共用一条连接（客户端不排队，发命令前必须连上）。测试写的键一律加随机前缀，
// 和开发数据、其他测试文件互不干扰。
export async function testRedis(): Promise<RedisClient> {
  client ??= createRedis(testRedisUrl());
  connecting ??= client.connect();
  await connecting;
  return client;
}
