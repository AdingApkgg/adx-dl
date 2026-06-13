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

部署工作流支持在发布完成后自动提交 IndexNow。

需要配置以下 GitHub Actions Variables / Secrets：

- `NEXT_PUBLIC_SITE_URL`：站点公开基址，例如 `https://adxdls.saop.cc`
- `INDEXNOW_SITE_URL`：可选；未设置时回退到 `NEXT_PUBLIC_SITE_URL`
- `INDEXNOW_KEY`：IndexNow key

工作流会在构建前生成 `public/indexnow-<key>.txt` 和 `public/CNAME`，构建完成并发布后执行：

```bash
bun run submit:indexnow
```

本地验证时可以直接传入环境变量：

```bash
NEXT_PUBLIC_SITE_URL=https://adxdls.saop.cc INDEXNOW_KEY=your-key bun run submit:indexnow
```

## 相关目录

- `src/app/`：应用路由与页面
- `src/lib/`：索引读取、搜索与共享工具
- `public/`：站点静态资源

更多项目背景与主流程请查看仓库根目录的 `README.md`。
