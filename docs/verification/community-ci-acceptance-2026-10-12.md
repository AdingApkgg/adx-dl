# 社区 CI 自动验收接入记录

现有 `Community check` 已包含 lint、类型检查、单元/DOM、构建产物 HTTP 和应用/备份镜像构建。本次补齐真实浏览器与完整恢复的自动入口，没有新增生产服务或自动部署。

## 接入内容

- 同一轮应用/备份镜像按 GitHub source SHA 校验后复用，薄验收镜像只复制测试源码、现有 Web build 和 fixture 所需模块。
- 按完整 PR/push diff 选择：界面改动跑一条 Chromium 业务流程，存储/worker/数据库/备份改动再跑现有 opt-in fresh-volume restore；常规单测和文档改动跳过附加运行验收，手动 dispatch 选择两项。
- 合成账号验证 ZIP 上传处理、显式保存、刷新持久化、实际 Canvas 预览、私有 WAV Range/跨用户隔离、删除及额度释放，并顺带验证头像保存和公开 JPEG。Chromium 仅装在 CI 临时目录，不成为产品依赖。
- GitHub hosted Linux 内自动创建 512 MiB sparse ext4，保留真实 media 入口的有界磁盘检查及容量 5 GiB 底线。独占 PG/Redis/S3 与新数据卷，无生产密钥。失败、超时及结束时清理本轮资源。
- 只上传安全 JSON 和失败截图，保留七天；会话/env、原始日志、数据库 dump、restic 仓库及浏览器 trace 不上传。
- 恢复测试从已确认 `_test` 的目标 URL 取数据库名，修复工具之间的目标名称不一致；fixture 可独立指定真实容量检查目录，避免把 512 MiB scratch 当作对象容量盘。

## 本次必要远程验证

全部运行于 `i@localhost-1.tailac9c6f.ts.net`，实测 Linux/Docker Linux。没有在 Mac 安装依赖或运行构建、测试、浏览器或服务，没有重跑既有产品用例。

| 检查 | 结果 |
|---|---|
| Bash/Node 语法、四个新改 TS 文件的 Bun transpile、两份 YAML parse | 通过 |
| 仅 GitHub hosted runner 可启动的 guard | 非 CI 远程主机按预期拒绝，退出码 2 |
| 七种完整 diff/手动运行/缺失基线的选择场景 | 通过 |
| 全 profiles Compose config | 通过 |
| 官方 actionlint 1.7.12，发行校验和校验后运行 | 工作流检查通过；未安装 ShellCheck，因此 shell 语法另用 `bash -n` 核对 |
| 复用 `b002390` 两个既有产品镜像的薄层构建及实际 fixture 导入 | 通过；五个 S3 identity、role 文件权限及独立容量路径断言通过，生成的测试密钥已清理 |
| 一次独立只读复核 | 两处必失败项（缺少 Seaweed 配置模块、root 私有结果目录）修复后，未发现剩余 Critical/Important |

远程工具目录 `/home/i/astrodx-community-storage-dev-20261011/ci-acceptance-check`，本次临时验证文件未进入产品镜像。原功能镜像与证据保持原状。

## 当前边界

代码尚未推送，GitHub Actions 上的新 Chromium 和 fresh-volume restore **尚未运行**。本记录证明接入配置、脚本及 fixture 可加载，不把静态/fixture 检查记成端到端通过。PR 或推送至 `main`/`dev`/`pre` 后，首次 Actions 实际结果才能关闭这两个剩余验收项。

自动验收运行时无需用户 Chrome 或手工 sudo；实际听感、物理设备导入及个人 OAuth/通行密钥登录仍是另一类证据。本批不重复已完成的登录验收，生产部署保持原有单独授权流程。
