export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

// 单行 JSON，方便 docker logs 里直接 grep 和过滤。调用方只传结构化字段，
// 这里不接收任意对象，避免把请求头、Cookie 之类整包写进日志。
// 放在 shared：服务端渲染入口 src/client/entry.server.tsx 也用它记错误。
export function createLogger(write: (line: string) => void = (line) => console.log(line)): Logger {
  const emit = (level: "info" | "warn" | "error", event: string, fields: LogFields = {}) => {
    const fixed = { time: new Date().toISOString(), level, event };
    // 前一个 fixed 让这三项排在最前面；后一个保证调用方传的同名字段冒充不了它们。
    write(JSON.stringify({ ...fixed, ...fields, ...fixed }));
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
