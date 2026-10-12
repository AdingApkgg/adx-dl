import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyScript, createSandbox, type Sandbox } from "./fake-commands";

const DEPLOY = fileURLToPath(new URL("../../deploy.sh", import.meta.url));

// 假的 git：pull 之前 HEAD 是 aaaaaaa，之后是 bbbbbbb；分支由 FAKE_BRANCH 决定。假的 docker：迁移的退出码由
// FAKE_MIGRATE_EXIT 决定。curl 的耗时和就绪次数可控；date、sleep 共用一个假时钟，不真的等待。
const FAKES = {
  git: `case "$*" in
  "rev-parse HEAD") cat "$FAKE_DIR/head" ;;
  "rev-parse --abbrev-ref HEAD") echo "\${FAKE_BRANCH:-pre}" ;;
  "pull --ff-only") echo "\${FAKE_PULL_HEAD:-bbbbbbb}" > "$FAKE_DIR/head" ;;
esac`,
  docker: `if [ "$*" = "compose ps -q web" ]; then [ -n "\${FAKE_SERVING_IMAGE:-}" ] && echo serving; exit 0; fi
if [ "$*" = "inspect --format {{.Image}} serving" ]; then echo "$FAKE_SERVING_IMAGE"; exit 0; fi
if [ "$*" = "image inspect astrodx-community:rollback-aaaaaaa" ]; then exit "\${FAKE_ROLLBACK_INSPECT_EXIT:-1}"; fi
if [ "$*" = "compose exec -T media-worker bun src/server/storage/health.ts media" ]; then exit "\${FAKE_MEDIA_HEALTH_EXIT:-0}"; fi
[ "$*" = "compose run --rm migrate" ] && exit "\${FAKE_MIGRATE_EXIT:-0}"
exit 0`,
  date: `[ "$*" = '+%s' ] || exit 1
cat "$FAKE_DIR/clock"`,
  curl: `started=$(cat "$FAKE_DIR/clock")
mode="$1"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --max-time ]; then budget="$2"; break; fi
  shift
done
echo "$mode $started $budget" >> "$FAKE_DIR/probes"
elapsed="\${FAKE_CURL_SECONDS:-0}"
timed_out=0
if [ "$elapsed" -gt "$budget" ]; then elapsed="$budget"; timed_out=1; fi
echo "$((started + elapsed))" > "$FAKE_DIR/clock"
[ "$timed_out" = 0 ] || exit 28
count=$(( $(cat "$FAKE_DIR/curl-count" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$FAKE_DIR/curl-count"
ready="\${FAKE_READY_AFTER:-1}"
if [ "$ready" -gt 0 ] && [ "$count" -ge "$ready" ]; then echo '{"ok":true,"checks":{"db":"ok","redis":"ok","jobs":"ok"}}'; exit 0; fi
echo '{"ok":false,"checks":{"db":"ok","redis":"ok","jobs":"fail"}}'
exit 22`,
  sleep: `echo "$(( $(cat "$FAKE_DIR/clock") + $1 ))" > "$FAKE_DIR/clock"`,
};

let sandbox: Sandbox;
afterEach(async () => {
  await sandbox.cleanup();
});

async function setup({ env = true } = {}) {
  sandbox = await createSandbox(FAKES);
  await writeFile(path.join(sandbox.dir, "clock"), "1000\n");
  await writeFile(path.join(sandbox.dir, "head"), "aaaaaaa\n");
  if (env) {
    await writeFile(path.join(sandbox.dir, ".env"), "PUBLIC_ORIGIN=https://adxc.saop.cc\n");
  }
  return copyScript(sandbox, DEPLOY, "deploy.sh");
}

