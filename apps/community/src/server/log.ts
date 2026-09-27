export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export type Logger = {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

// 单行 JSON，方便 docker logs 里直接 grep 和过滤。调用方只传结构化字段，
// 这里不接收任意对象，避免把请求头、Cookie 之类整包写进日志。
export function createLogger(write: (line: string) => void = (line) => console.log(line)): Logger {
  const emit = (level: "info" | "error", event: string, fields: LogFields = {}) => {
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
