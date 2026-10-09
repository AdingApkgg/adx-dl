import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onebotConfig, writeOnebotConfig } from "./onebot-config";

const TOKEN = "napcat-token-napcat-token-0123456789";
const SCRIPT = fileURLToPath(new URL("./write-onebot-config.ts", import.meta.url));

let dir: string | undefined;
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function freshDir(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "onebot-config-"));
  return dir;
}

describe("onebotConfig", () => {
  // 1b 留下的三条：监听 0.0.0.0（NapCat 默认只听 127.0.0.1，别的容器连不上）、两处 token 都是 NAPCAT_ACCESS_TOKEN、
  // 心跳不能是 0（worker 75 秒收不到任何消息就断开重连，见 src/worker/napcat-events.ts）。
  test("HTTP（3000）和正向 WebSocket（3001）都听 0.0.0.0，都要令牌，30 秒一次心跳；别的都不开", () => {
    const config = onebotConfig(TOKEN);

    expect(config.network.httpServers).toEqual([
      {
        name: "community-http",
        enable: true,
        host: "0.0.0.0",
        port: 3000,
        enableCors: false,
        enableWebsocket: false,
        messagePostFormat: "array",
        token: TOKEN,
        debug: false,
      },
    ]);
    expect(config.network.websocketServers).toEqual([
      {
        name: "community-ws",
        enable: true,
        host: "0.0.0.0",
        port: 3001,
        messagePostFormat: "array",
        reportSelfMessage: false,
        enableForcePushEvent: true,
        token: TOKEN,
        debug: false,
        heartInterval: 30000,
      },
    ]);
    expect(config.network.httpSseServers).toEqual([]);
    expect(config.network.httpClients).toEqual([]);
    expect(config.network.websocketClients).toEqual([]);
    expect(config.network.plugins).toEqual([]);
  });
});

describe("writeOnebotConfig", () => {
  // NapCat 读 onebot11_<QQ 号>.json，没有它才拿 onebot11.json 当模板复制一份（NapCatQQ 的 config-base.ts）。
  // 只写模板的话，第一次登录以后就再也改不动了，所以两份都写，每次启动都覆盖（WebUI 里改的会被盖掉）。
  test("写 onebot11.json 和 onebot11_<机器人 QQ>.json，内容一样，只有所有者能读写；已有的文件被覆盖", async () => {
    const target = await freshDir();
    await writeFile(path.join(target, "onebot11_10001.json"), "{}");

    await writeOnebotConfig(target, { accessToken: TOKEN, botQq: "10001" });

    expect((await readdir(target)).sort()).toEqual(["onebot11.json", "onebot11_10001.json"]);
    for (const name of ["onebot11.json", "onebot11_10001.json"]) {
      expect(await Bun.file(path.join(target, name)).json()).toEqual(onebotConfig(TOKEN));
      expect((await stat(path.join(target, name))).mode & 0o777).toBe(0o600);
    }
  });
});

// compose 里的 napcat-config 服务：用社区站的镜像跑这个脚本，把配置写进 NapCat 的配置卷，然后 NapCat 才启动。
describe("write-onebot-config.ts", () => {
  test("从环境变量读令牌和机器人 QQ，写进给定的目录；输出里没有令牌", async () => {
    const target = await freshDir();
    const proc = Bun.spawn(["bun", SCRIPT, target], {
      env: { PATH: process.env.PATH ?? "", NAPCAT_ACCESS_TOKEN: TOKEN, NAPCAT_BOT_QQ: "10001" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ level: "info", event: "napcat_config_written", botQq: "10001" });
    expect(`${out}${err}`).not.toContain(TOKEN);
    expect((await readdir(target)).sort()).toEqual(["onebot11.json", "onebot11_10001.json"]);
  });

  test("令牌太短、QQ 号不对、没给目录：退出码 1，什么也不写", async () => {
    const target = await freshDir();
    for (const [env, args, message] of [
      [{ NAPCAT_ACCESS_TOKEN: "short", NAPCAT_BOT_QQ: "10001" }, [target], "NAPCAT_ACCESS_TOKEN"],
      [{ NAPCAT_ACCESS_TOKEN: TOKEN, NAPCAT_BOT_QQ: "0123" }, [target], "NAPCAT_BOT_QQ"],
      [{ NAPCAT_ACCESS_TOKEN: TOKEN, NAPCAT_BOT_QQ: "10001" }, [], "usage"],
    ] as const) {
      const proc = Bun.spawn(["bun", SCRIPT, ...args], {
        env: { PATH: process.env.PATH ?? "", ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      expect(code, message).toBe(1);
      expect(err).toContain(message);
    }
    expect(await readdir(target)).toEqual([]);
  });
});
