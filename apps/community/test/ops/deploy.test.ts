import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyScript, createSandbox, type Sandbox } from "./fake-commands";

const DEPLOY = fileURLToPath(new URL("../../deploy.sh", import.meta.url));

// 假的 git：pull 之前 HEAD 是 aaaaaaa，之后是 bbbbbbb；分支由 FAKE_BRANCH 决定。假的 docker：迁移的退出码由
// FAKE_MIGRATE_EXIT 决定。假的 curl：第 FAKE_READY_AFTER 次起 /readyz 才就绪（0 表示一直不就绪）。sleep 不真的等。
const FAKES = {
  git: `case "$*" in
  "rev-parse HEAD") if [ -f "$FAKE_DIR/pulled" ]; then echo bbbbbbb; else echo aaaaaaa; fi ;;
  "rev-parse --abbrev-ref HEAD") echo "\${FAKE_BRANCH:-pre}" ;;
  "pull --ff-only") touch "$FAKE_DIR/pulled" ;;
esac`,
  docker: `[ "$*" = "compose run --rm migrate" ] && exit "\${FAKE_MIGRATE_EXIT:-0}"
exit 0`,
  curl: `count=$(( $(cat "$FAKE_DIR/curl-count" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$FAKE_DIR/curl-count"
ready="\${FAKE_READY_AFTER:-1}"
if [ "$ready" -gt 0 ] && [ "$count" -ge "$ready" ]; then echo '{"ok":true,"checks":{"db":"ok","redis":"ok","jobs":"ok"}}'; exit 0; fi
echo '{"ok":false,"checks":{"db":"ok","redis":"ok","jobs":"fail"}}'
exit 22`,
  sleep: "",
};

let sandbox: Sandbox;
afterEach(async () => {
  await sandbox.cleanup();
});

async function setup({ env = true } = {}) {
  sandbox = await createSandbox(FAKES);
  if (env) {
    await writeFile(path.join(sandbox.dir, ".env"), "PUBLIC_ORIGIN=https://adxc.saop.cc\n");
  }
  return copyScript(sandbox, DEPLOY, "deploy.sh");
}

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
      "docker compose build web",
      "docker compose run --rm migrate",
      "docker compose up -d web worker",
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
      "docker compose build web",
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
