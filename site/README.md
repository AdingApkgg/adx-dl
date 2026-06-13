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

如果需要先更新索引，请先回到仓库根目录执行：

```bash
python3 -c "from pathlib import Path; from tools.build_catalog import build_catalog; print(build_catalog(Path('.').resolve(), max_workers=16))"
```

## 相关目录

- `src/app/`：应用路由与页面
- `src/lib/`：索引读取、搜索与共享工具
- `public/`：站点静态资源

更多项目背景与主流程请查看仓库根目录的 `README.md`。
