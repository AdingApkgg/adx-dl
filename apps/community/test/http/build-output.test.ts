import { describe, expect, test } from "bun:test";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

// apps/community/，末尾带斜杠。
const appRoot = fileURLToPath(new URL("../..", import.meta.url));

// 包名：@scope/name/sub → @scope/name，name/sub → name。
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

// 打包结果里每条 import、export … from 都单独占一行，写在模块顶层；注释里的示例代码不在行首。
const STATIC_IMPORT = /^(?:import|export)\b[^\n]*?\bfrom\s*"([^"]+)";?$|^import\s*"([^"]+)";?$/gm;
// 动态 import 可以出现在任何位置（react-router-hono-server 就在函数里 import("hono/bun")）。
const DYNAMIC_IMPORT = /\bimport\(\s*"([^"]+)"\s*\)/g;

// 生产镜像只装 dependencies（Dockerfile 里的 bun install --production）。服务端产物在运行时 import 的包要是不在里面，
// 镜像一启动就报找不到包；开发环境和 CI 里却看不出来：全量安装时 bun 会从 node_modules/.bun/node_modules 兜底。
// 运行时自带的模块不算：node:*、不带前缀的 async_hooks、bun，以及 Bun 内置的 ws（isBuiltin 都认）。
describe("服务端构建产物", () => {
  test("只 import 生产依赖和运行时自带的模块（静态的和动态的 import 都算）", async () => {
    const { dependencies } = await Bun.file(`${appRoot}package.json`).json();
    const runtime = new Set(Object.keys(dependencies));
    const outside = new Set<string>();
    let files = 0;
    for await (const file of new Bun.Glob("build/server/**/*.js").scan({ cwd: appRoot })) {
      files += 1;
      const code = await Bun.file(`${appRoot}${file}`).text();
      const specifiers = [
        ...[...code.matchAll(STATIC_IMPORT)].map(([, from, bare]) => from ?? bare ?? ""),
        ...[...code.matchAll(DYNAMIC_IMPORT)].map(([, specifier]) => specifier ?? ""),
      ];
      for (const specifier of specifiers) {
        if (specifier.startsWith(".") || isBuiltin(specifier)) {
          continue;
        }
        if (!runtime.has(packageName(specifier))) {
          outside.add(`${file}: ${specifier}`);
        }
      }
    }

    // 要先 bun run build（CI 里 test:http 排在构建之后）。
    expect(files).toBeGreaterThan(0);
    expect([...outside].sort()).toEqual([]);
  });
});