const deployedRevision = async () =>
  readFile(path.join(sandbox.dir, ".deploy-revision"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

const commands = async (prefixes: string[]) =>
  (await sandbox.calls()).filter((call) => prefixes.some((prefix) => call.startsWith(`${prefix} `)));

describe("deploy.sh", () => {
  test("在 pre 上：拉代码 → 检查 compose → 构建 → 迁移 → 重启 web 和 worker → 等到 /readyz 就绪", async () => {
    const script = await setup();

    const { code, output } = await sandbox.run(script, [], { FAKE_READY_AFTER: "3" });

    expect(code).toBe(0);
    expect(await commands(["git", "docker"])).toEqual([
      "git rev-parse HEAD",
      "git rev-parse --abbrev-ref HEAD",
      "git pull --ff-only",
      "git rev-parse HEAD",
      "docker compose config --quiet",
      "docker compose ps -q web",
      "docker compose build web backup seaweedfs",
      "docker compose run --rm migrate",
      "docker compose run --rm --no-deps storage-config",
      "docker compose up -d seaweedfs",
      "docker compose run --rm --no-deps backup bun ops/backup/preflight.ts",
      "docker compose up -d --no-deps web worker media-worker",
      "docker compose exec -T media-worker bun src/server/storage/health.ts media",
    ]);
    expect(await commands(["curl"])).toEqual(Array(3).fill("curl -fsS --max-time 5 http://127.0.0.1:12703/readyz"));
    expect(output).toContain("部署 bbbbbbb（部署前是 aaaaaaa）");
    expect(output).toContain('{"ok":true,"checks":{"db":"ok","redis":"ok","jobs":"ok"}}');
    expect(output).toContain("部署完成：bbbbbbb");
  });

  test("不在 pre 上：什么也不做", async () => {
    const script = await setup();

    const { code, output } = await sandbox.run(script, [], { FAKE_BRANCH: "main" });

    expect(code).toBe(1);
    expect(output).toContain("当前在 main，不是 pre");
    expect(await commands(["docker", "curl"])).toEqual([]);
    expect(await sandbox.calls()).not.toContain("git pull --ff-only");
  });

  test("迁移失败：不重启 web 和 worker，旧版本照常服务", async () => {
    const script = await setup();

    const { code, output } = await sandbox.run(script, [], { FAKE_MIGRATE_EXIT: "1" });

    expect(code).toBe(1);
    expect(output).toContain("迁移失败");
    expect(await commands(["docker"])).toEqual([
      "docker compose config --quiet",
      "docker compose ps -q web",
      "docker compose build web backup seaweedfs",
      "docker compose run --rm migrate",
    ]);
    expect(await commands(["curl"])).toEqual([]);
  });

  test("/readyz 到时间还没就绪：失败，打印最后一次的结果和回滚办法", async () => {
    const script = await setup();

    const { code, output } = await sandbox.run(script, [], { FAKE_READY_AFTER: "0", READY_TIMEOUT: "6" });

    expect(code).toBe(1);
    // 6 秒、每 2 秒一次：3 次，加上最后打印结果的那一次。
    expect(await commands(["curl"])).toHaveLength(4);
    expect(output).toContain('"jobs":"fail"');
    expect(output).toContain("回滚：git checkout --detach aaaaaaa && ./deploy.sh --no-pull");
    expect(output).toContain("修好以后回到 pre：git checkout pre && ./deploy.sh");
  });

  test("--no-pull（回滚用）：不看分支、不拉代码，按当前检出的提交部署", async () => {
    const script = await setup();

    const { code, output } = await sandbox.run(script, ["--no-pull"], { FAKE_BRANCH: "HEAD" });

    expect(code).toBe(0);
    expect(await commands(["git"])).toEqual(["git rev-parse HEAD", "git rev-parse HEAD"]);
    expect(output).toContain("部署 aaaaaaa（部署前是 aaaaaaa）");
  });

  test("没有 .env、参数不认识：什么也不做", async () => {
    const script = await setup({ env: false });
    const missing = await sandbox.run(script);
    expect(missing.code).toBe(1);
    expect(missing.output).toContain(".env 不存在");

    await writeFile(path.join(sandbox.dir, ".env"), "\n");
    const unknown = await sandbox.run(script, ["--force"]);
    expect(unknown.code).toBe(2);
    expect(unknown.output).toContain("用法：./deploy.sh [--no-pull]");

    expect(await sandbox.calls()).toEqual([]);
  });
});

// 这些测试跑真实的 deploy.sh；只替换会联网、启动容器或等待的外部命令。
describe("deploy.sh：失败重试和就绪期限", () => {
  test("迁移失败、就绪失败和再次失败都保留首次拉取前的回滚版本", async () => {
    const script = await setup();
    const migrated = await sandbox.run(script, [], { FAKE_MIGRATE_EXIT: "1" });
    expect(migrated.code).toBe(1);
    expect(await deployedRevision()).toBe("aaaaaaa\n");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = await sandbox.run(script, [], { FAKE_READY_AFTER: "0", READY_TIMEOUT: "2" });
      expect(retry.code).toBe(1);
      expect(retry.output).toContain("git checkout --detach aaaaaaa && ./deploy.sh --no-pull");
      expect(await deployedRevision()).toBe("aaaaaaa\n");
    }
  });

  test("就绪成功后才推进回滚版本，下一次部署失败会回到这个版本", async () => {
    const script = await setup();
    expect((await sandbox.run(script)).code).toBe(0);
    expect(await deployedRevision()).toBe("bbbbbbb\n");

    const next = await sandbox.run(script, [], {
      FAKE_PULL_HEAD: "ccccccc",
      FAKE_READY_AFTER: "0",
      READY_TIMEOUT: "2",
    });
    expect(next.code).toBe(1);
    expect(next.output).toContain("git checkout --detach bbbbbbb && ./deploy.sh --no-pull");
    expect(await deployedRevision()).toBe("bbbbbbb\n");
  });

  test("部署记录损坏时停止，不用当前 checkout 悄悄覆盖回滚版本", async () => {
    const script = await setup();
    await writeFile(path.join(sandbox.dir, ".deploy-revision"), "broken state\n");
    const result = await sandbox.run(script);
    expect(result.code).toBe(1);
    expect(await commands(["docker", "curl"])).toEqual([]);
    expect(await sandbox.calls()).not.toContain("git pull --ff-only");
    expect(await deployedRevision()).toBe("broken state\n");
  });

  test("回滚成功也会保存已恢复的版本，之后失败不能再指向被撤下的版本", async () => {
    const script = await setup();
    await writeFile(path.join(sandbox.dir, ".deploy-revision"), "bbbbbbb\n");
    expect((await sandbox.run(script, ["--no-pull"])).code).toBe(0);
    expect(await deployedRevision()).toBe("aaaaaaa\n");
  });

  test("慢探针按已用时间扣预算，十秒期限用尽后只发诊断请求", async () => {
    const script = await setup();
    const result = await sandbox.run(script, [], {
      FAKE_READY_AFTER: "0",
      FAKE_CURL_SECONDS: "4",
      READY_TIMEOUT: "10",
    });
    expect(result.code).toBe(1);
    expect((await readFile(path.join(sandbox.dir, "probes"), "utf8")).trim().split("\n")).toEqual([
      "-fsS 1000 5",
      "-fsS 1006 4",
      "-sS 1010 5",
    ]);
  });

  test("一秒也是有效期限：探针超时和休眠不能越过剩余预算", async () => {
    const script = await setup();
    const result = await sandbox.run(script, [], { FAKE_CURL_SECONDS: "4", READY_TIMEOUT: "1" });
    expect(result.code).toBe(1);
    expect((await readFile(path.join(sandbox.dir, "probes"), "utf8")).trim().split("\n")).toEqual([
      "-fsS 1000 1",
      "-sS 1001 5",
    ]);
  });

  test("探针立即失败时最后一次休眠只用剩余的一秒", async () => {
    const script = await setup();
    const result = await sandbox.run(script, [], { FAKE_READY_AFTER: "0", READY_TIMEOUT: "3" });
    expect(result.code).toBe(1);
    expect(await commands(["sleep"])).toEqual(["sleep 2", "sleep 1"]);
    expect((await readFile(path.join(sandbox.dir, "probes"), "utf8")).trim().split("\n")).toEqual([
      "-fsS 1000 3",
      "-fsS 1002 1",
      "-sS 1003 5",
    ]);
  });

  test("期限之后才可能成功的探针不会把部署标为成功", async () => {
    const script = await setup();
    const result = await sandbox.run(script, [], {
      FAKE_READY_AFTER: "3",
      FAKE_CURL_SECONDS: "4",
      READY_TIMEOUT: "10",
    });
    expect(result.code).toBe(1);
    expect(result.output).not.toContain("部署完成");
    expect(await deployedRevision()).toBe("aaaaaaa\n");
  });

  test.each(["0", "-1", "1.5", "nope", "", "999999999999999999999999"])(
    "无效的 READY_TIMEOUT=%j 在拉代码或启动容器之前被拒绝",
    async (timeout) => {
      const script = await setup();
      const result = await sandbox.run(script, [], { READY_TIMEOUT: timeout, FAKE_MIGRATE_EXIT: "1" });
      expect(result.code).toBe(2);
      expect(result.output).toContain("READY_TIMEOUT");
      expect(await commands(["git", "docker", "curl"])).toEqual([]);
    }
  );
});

test("unhealthy media process cannot complete deployment even if web ready; preserve Compose overlay",async()=>{
 const script=await setup();
 const result=await sandbox.run(script,[],{FAKE_MEDIA_HEALTH_EXIT:"1",READY_TIMEOUT:"1",COMPOSE_FILE:"compose.yaml:.superpowers/napcat-reuse.compose.yaml"});
 expect(result.code).toBe(1);
 expect(await deployedRevision()).toBe("aaaaaaa\n");
 expect((await commands(["docker"])).some(c=>c.includes("exec -T media-worker"))).toBe(true);
 expect((await commands(["docker"])).some(c=>c.includes("--remove-orphans")||c.includes(" down")||c.includes(" -f "))).toBe(false);
});

 test("failed retry cannot overwrite the preserved serving rollback image", async () => {
 const script=await setup();
 await sandbox.run(script, [], {FAKE_SERVING_IMAGE:"sha256:old",FAKE_READY_AFTER:"0",READY_TIMEOUT:"1"});
 expect(await sandbox.calls()).toContain("docker image tag sha256:old astrodx-community:rollback-aaaaaaa");
 await sandbox.run(script, [], {FAKE_SERVING_IMAGE:"sha256:failed-new",FAKE_ROLLBACK_INSPECT_EXIT:"0",FAKE_READY_AFTER:"0",READY_TIMEOUT:"1"});
 expect(await sandbox.calls()).not.toContain("docker image tag sha256:failed-new astrodx-community:rollback-aaaaaaa");
 });
