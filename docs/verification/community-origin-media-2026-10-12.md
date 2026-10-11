# 社区头像去除缓存清除依赖

用户要求简化 Cloudflare 依赖，作为已批准存储设计的本次上线调整。保留已有域名、隧道、Access 与 Turnstile；去掉新增的 Cache Purge token、Zone ID 和 purge API 调用。本机只编辑文件，构建和测试仍全部远程。

## 固定缓存策略

公开头像仍通过规范 `/media/<sha256>.jpg` 匿名读取，鉴权和 publication 状态判定不变。成功的200、206、HEAD、304响应使用 `Cache-Control: private, max-age=86400, immutable`，浏览器缓存一天；同时使用标准 `CDN-Cache-Control: no-store` 禁止共享缓存。私有文件和所有媒体错误响应继续 `private, no-store`，同样禁止CDN缓存。保留ETag、Range、流式读取及断连清理。

浏览器缓存一天是实现选择，降低小服务器重复传输；浏览器已取得的副本仍不能被服务器召回。与旧方案的一年公开缓存相比，不再通过CDN存储和主动清除来完成撤回。

## 撤回与恢复

保留现有持久化outbox、generation/attempt隔离、内部drain、退避与修复任务、GC及备份恢复日志。证据固定标记为 `origin-private-v1`，`purges`为空；完成需当前代际drain200、两个相隔至少5秒的规范URL匿名404、非共享缓存HIT、private/no-store响应头和最终锁内引用检查。旧协议证据不能满足新协议门槛。JSON证据类型调整不增加数据库迁移。

本次生产从未发布头像，因此没有旧的公开JPEG共享缓存需要迁移。若以后从使用过CDN缓存的版本切换，必须先处理历史缓存，不能直接以此首次上线前提代替迁移。

## 必要验收与发布

只更新直接受影响的配置、媒体HTTP缓存、撤回和恢复证据测试。CI负责远程构建和相关验收，不重复人工登录验证。生产使用预构建的精确镜像，只更新社区目标角色，保留NapCat复用、Umami和既有备份定时器。上线后做一次合成头像发布/撤回：重复公开GET均无共享缓存HIT，撤回后404且持久证据完成；代理规则若覆盖这些头则停止并定位，不能放宽门槛。

512 MiB按需占用的临时文件系统仍需完成终端sudo安装。角色密钥、备份密码和原有认证配置留在服务器，无需新增Cloudflare缓存清除凭据。

缓存头的分工遵循[HTTP与Cloudflare官方说明](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/)；共享缓存规则覆盖源站头时，真实验收应失败并定位。
