import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

// NapCat（mlikiowa/napcat-docker）的 OneBot 11 配置。字段照 NapCatQQ 的 packages/napcat-onebot/config/config.ts，
// 没写的项由 NapCat 补默认值。只开两个服务端，都只在 compose 的内部网络里：
// - HTTP（3000）：网页进程和 worker 调 send_private_msg、get_status 这些接口（NAPCAT_HTTP_URL）；
// - 正向 WebSocket（3001）：worker 收加好友申请（NAPCAT_WS_URL）。
// 两处都要监听 0.0.0.0（NapCat 默认只听 127.0.0.1，别的容器连不上），令牌都是 NAPCAT_ACCESS_TOKEN，
// 心跳 30 秒一次（不能是 0：worker 75 秒收不到任何消息就断开重连，见 src/worker/napcat-events.ts）。
export function onebotConfig(accessToken: string) {
  return {
    network: {
      httpServers: [
        {
          name: "community-http",
          enable: true,
          host: "0.0.0.0",
          port: 3000,
          enableCors: false,
          enableWebsocket: false,
          messagePostFormat: "array",
          token: accessToken,
          debug: false,
        },
      ],
      httpSseServers: [],
      httpClients: [],
      websocketServers: [
        {
          name: "community-ws",
          enable: true,
          host: "0.0.0.0",
          port: 3001,
          messagePostFormat: "array",
          reportSelfMessage: false,
          enableForcePushEvent: true,
          token: accessToken,
          debug: false,
          heartInterval: 30000,
        },
      ],
      websocketClients: [],
      plugins: [],
    },
    musicSignUrl: "",
    enableLocalFile2Url: false,
    parseMultMsg: false,
  };
}

// NapCat 读 onebot11_<QQ 号>.json；没有这个文件时，才拿 onebot11.json 当模板复制一份（NapCatQQ 的
// packages/napcat-core/helper/config-base.ts）。只写模板的话，机器人第一次登录以后就再也改不动了，所以两份都写。
// 文件里有访问令牌，只给所有者读写（NapCat 的入口脚本启动时会把整个 /app 交给它自己的用户）。
export async function writeOnebotConfig(dir: string, options: { accessToken: string; botQq: string }): Promise<string[]> {
  const content = `${JSON.stringify(onebotConfig(options.accessToken), null, 2)}\n`;
  const names = ["onebot11.json", `onebot11_${options.botQq}.json`];
  for (const name of names) {
    const file = path.join(dir, name);
    await writeFile(file, content, { mode: 0o600 });
    // 文件已经存在时 writeFile 不改权限。
    await chmod(file, 0o600);
  }
  return names;
}
