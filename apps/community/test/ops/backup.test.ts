import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyScript, createSandbox, type Sandbox } from "./fake-commands";

const BACKUP = fileURLToPath(new URL("../../ops/backup/backup.sh", import.meta.url));
const SYSTEMD = fileURLToPath(new URL("../../ops/systemd/", import.meta.url));

// 假 restic 只检查仓库；timeout 转发协调器命令，假 bun 的退出码由环境变量决定。
// 实际双库导出和 restic 恢复由 opt-in 新卷用例验证。
const FAKES = {
  restic: `case "$1" in
  cat) exit "\${FAKE_RESTIC_CAT_EXIT:-0}" ;;
  esac`,
  timeout: 'shift 3; exec "$@"',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: The fixture shell expands this literal variable when executed.
  bun: 'exit "${FAKE_EXPORT_EXIT:-0}"',
};

let sandbox: Sandbox;
afterEach(async () => {
  await sandbox.cleanup();
});

async function runBackup(env: Record<string, string> = {}) {
  sandbox = await createSandbox(FAKES);
  const script = await copyScript(sandbox, BACKUP, "backup.sh");
  const dumps = path.join(sandbox.dir, "dumps");
  const result = await sandbox.run(script, [], {
    DUMP_DIR: dumps,
    RESTIC_REPOSITORY: "/restic",
    RESTIC_PASSWORD: "restic-password",
    ...env,
  });
  const calls = (await sandbox.calls()).map((call) => call.replaceAll(dumps, "<dumps>"));
  return { ...result, calls };
}

describe("ops/backup/backup.sh", () => {
  test("existing job delegates to bounded full coordinator without DB-only prune", async () => {
    const { code, calls, output } = await runBackup();
    expect(code).toBe(0);
    expect(calls).toEqual([
      "restic cat config",
      "timeout --signal=TERM --kill-after=5s 1795s bun ./ops/backup/export.ts",
      "bun ./ops/backup/export.ts",
    ]);
    expect(output).not.toContain("restic-password");
  });

  test("没有 RESTIC_PASSWORD：什么也不做", async () => {
    const { code, calls, output } = await runBackup({ RESTIC_PASSWORD: "" });

    expect(code).toBe(1);
    expect(output).toContain("RESTIC_PASSWORD 未设置");
    expect(calls).toEqual([]);
  });

  // 没有 restic init 过、密码不对、目录设错：不导出，也不悄悄建一个新仓库。
  test("仓库打不开：不导出", async () => {
    const { code, calls, output } = await runBackup({ FAKE_RESTIC_CAT_EXIT: "1" });

    expect(code).toBe(1);
    expect(output).toContain("打不开 restic 仓库 /restic");
    expect(calls).toEqual(["restic cat config"]);
  });

  test("coordinator failure produces no shell snapshot/prune/completion", async () => {
    const { code, calls } = await runBackup({ FAKE_EXPORT_EXIT: "1" });
    expect(code).not.toBe(0);
    expect(calls.some((call) => call.startsWith("restic backup") || call.startsWith("restic forget"))).toBe(false);
  });

});

describe("ops/systemd", () => {
  const unit = (name: string) => Bun.file(`${SYSTEMD}${name}`).text();

  test("定时器每天东八区 03:30 触发，关机错过的开机后补一次", async () => {
    const timer = await unit("astrodx-community-backup.timer");
    expect(timer).toContain("OnCalendar=*-*-* 03:30:00 Asia/Shanghai");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("WantedBy=timers.target");
  });

  // 路径在装的时候换成 g510 上的实际目录（README 的"备份"）：compose 从工作目录找 compose.yaml 和 .env。
  test("服务在 apps/community 下跑一次性的 backup 容器", async () => {
    const service = await unit("astrodx-community-backup.service");
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("WorkingDirectory=@COMMUNITY_DIR@");
    expect(service).toContain("ExecStart=/usr/bin/docker compose run --rm -T backup");
    expect(service).toContain("After=docker.service");
  });
});
