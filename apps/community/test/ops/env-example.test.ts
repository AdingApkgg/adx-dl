import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => Bun.file(`${appRoot}${file}`).text();

// .env.example 是唯一的变量清单（spec 第 12.3 节）：应用读的、compose.yaml 引用的，都要在里面（注释掉的也算）。
// 漏了的话，g510 上照着它填 .env 就会少一项，要到容器起不来才发现。
async function documented(): Promise<Set<string>> {
  const example = await read(".env.example");
  return new Set([...example.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name ?? ""));
}

describe(".env.example", () => {
  test("列出了 src/server/env.ts 读的每一个变量", async () => {
    const names = [...(await read("src/server/env.ts")).matchAll(/read\("([A-Z0-9_]+)"\)/g)].map(([, name]) => name ?? "");
    const listed = await documented();

    expect(names.length).toBeGreaterThan(10);
    // NODE_ENV 由运行环境决定（生产镜像里写死），不放进 .env。
    expect([...new Set(names)].filter((name) => name !== "NODE_ENV" && !listed.has(name))).toEqual([]);
  });

  test("列出了 compose.yaml 插值用到的每一个变量", async () => {
    const names = [...(await read("compose.yaml")).matchAll(/\$\{([A-Z0-9_]+)/g)].map(([, name]) => name ?? "");
    const listed = await documented();

    expect(names.length).toBeGreaterThan(10);
    expect([...new Set(names)].filter((name) => !listed.has(name))).toEqual([]);
  });
});
