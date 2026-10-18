# 社区发布验证：远程无头 E2E

开发期间按用户要求不启动全量验证；准备上生产时集中验证、修复。正常发布无需逐页操作 Mac Chrome，也无需先解锁 Mac。

## 发布前：完整业务 E2E

复用 `.github/workflows/community-check.yml` 的 `Community check`，不要在同一候选版本上额外手跑一遍相同全套检查。现有 `select.sh` 按完整 PR diff 选择浏览器和恢复验收；UI 改动不启动完整恢复，文档和单元测试文件改动不启动这两项。人工 workflow_dispatch 会运行两项。

`test/acceptance/browser.mjs` 已使用 `chromium.launch({ headless: true })`，在独立 PostgreSQL、Redis、S3、真实 web/media/control 进程和独立账号上运行。当前覆盖三种上传、保存、明确选版发布、公开浏览、评论/回复/时间点、论坛、通知、举报、精选、公告和后台权限。完整恢复单独顺序运行，避免与浏览器争抢磁盘。正常场景 23 步通过不需要再逐项人工复演。

代码、锁文件、运行配置及镜像层没有变化时复用该候选的通过记录；合并后需核对实际树与部署制品。修改涉及的失败项先定向重跑，最终发布门禁以最终候选的 CI 为准，不能把不同候选的通过结果拼成全部通过。

## 部署后：生产只读无头冒烟

在仓库根目录运行：

```sh
scripts/remote/community-smoke.sh
```

此命令只向 `localhost-1` 传送冒烟脚本，在确认远程 hostname 后使用已安装的 Playwright 1.58.2 和 Chromium。保留远程配置好的代理；Mac 不安装浏览器、不启动服务。若构建机浏览器工具目录变化，用远程绝对路径 `ACCEPTANCE_PLAYWRIGHT_PATH` 指定模块。不会自动安装或使用 sudo。

自动检查已有谱面 #1、评论区、下载入口、旧 UUID/用户链接跳转、三语论坛/公告/帮助、匿名私有权限及 320/390 像素布局。这个短冒烟检查下载入口，不重复下载大原包；完整原包与校验在发布前业务 E2E 中验证。

通过与失败都生成结果 JSON，失败另保存截图；总时限 300 秒，超时没有完整结果时明确记为 incomplete。结果和截图保存在构建机 `/home/i/astrodx-verify/production-smoke/run-*/` 私有目录，不自动上传 CI artifact。截图可能含账号资料，只按私有诊断材料处理。每次输出独立证据目录及脚本哈希，不覆盖旧结果。结果的 toolBaseTree 是工具所在仓库的 HEAD 基准，不代表已验证生产部署版本；生产版本仍须另外核对部署标记和镜像来源。

## 可选：生产已有会话的只读检查

如果构建机已经通过正常登录获得且明确允许用于验收的 Playwright storageState，可指定**构建机上的**文件：

```sh
PRODUCTION_STORAGE_STATE=/home/i/private/adxc-smoke-state.json \
PRODUCTION_AUTH_ROLE=admin PRODUCTION_EXPECT_USER_ID=1 \
scripts/remote/community-smoke.sh
```

文件须由当前远程用户所有、0600，且包含 `adxc.saop.cc` 的有效安全会话；脚本只使用 ADXC 会话 Cookie，不载入其他站点和 localStorage，不复制/读取本机 Chrome 配置，不在生产数据库伪造登录。会话无效或角色不符直接失败，不自动降级为匿名通过。未提供会话时，结果明确标记 `authenticated: not-configured`，不能声称已验收生产登录态。

已配置会话后检查通知、发帖和评论表单、角色权限；管理员额外检查后台八个入口、讨论板块与举报视图、六项依赖、三个运行角色和最近成功备份记录。普通用户检查后台拒绝访问。业务写入 HTTP 方法被拦截，禁用 service worker 和 WebSocket 服务端连接，不发布测试内容或执行管理操作。服务器正常 GET 的会话续期等内部行为不在业务只读保证内。

## 需要真人的边界

完整业务流程优先由隔离无头 E2E 承担。生产登录态无头验收需先配置合法会话；目前不自动创建该会话。新增入口已实际跑通匿名生产冒烟；可选 storageState 分支尚未做生产正向验收，不能当作已具备的持续登录态门禁。第三方 OAuth 首次授权、验证码、Passkey/设备认证、真实听感和游戏导入只在相关改动需要时验收。没有改动这些能力时，不重复要求用户点授权或解锁 Mac。

生产冒烟脚本与隔离写入脚本保持两个入口，禁止把隔离脚本改指向生产。工具改动不需要重新部署产品镜像。
