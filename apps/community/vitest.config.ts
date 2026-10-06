import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// 社区站的交互测试（页头、设置面板、语言切换、浏览器语言不一致提示、toast）在 vitest + happy-dom 里点、按键，
// 只认 test/dom 下的文件。其余测试（服务端渲染、纯函数、接口、对构建产物的 HTTP 测试）照旧用 bun test：
// `bun test src`、`bun test test/http` 都扫不到 test/dom，这里也不碰它们。
// 不在 vite.config.ts 里加 test 字段：那里的 reactRouter()、react-router-hono-server、Paraglide 插件不该在测试里跑。
// 文案由 bun run i18n 先编译进 src/paraglide（check 和 test:dom 脚本都先跑它）。
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom", "react-router"],
  },
  test: {
    environment: "happy-dom",
    // 页面地址决定语言（Paraglide 的 url 策略）：默认是中文首页，用例可以用 history.replaceState 换。
    environmentOptions: { happyDOM: { url: "https://community.test/" } },
    include: ["test/dom/**/*.test.tsx"],
    setupFiles: ["./test/dom/setup.ts"],
  },
});
