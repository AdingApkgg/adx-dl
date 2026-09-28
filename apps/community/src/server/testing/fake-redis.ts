import type { Socket } from "bun";

export type FakeRedis = {
  port: number;
  url: string;
  /** 断开所有连接并停止监听，模拟 Redis 宕机。 */
  stop(): void;
};

type Conn = Socket<{ buffer: string }>;

// 只会回 PING 的假 Redis，用来测断线和重连，不必真的停掉 Redis。
// Bun 的客户端连上后先发 HELLO 3，要回一个 RESP3 的 map；其余命令一律回 +OK。
export function startFakeRedis(port = 0): FakeRedis {
  const sockets = new Set<Conn>();
  const listener = Bun.listen<{ buffer: string }>({
    hostname: "127.0.0.1",
    port,
    socket: {
      open(socket) {
        socket.data = { buffer: "" };
        sockets.add(socket);
      },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        const { commands, rest } = parseCommands(socket.data.buffer);
        socket.data.buffer = rest;
        for (const command of commands) {
          socket.write(reply(command));
        }
      },
      close(socket) {
        sockets.delete(socket);
      },
    },
  });
  return {
    port: listener.port,
    url: `redis://127.0.0.1:${listener.port}`,
    stop() {
      for (const socket of sockets) {
        socket.end();
      }
      listener.stop(true);
    },
  };
}

/** 一个此刻没有程序监听的本机端口。 */
export function unusedPort(): number {
  const probe = startFakeRedis();
  probe.stop();
  return probe.port;
}

function reply(command: string[]): string {
  switch (command[0]?.toUpperCase()) {
    case "HELLO":
      return "%1\r\n+proto\r\n:3\r\n";
    case "PING":
      return "+PONG\r\n";
    default:
      return "+OK\r\n";
  }
}

// 命令是 RESP 数组：*<个数>\r\n 后面跟 $<长度>\r\n<内容>\r\n。不完整的留到下一段数据。
function parseCommands(buffer: string): { commands: string[][]; rest: string } {
  const commands: string[][] = [];
  let pos = 0;
  while (buffer.startsWith("*", pos)) {
    const header = buffer.indexOf("\r\n", pos);
    if (header < 0) {
      break;
    }
    const count = Number(buffer.slice(pos + 1, header));
    let cursor = header + 2;
    const args: string[] = [];
    for (let i = 0; i < count; i++) {
      const lengthEnd = buffer.indexOf("\r\n", cursor);
      if (lengthEnd < 0) {
        break;
      }
      const start = lengthEnd + 2;
      const end = start + Number(buffer.slice(cursor + 1, lengthEnd));
      if (buffer.length < end + 2) {
        break;
      }
      args.push(buffer.slice(start, end));
      cursor = end + 2;
    }
    if (args.length < count) {
      break;
    }
    commands.push(args);
    pos = cursor;
  }
  return { commands, rest: buffer.slice(pos) };
}
