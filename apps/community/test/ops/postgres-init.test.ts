import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// postgres 镜像第一次启动（数据目录还是空的）时执行 /docker-entrypoint-initdb.d 下的脚本。这里不起数据库，
// 用一个假的 psql 记下参数和标准输入，只看脚本怎么调它。
const SCRIPT = fileURLToPath(new URL("../../ops/postgres-init/10-umami.sh", import.meta.url));
const PASSWORD = "umami-db-password-0123456789abcdef";

let dir: string | undefined;
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function run(env: Record<string, string>) {
  dir = await mkdtemp(path.join(tmpdir(), "pg-init-"));
  const psql = path.join(dir, "psql");
  await writeFile(psql, `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\ncat > "${dir}/stdin"\n`);
  await chmod(psql, 0o755);
  const proc = Bun.spawn(["sh", SCRIPT], {
    env: { PATH: `${dir}:/usr/bin:/bin`, POSTGRES_USER: "community", POSTGRES_DB: "community", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const read = (name: string) => readFile(path.join(dir as string, name), "utf8").catch(() => null);
  return { code, output: `${out}${err}`, args: await read("args"), stdin: await read("stdin") };
}

describe("ops/postgres-init/10-umami.sh", () => {
  test("用超级用户连 community 库，建 umami 角色和库；密码经 \\getenv 从环境变量取，不出现在命令行和输出里", async () => {
    const { code, output, args, stdin } = await run({ UMAMI_DB_PASSWORD: PASSWORD });

    expect(code).toBe(0);
    expect(args?.split("\n")).toEqual(["-v", "ON_ERROR_STOP=1", "--username", "community", "--dbname", "community", ""]);
    expect(stdin).toBe(
      [
        "\\getenv umami_password UMAMI_DB_PASSWORD",
        "CREATE ROLE umami LOGIN PASSWORD :'umami_password';",
        "CREATE DATABASE umami OWNER umami;",
        "",
      ].join("\n")
    );
    expect(`${output}${args}${stdin}`).not.toContain(PASSWORD);
  });

  test("没有 UMAMI_DB_PASSWORD：失败，不调 psql", async () => {
    const { code, output, args } = await run({});

    expect(code).not.toBe(0);
    expect(output).toContain("UMAMI_DB_PASSWORD");
    expect(args).toBeNull();
  });
});
