# Fluent 2 / Material 3 Expressive 视觉比较

2026-11-14。用户要求：两版样板、截图比较，先不发布。

这是基于同一组真实业务页面的两套视觉方向稿，不是官方组件库的完整移植。复用当前搜谱、谱面详情和下载管理器；本轮只比较层级、色彩、字体比例、形状与容器，不改下载业务逻辑。

| | Fluent 2 方向 | Material 3 Expressive 方向 |
| --- | --- | --- |
| 表面 | 中性灰背景、白色工作表面、低层级阴影 | 带种子色的 tonal surfaces、用色块区分任务区域 |
| 形状 | 控件 4px、卡片 8px，矩形结构清晰 | 大圆角与对比形状，主要操作为高对比胶囊 |
| 字体 | 克制的字号与字重变化 | 更大的主标题、更强的主次字重差 |
| 下载区域 | 清晰的工作区，按钮与选项紧凑排列 | 下载区域为主要色块，大按钮与次要操作明显分开 |
| 任务管理 | 列表和分隔线、可扫描的阶段信息 | 分组容器与强调待保存任务，层级更鲜明 |

公平比较：同一首 XODUS、同样的作者/难度/文件大小、默认 .adx、相同搜索结果、相同待保存任务；截图分别使用 390×900 和 1440×900 的内部页面视口。两版均保留 44px 操作目标和已有焦点/保存保护。

## 文件与预览

- `index.html` + `preview.js`：同源 iframe 预览壳，提供风格和页面切换。
- `common.css`：仅在预览 iframe 上生效的公共隔离规则。
- `fluent.css` / `expressive.css`：两套按 data-design-concept 限定作用域的视觉 token 与样式。
- 文件位于 docs，未导入主站。只手动同步到远程开发服务器的临时 public 目录，不进入生产页面。
- 开发预览：`http://localhost:3310/__design-comparison/index.html?style=fluent&page=detail`，将 `style` 改为 `expressive` 可切换，`page` 支持 search/detail/downloads。
- 下载管理器截图通过隔离浏览器配置准备小文件测试任务，表示待保存阶段；不把截图状态当作真实手机落盘证据。

## 官方参照

- Fluent：色彩 https://fluent2.microsoft.design/color 、层级 https://fluent2.microsoft.design/elevation 、形状 https://fluent2.microsoft.design/shapes 、排版 https://fluent2.microsoft.design/typography 。
- Material 3 Expressive：https://m3.material.io/ 、https://design.google/library/expressive-material-design-google-research 。

具体的配色和网页适配是本轮针对 AstroDX 的选择，原有封面、版本和难度颜色保留，不把参考样式当作官方符合性认证。


## 本轮验证记录

- 浏览器原始截图 12 张：2 种风格 × 3 类页面 × 手机/桌面，实际内容视口 390×900 / 1440×900。
- 两版搜谱、详情和管理器另检查 320px，无横向溢出；每页保留一个 main。浏览器运行异常为 0。
- 两版详情的默认下载格式均为 .adx，管理器使用同一个待保存任务；没有替换或迁移主站业务组件。
- 原始截图与并排图：`/tmp/astrodx-design-comparison/`，包括 `comparison-detail-mobile.png`、`comparison-search-mobile.png`、`comparison-downloads-mobile.png` 及对应 desktop 文件。
- JS 语法检查通过，iframe 可正常加载真实页面和两套样式。此次原型没有修改应用代码，验证针对预览加载、样式及截图，不重复运行整站构建。
- 未推送、未发布。预览目录为本轮开发服务器的临时文件；`dev.sh sync` 后如被清理，可将此目录重新 rsync 到其 `public/__design-comparison/`。
