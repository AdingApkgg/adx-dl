// Better Auth 表上的附加字段，和 src/server/db/schema/auth.ts 里的列一一对应。
// 不能写 as const（只读数组过不了 Better Auth 的字段类型），用 defineFields 包一层，
// 枚举字段才能推断成字面量联合。input: false：任何接口参数都写不了，只能在服务端写。
import type { DBFieldAttribute } from "better-auth/db";

function defineFields<T extends Record<string, DBFieldAttribute>>(fields: T): T {
  return fields;
}

export const userAdditionalFields = defineFields({
  status: { type: ["active", "pending_deletion"], required: true, defaultValue: "active", input: false },
  deletionRequestedAt: { type: "date", required: false, input: false },
  deletionPurgeAt: { type: "date", required: false, input: false },
  deletionDeleteContent: { type: "boolean", required: false, input: false },
  locale: { type: "string", required: false, input: false },
});

export const sessionAdditionalFields = defineFields({
  country: { type: "string", required: false, input: false },
});

export const accountAdditionalFields = defineFields({
  providerEmail: { type: "string", required: false, input: false },
  providerNickname: { type: "string", required: false, input: false },
});
