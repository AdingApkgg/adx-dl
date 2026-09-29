// 客户端传来、要拿去查 uuid 类型列的 id，先用它检查格式：不是 uuid 时 PG 会报错，接口就成了 500。
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
