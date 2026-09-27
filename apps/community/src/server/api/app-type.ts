// 前端和 src/shared 唯一允许引用的服务端模块。它只导出类型，编译后是空文件，
// 不会把服务端代码带进浏览器的包里。只能用 import type 引用。
import type { apiRoutes } from "./v1";

export type AppType = typeof apiRoutes;
