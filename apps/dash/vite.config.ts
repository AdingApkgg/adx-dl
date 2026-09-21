import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  server: {
    port: 5273,
    // 开发时前端跑在 Vite，后端跑在 3000。生产是同一个进程，不存在这个代理。
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  preview: {
    // SPA 预渲染阶段，React Router 会起一个 Vite preview 服务，再用它自己
    // 上报的 resolvedUrls 去请求 /。不显式指定 host 时，preview 服务在部署
    // 容器里绑到了 ::1（纯 IPv6），却仍然把地址上报成 http://localhost:PORT/；
    // React Router 拿这个 URL 发请求，localhost 被解析成 127.0.0.1，连的是
    // 个根本没人监听的地址——构建失败在一句毫无上下文的 ECONNREFUSED 上
    // （React Router 把这个 preview 服务的 logLevel 设成了 silent，Vite 自己
    // 其实知道发生了什么，但这句解释从没被打印出来）。显式绑 IPv4 让上报地址
    // 和实际监听地址对得上。
    //
    // 别因为“看着像默认值”就删掉这行：开发机（Mac）上不会绑成 IPv6-only，
    // 这里删掉也照样构建成功，所以本地验证发现不了问题；故障只会在下次部署
    // 时，在生产容器里以这句没头没脑的 ECONNREFUSED 冒出来，而且 Vite 那边
    // 的解释已经被 silent 吞掉了，日志里没有任何线索可查。
    host: "127.0.0.1",
  },
});
