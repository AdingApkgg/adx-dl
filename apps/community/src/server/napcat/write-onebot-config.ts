// compose.yaml 里 napcat-config 服务的命令：NapCat 启动前，用社区站的镜像把 OneBot 配置写进 NapCat 的配置卷。
// 令牌和机器人 QQ 都从 .env 来（NAPCAT_ACCESS_TOKEN、NAPCAT_BOT_QQ），仓库里不放任何密钥。
// 用法：bun src/server/napcat/write-onebot-config.ts <NapCat 的配置目录>
import { writeOnebotConfig } from "./onebot-config";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [dir] = process.argv.slice(2);
if (!dir) {
  fail("usage: bun src/server/napcat/write-onebot-config.ts <napcat config dir>");
}
const accessToken = process.env.NAPCAT_ACCESS_TOKEN?.trim() ?? "";
const botQq = process.env.NAPCAT_BOT_QQ?.trim() ?? "";
// 和 src/server/env.ts 的规则一样：令牌留空等于关掉 NapCat 的鉴权。
if (accessToken.length < 32) {
  fail("NAPCAT_ACCESS_TOKEN 至少要 32 个字符（ops/fill-secrets.sh 会生成）");
}
if (!/^[1-9]\d{4,10}$/.test(botQq)) {
  fail("NAPCAT_BOT_QQ 必须是 5 到 11 位数字，不以 0 开头");
}

const files = await writeOnebotConfig(dir, { accessToken, botQq });
console.log(
  JSON.stringify({ time: new Date().toISOString(), level: "info", event: "napcat_config_written", botQq, files: files.join(",") })
);
