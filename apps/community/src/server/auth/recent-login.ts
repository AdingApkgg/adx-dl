// 敏感操作（解绑、绑定新的登录方式（Google、QQ）、删除或添加通行密钥、踢下线、退出其他设备）要求当前会话
// 在 10 分钟内创建（spec 第 10.4 节）。
// 用 createdAt：会话续期只改 updatedAt 和 expiresAt，不改 createdAt（调研实测）。
export const RECENT_LOGIN_MS = 10 * 60 * 1000;

export function isRecentLogin(sessionCreatedAt: Date | string, now = Date.now()): boolean {
  return now - new Date(sessionCreatedAt).getTime() <= RECENT_LOGIN_MS;
}
