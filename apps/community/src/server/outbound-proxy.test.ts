import { afterAll, describe, expect, test } from "bun:test";

// 线上的 web 容器靠 Bun 的 fetch 自己读 HTTPS_PROXY / NO_PROXY（compose.yaml）：
// - 访问 Google（https）走 g510 上的代理；
// - Turnstile 的 siteverify 写在 NO_PROXY 里，直连，不受代理死活影响；
// - 容器网络里的 http://umami:3000、http://napcat:3000 不受 HTTPS_PROXY 影响；万一 Docker 往容器里塞了 HTTP_PROXY
//   （客户端的 ~/.docker/config.json 配了 proxies 时会这样），它们也在 NO_PROXY 里。
// 代码里没有一行和代理有关，全靠这几条运行时的行为。这里在子进程里照 compose 的方式设好环境变量，看请求到底交给了谁，
// 升级 Bun 后行为变了这条会失败。不连外网：代理是本机的假代理，CONNECT 一律回 502；直连的目标用 .invalid 域名，
// 解析不到就失败。

const proxyLog: string[] = [];
const proxy = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, data) {
      proxyLog.push(new TextDecoder().decode(data).split("\r\n")[0] ?? "");
      socket.write("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
      socket.end();
    },
  },
});

afterAll(() => {
  proxy.stop(true);
});

// 子进程里依次请求这几个地址，每个最多等 3 秒，只关心请求有没有交给代理。
const PROBE = `
for (const url of process.argv.slice(1)) {
  await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null);
}
`;

async function probe(env: Record<string, string>, urls: string[]): Promise<string[]> {
  proxyLog.length = 0;
  const child = Bun.spawn(["bun", "-e", PROBE, ...urls], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(await child.exited).toBe(0);
  return [...proxyLog];
}

describe("Bun 的 fetch 和 HTTPS_PROXY / NO_PROXY（compose.yaml 里 web 的设置）", () => {
  // NO_PROXY 的写法和 compose 一样，只是把主机换成解析不到的 .invalid。
  const NO_PROXY = "siteverify.invalid,umami.invalid,napcat.invalid";

  test("https 的 Google 走代理；NO_PROXY 里的主机和 http 的内部服务不走", async () => {
    const seen = await probe({ HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, NO_PROXY }, [
      "https://oauth2.googleapis.com/token",
      "https://siteverify.invalid/turnstile",
      "http://umami.invalid:3000/script.js",
    ]);

    expect(seen).toEqual(["CONNECT oauth2.googleapis.com:443 HTTP/1.1"]);
  }, 20_000);

  test("容器里多出 HTTP_PROXY 时：NO_PROXY 里的内部服务照样直连，别的 http 地址才走代理", async () => {
    const seen = await probe({ HTTP_PROXY: `http://127.0.0.1:${proxy.port}`, NO_PROXY }, [
      "http://umami.invalid:3000/api/send",
      "http://napcat.invalid:3000/get_status",
      "http://elsewhere.invalid/",
    ]);

    expect(seen).toEqual(["GET http://elsewhere.invalid/ HTTP/1.1"]);
  }, 20_000);

  // compose 里写的是 HTTPS_PROXY: ${OUTBOUND_HTTPS_PROXY:-}：.env 里没设时，容器里是一个空字符串。
  test("HTTPS_PROXY 是空字符串：不用代理", async () => {
    expect(await probe({ HTTPS_PROXY: "" }, ["https://google.invalid/token"])).toEqual([]);
  }, 20_000);
});
