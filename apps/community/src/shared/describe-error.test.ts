import { describe, expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

import { describeError } from "./describe-error";

// 用真的 DrizzleQueryError 和 pg 的 DatabaseError：两个库改了错误的形状，这里会先失败。
const TOKEN = "sess_9f8e7d6c5b4a3210";
const QQ = "1234567890";

type PgFields = Partial<Pick<DatabaseError, "code" | "severity" | "detail" | "constraint" | "table" | "routine">>;

function pgError(message: string, fields: PgFields): DatabaseError {
  return Object.assign(new DatabaseError(message, message.length, "error"), fields);
}

describe("describeError", () => {
  test("Drizzle 查询错误：只记 SQL 和 Postgres 的错误码、约束名，不记参数", () => {
    const query = 'insert into "sessions" ("token", "qq") values ($1, $2)';
    const cause = pgError('duplicate key value violates unique constraint "sessions_token_key"', {
      code: "23505",
      severity: "ERROR",
      constraint: "sessions_token_key",
      table: "sessions",
      detail: `Key (token)=(${TOKEN}) already exists.`,
    });

    const fields = describeError(new DrizzleQueryError(query, [TOKEN, QQ], cause));

    expect(fields).toEqual({ name: "DrizzleQueryError", query, code: "23505", constraint: "sessions_token_key" });
    const line = JSON.stringify(fields);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(QQ);
  });

  test("Drizzle 查询错误的原因不是 Postgres 错误时，也不记原因的 message", () => {
    const error = new DrizzleQueryError("select 1 where x = $1", [TOKEN], new Error(`bad value ${TOKEN}`));
    expect(describeError(error)).toEqual({ name: "DrizzleQueryError", query: "select 1 where x = $1" });
  });

  // Postgres 的 message 会带上值，比如 invalid input syntax for type uuid: "…"。
  test("Postgres 错误：只记错误码、约束名这类字段，不记 message 和 detail", () => {
    const error = pgError(`invalid input syntax for type uuid: "${TOKEN}"`, {
      code: "22P02",
      severity: "ERROR",
      routine: "string_to_uuid",
      detail: TOKEN,
    });

    const fields = describeError(error);

    expect(fields).toEqual({ name: "DatabaseError", code: "22P02", severity: "ERROR", routine: "string_to_uuid" });
    expect(JSON.stringify(fields)).not.toContain(TOKEN);
  });

  // 比如另一份 pg 抛出的错误，instanceof 认不出来。
  test("有 SQLSTATE 和 severity 的错误按 Postgres 错误处理", () => {
    const error = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
      severity: "FATAL",
    });
    expect(describeError(error)).toEqual({ name: "DatabaseError", code: "57P01", severity: "FATAL" });
  });

  test("系统错误的 code 不算 SQLSTATE，按普通错误处理", () => {
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(describeError(error)).toEqual({ name: "Error", message: "write EPIPE" });
  });

  test("其他错误：记 name 和 message", () => {
    expect(describeError(new TypeError("x is not a function"))).toEqual({
      name: "TypeError",
      message: "x is not a function",
    });
    expect(describeError("boom")).toEqual({ message: "boom" });
  });
});
