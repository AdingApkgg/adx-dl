## AstroDX Site

`site/` 是 AstroDX 的 Next.js 前端，读取仓库根目录下的 `catalog/index.json` 并渲染曲目列表、详情页和相关状态信息。

## 开发

在 `site/` 目录运行：

```bash
bun install
bun run dev
```

默认开发地址为 [http://localhost:3000](http://localhost:3000)。

## 构建

```bash
bun run build
```

如需让构建产出的 metadata 与线上域名一致，请带上站点基址：

```bash
NEXT_PUBLIC_SITE_URL=https://adxdls.saop.cc bun run build
```

如果需要先更新索引，请先回到仓库根目录执行：

```bash
python3 -c "from pathlib import Path; from tools.build_catalog import build_catalog; print(build_catalog(Path('.').resolve(), max_workers=16))"
```

## IndexNow

部署工作流会在发布完成后自动提交 IndexNow。

IndexNow key 按协议本就是公开的（站点根目录可访问 `/indexnow-<key>.txt`），因此直接随仓库提交：

- key 文件：`public/indexnow-<key>.txt`
- 默认 key：`src/lib/indexnow.ts` 中的 `defaultIndexNowKey`（可被 `INDEXNOW_KEY` 环境变量覆盖）

站点基址沿用 `NEXT_PUBLIC_SITE_URL`（GitHub Actions Variable，未设置时回退到 `src/lib/site-url.ts` 的默认值）。`INDEXNOW_SITE_URL` 为可选覆盖。无需任何 Secret。

工作流会在构建前生成 `public/CNAME`，构建并发布后执行：

```bash
bun run submit:indexnow
```

本地验证时可直接运行（无参数即使用仓库内默认值）；如需临时覆盖：

```bash
NEXT_PUBLIC_SITE_URL=https://adxdls.saop.cc INDEXNOW_KEY=your-key bun run submit:indexnow
```

> 轮换 key：替换 `public/` 下的 key 文件并更新 `defaultIndexNowKey` 即可，两者必须一致。

## 相关目录

- `src/app/`：应用路由与页面
- `src/lib/`：索引读取、搜索与共享工具
- `public/`：站点静态资源

更多项目背景与主流程请查看仓库根目录的 `README.md`。
