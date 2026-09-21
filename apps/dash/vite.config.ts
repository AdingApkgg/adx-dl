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
});
