# AstroDX — 给编码助手的项目说明

所有编码助手（Codex、dsh、Claude Code……）都读这一份；Claude Code 经由同目录的 `CLAUDE.md` 引用它。
各应用自己的注意事项放在应用目录里，例如 `apps/web/AGENTS.md`（这个版本的 Next.js 和训练数据里的不一样，写代码前先看 `node_modules/next/dist/docs/`）。

## 在哪里跑

本机（Mac）不是构建机，规则见全局的 `~/.agents/AGENTS.md`。在这个仓库里，凡是「一律去远程」的事都用下面两个脚本，在仓库根目录执行：

| 要做的事 | 命令 |
|---|---|
| 跑 CI 的那几项检查（lint、packages/ui、apps/web 的类型检查和测试） | `scripts/remote/verify.sh` |
| 检查某个提交而不是当前工作区 | `scripts/remote/verify.sh --ref <提交>` |
| 在远程跑自定义命令（比如只跑一个测试文件） | `scripts/remote/verify.sh -- 'cd apps/web && bun test src/lib/notices.test.ts'` |
| 开发服务器 + 浏览器预览 | `scripts/remote/dev.sh start`，然后打开 http://localhost:3310 |
| 改完代码让预览更新 | `scripts/remote/dev.sh sync` |
| 用完关掉 | `scripts/remote/dev.sh stop` |

本机可以直接做的：读改代码、git / gh、ssh / rsync、只针对改动文件的 Biome lint、单个测试文件（`bun test <文件>`）。

### 细节

- **构建机**是 `i@localhost-1.tailac9c6f.ts.net`（它自己的 hostname 是 `localhost`；两个脚本动手前都会核对，连错机器会直接退出）。命令跑在按 digest 固定的 `oven/bun:1.4.2` 容器里，有 CPU / 内存限制；依赖缓存在远程的 `/home/i/astrodx-verify/bun-cache`，第二次起安装很快。
- **verify.sh** 把工作区（已跟踪的改动 + 未被忽略的新文件）做成一个 git tree，用 `git archive` 送过去；不会动本地的 index 和工作区。每次在远程 `/home/i/astrodx-verify/runs/` 下新建目录，跑完即删（`--keep` 保留下来排查；残留超过 2 天的会被清掉）。退出码就是远程命令的退出码。
- **dev.sh** 用 Homebrew 的 GNU rsync 按 `.gitignore` 同步工作区（远程的 `node_modules`、`.next` 不受影响），远程 `next dev` 只监听那台机器的 `127.0.0.1`，再用 `ssh -L` 转发到本机 `localhost:3310`。所以它在本机看来就是普通的 localhost 开发服务器：内置浏览器不用逐站授权，热更新的 WebSocket 也走隧道；它不暴露在 tailnet 或构建机的局域网上。
- **内置浏览器**：`.claude/launch.json`（未入库）里放 `{"name": "web", "url": "http://localhost:3310"}`，`preview_start` 选 `web` 就会接到隧道上，不会在本机起进程。

## CI

- PR 上的 `web-check` 跑在 GitHub 托管的 `ubuntu-latest`；只有推到 main / dev / pre 才用 localhost-1 上的自托管 runner（标签 `astrodx-ci`）。推上去的 PR 交给 CI 验证即可，`verify.sh` 用在推送之前。
- 静态站构建（`next build`）需要从媒体服务器拉的目录数据，那是 CI 的事，`verify.sh` 默认不做。
