import { fileURLToPath } from "node:url";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { reactRouter } from "@react-router/dev/vite";
import { reactRouterHonoServer } from "react-router-hono-server/dev";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // 选项必须和 package.json 里 i18n 脚本的参数一致：两边编译进同一个目录，
    // 哪一边少了 emitTsDeclarations，编译时就会把 .d.ts 删掉。
    // 地址只认 url（认不出就是基础语言 zh），不看 Cookie 和浏览器语言（spec 第 11.1 节）。
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["url", "baseLocale"],
      // 插件默认在开发时按语言分文件、构建时按文案分文件；固定成一种，免得开发服务器
      // 和 i18n 脚本来回改写同一个目录。
      outputStructure: "message-modules",
      emitTsDeclarations: true,
    }),
    // 必须排在 reactRouter() 前面。服务端入口不用默认的 src/client/server.ts，
    // 放在 src/server 里，路径不要加 "./" 前缀（插件按子串匹配它）。
    reactRouterHonoServer({ runtime: "bun", serverEntryPoint: "src/server/index.ts" }),
    reactRouter(),
  ],
  resolve: {
    // Vite 默认不读 tsconfig 的 paths（Bun 跑测试、worker 时会读）。dash 没配也没事，
    // 是因为它的前端只用 import type 引用 @/，编译时就被擦掉了；这里前后端都有真正的导入。
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // bun 的隔离安装里 react-router@8.4.0 有两份（按 peer 依赖区分）。开发时
    // react-router-hono-server 如果解析到另一份，React Router 用 instanceof 检查请求
    // 上下文就会失败（报 Invalid `context` value）。强制都从本应用解析，只留一份。
    dedupe: ["react", "react-dom", "react-router"],
  },
  server: { port: 5373 },
});
