// 前端的 QQ 客户端插件需要这个类型。和 api/app-type.ts 一样只导出类型，编译后是空文件；
// Biome 只放行这两个服务端模块被 src/client、src/shared 引用，而且只能 import type。
import type { qqLogin } from "./qq/plugin";

export type QqLoginPlugin = ReturnType<typeof qqLogin>;
