import { afterAll, describe, expect, test } from "bun:test";

import { startFakeOneBot } from "../testing/fake-onebot";
import { testRedis } from "../testing/test-redis";
import { createOneBotClient } from "./client";
import { checkNapcat, readNapcatHealth, recordNapcatHealth, writeNapcatHealth } from "./health";

const TOKEN = "napcat-token-napcat-token-0123456789";
const napcat = startFakeOneBot({ accessToken: TOKEN });
const client = createOneBotClient({ httpUrl: napcat.httpUrl, accessToken: TOKEN });
const key = `test:${crypto.randomUUID()}:napcat-health`;

afterAll(() => {
  napcat.stop();
});

describe("机器人状态", () => {
  test("在线、掉线（容器活着但 QQ 不在线）、连不上是三种状态", async () => {
    napcat.handle("get_status", () => ({ online: true, good: true }));
    expect(await checkNapcat(client)).toBe("online");

    napcat.handle("get_status", () => ({ online: false, good: true }));
    expect(await checkNapcat(client)).toBe("offline");

    const nowhere = createOneBotClient({ httpUrl: "http://127.0.0.1:9", accessToken: TOKEN });
    expect(await checkNapcat(nowhere)).toBe("unreachable");
  });

  test("写进 Redis 再读出来；3 分钟过期；没有记录时是 null", async () => {
    const redis = await testRedis();
    expect(await readNapcatHealth(redis, key)).toBeNull();

    await writeNapcatHealth(redis, "offline", key);

    expect(await readNapcatHealth(redis, key)).toBe("offline");
    expect(Number(await redis.send("TTL", [key]))).toBeGreaterThan(170);
  });

  test("recordNapcatHealth 检查一次并写入", async () => {
    napcat.handle("get_status", () => ({ online: true, good: true }));

    await recordNapcatHealth(client, await testRedis(), key);

    expect(await readNapcatHealth(await testRedis(), key)).toBe("online");
  });
});
