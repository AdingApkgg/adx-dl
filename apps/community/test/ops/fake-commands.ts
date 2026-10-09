import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 测部署、备份这类 shell 脚本：把脚本拷进临时目录，PATH 最前面放一组假命令（git、docker、curl、sleep、pg_dump、
// restic……）。假命令把自己收到的参数记进同一个日志，行为由环境变量控制，测试只看脚本按什么顺序调了什么。
export type Sandbox = {
  dir: string;
  bin: string;
  /** 假命令记下的调用，一行一条："<命令> <参数…>"。 */
  calls(): Promise<string[]>;
  run(script: string, args?: string[], env?: Record<string, string>): Promise<{ code: number; output: string }>;
  cleanup(): Promise<void>;
};

export async function createSandbox(fakes: Record<string, string>): Promise<Sandbox> {
  const dir = await mkdtemp(path.join(tmpdir(), "ops-sandbox-"));
  const bin = path.join(dir, "bin");
  const log = path.join(dir, "calls.log");
  await mkdir(bin);
  await writeFile(log, "");
  for (const [name, body] of Object.entries(fakes)) {
    const file = path.join(bin, name);
    await writeFile(file, `#!/bin/sh\necho "${name} $*" >> "$FAKE_LOG"\n${body}\n`);
    await chmod(file, 0o755);
  }
  return {
    dir,
    bin,
    async calls() {
      return (await readFile(log, "utf8")).split("\n").filter(Boolean);
    },
    async run(script, args = [], env = {}) {
      const proc = Bun.spawn(["bash", script, ...args], {
        cwd: dir,
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, FAKE_LOG: log, FAKE_DIR: dir, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { code, output: `${out}${err}` };
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** 把仓库里的脚本拷进沙箱（脚本会 cd 到自己所在的目录，所以要在沙箱里跑）。 */
export async function copyScript(sandbox: Sandbox, source: string, name: string): Promise<string> {
  const target = path.join(sandbox.dir, name);
  await copyFile(source, target);
  return target;
}
