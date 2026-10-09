import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../ops/fill-secrets.sh", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../../.env.example", import.meta.url));
const SECRETS = [
  "BETTER_AUTH_SECRET",
  "QQ_CODE_HMAC_KEY",
  "NAPCAT_ACCESS_TOKEN",
  "NAPCAT_WEBUI_TOKEN",
  "POSTGRES_PASSWORD",
  "UMAMI_DB_PASSWORD",
  "UMAMI_APP_SECRET",
];

let dir: string | undefined;
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function envFile(content: string): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "fill-secrets-"));
  const file = path.join(dir, ".env");
  await writeFile(file, content, { mode: 0o644 });
  return file;
}

async function fill(file: string) {
  const proc = Bun.spawn(["bash", SCRIPT, file], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, output: `${out}${err}` };
}

function valuesIn(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1]) {
      values.set(match[1], match[2] ?? "");
    }
  }
  return values;
}

describe("ops/fill-secrets.sh", () => {
  test("从 .env.example 复制来的 .env：七个密钥都填上各不相同的 64 位十六进制，别的行一字不动；只打印变量名", async () => {
    const example = await readFile(EXAMPLE, "utf8");
    const file = await envFile(example);

    const { code, output } = await fill(file);

    expect(code).toBe(0);
    const after = await readFile(file, "utf8");
    const values = valuesIn(after);
    const secrets = SECRETS.map((key) => values.get(key) ?? "");
    for (const value of secrets) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(secrets).size).toBe(SECRETS.length);
    // 除了这七行，文件和原来一模一样（注释、顺序、别的变量）。
    const untouched = (content: string) =>
      content.split("\n").filter((line) => !SECRETS.some((key) => line.startsWith(`${key}=`)));
    expect(untouched(after)).toEqual(untouched(example));
    for (const key of SECRETS) {
      expect(output).toContain(`${key}: 已生成`);
    }
    for (const value of secrets) {
      expect(output).not.toContain(value);
    }
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  // 已经上线的密钥换了会出事：BETTER_AUTH_SECRET 换了所有人要重新登录，数据库密码只在第一次启动时写进库里。
  test("再跑一遍什么也不改；已有的值不动，没有的行补在最后（最后一行没换行也不会粘上），引号里的空值当作没填", async () => {
    const file = await envFile('BETTER_AUTH_SECRET=keep-me\nPOSTGRES_PASSWORD=""\nPUBLIC_ORIGIN=https://adxc.saop.cc');

    expect((await fill(file)).code).toBe(0);
    const first = await readFile(file, "utf8");
    const values = valuesIn(first);
    expect(values.get("BETTER_AUTH_SECRET")).toBe("keep-me");
    expect(values.get("POSTGRES_PASSWORD")).toMatch(/^[0-9a-f]{64}$/);
    expect(values.get("PUBLIC_ORIGIN")).toBe("https://adxc.saop.cc");
    expect(first.split("\n").slice(0, 3)).toEqual([
      "BETTER_AUTH_SECRET=keep-me",
      `POSTGRES_PASSWORD=${values.get("POSTGRES_PASSWORD")}`,
      "PUBLIC_ORIGIN=https://adxc.saop.cc",
    ]);
    expect([...values.keys()].slice(3)).toEqual(SECRETS.filter((key) => !["BETTER_AUTH_SECRET", "POSTGRES_PASSWORD"].includes(key)));

    const again = await fill(file);
    expect(again.code).toBe(0);
    expect(await readFile(file, "utf8")).toBe(first);
    for (const key of SECRETS) {
      expect(again.output).toContain(`${key}: 已有，不动`);
    }
  });

  test(".env 不存在：退出码 1，不新建文件", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fill-secrets-"));
    const file = path.join(dir, ".env");

    const { code, output } = await fill(file);

    expect(code).toBe(1);
    expect(output).toContain("cp .env.example .env");
    expect(await Bun.file(file).exists()).toBe(false);
  });
});
