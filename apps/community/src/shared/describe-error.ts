import type { LogFields } from "./log";

// 把错误变成可以写进日志的字段。令牌、QQ 号、验证码绝不能进日志，而数据库错误的
// message 常常带着值：Drizzle 的是 "Failed query: <sql>\nparams: <参数值>"，
// Postgres 的会是 invalid input syntax for type uuid: "…"、Key (token)=(…) 这样。
//
// 按形状识别，不用 instanceof：shared 两边都要能用（服务端渲染入口 entry.server.tsx
// 也用它），不引用只属于服务端的 drizzle-orm 和 pg。形状由 describe-error.test.ts
// 拿两个库真正的错误类守着。
export function describeError(error: unknown): LogFields {
  if (isDrizzleQueryError(error)) {
    // 只记 SQL 本身（值都是 $1 这样的占位符）和原因里的错误码、约束名。
    return {
      name: "DrizzleQueryError",
      query: error.query,
      code: stringField(error.cause, "code"),
      constraint: stringField(error.cause, "constraint"),
    };
  }
  if (isDatabaseError(error)) {
    // 这几项只有错误码和库、表、列、约束、函数的名字；message、detail、hint、where
    // 可能带着值，一律不记。
    return {
      name: "DatabaseError",
      code: error.code,
      severity: error.severity,
      schema: stringField(error, "schema"),
      table: stringField(error, "table"),
      column: stringField(error, "column"),
      constraint: stringField(error, "constraint"),
      routine: stringField(error, "routine"),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

// drizzle-orm 0.45 的 DrizzleQueryError：query 是 SQL，params 是参数值，cause 是驱动抛的错误。
function isDrizzleQueryError(error: unknown): error is Error & { query: string } {
  return error instanceof Error && stringField(error, "query") !== undefined && Array.isArray(field(error, "params"));
}

// pg 的 DatabaseError：code 是五位的 SQLSTATE，severity 是 ERROR、FATAL 这样的级别。
// 两个都要有：EPIPE 这样的系统错误码也是五个字符，但没有 severity。
function isDatabaseError(error: unknown): error is { code: string; severity: string } {
  const code = stringField(error, "code");
  return code !== undefined && /^[0-9A-Z]{5}$/.test(code) && stringField(error, "severity") !== undefined;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
}
