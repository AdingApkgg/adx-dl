import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// apps/community/，末尾带斜杠。
const appRoot = fileURLToPath(new URL("../..", import.meta.url));

// 包名：@scope/name/sub → @scope/name，name/sub → name。
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

// 生产镜像只装 dependencies（Dockerfile 里的 bun install --production）。服务端产物在运行时 import 的包要是不在里面，
// 镜像一启动就报找不到包；开发环境和 CI 里却看不出来：全量安装时 bun 会从 node_modules/.bun/node_modules 兜底。
describe("服务端构建产物", () => {
  test("只 import 生产依赖和运行时自带的模块（bun、node:*）", async () => {
    const { dependencies } = await Bun.file(`${appRoot}package.json`).json();
    const runtime = new Set(Object.keys(dependencies));
    const outside = new Set<string>();
    let files = 0;
    for await (const file of new Bun.Glob("build/server/**/*.js").scan({ cwd: appRoot })) {
      files += 1;
      const code = await Bun.file(`${appRoot}${file}`).text();
      // 打包结果里每条 import、export … from 都单独占一行，写在模块顶层；注释里的示例代码不在行首。
      for (const [, from, bare] of code.matchAll(/^(?:import|export)\b[^\n]*?\bfrom\s*"([^"]+)";?$|^import\s*"([^"]+)";?$/gm)) {
        const specifier = from ?? bare ?? "";
        if (specifier.startsWith(".") || specifier === "bun" || specifier.startsWith("node:")) {
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
