# AstroDX

AstroDX 谱面资料站 monorepo:Python 构建器抓取远端目录索引,Next.js 站点读取生成的目录数据并静态导出到 GitHub Pages。

## 仓库结构

```
.
├─ apps/
│  └─ web/            # Next.js 16 静态站点(bun);读取 data/catalog/index.json
├─ pipeline/          # Python 构建器与测试
│  ├─ tools/          #   远端抓取、maidata 解析、目录构建
│  └─ tests/          #   构建器单元测试
├─ data/
│  └─ catalog/        # 构建生成的目录索引数据(index.json)
├─ assets/            # 品牌资源(图标 / Open Graph 等)
└─ package.json       # bun workspaces 根(workspaces: apps/*)
```

## 常用命令(均在仓库根目录执行)

1. 构建远端索引(写入 `data/catalog/index.json`)

```bash
bun run build:catalog
```

2. 安装依赖并构建站点(静态导出到 `apps/web/out`)

```bash
bun install
bun run build          # 等价于 bun run --filter web build
```

3. 测试

```bash
bun run test           # 站点测试(bun test,运行于 apps/web)
bun run test:catalog   # 构建器测试(python unittest,运行于 pipeline)
```

> 也可进入子包直接操作,例如 `cd apps/web && bun run dev`。

## 索引来源

- 根目录来自 `https://adx-dl.larx.cc/`
- 逐目录提取 `title`、`artist`、`version`、`genre`、`cabinet`、`short_id`、难度信息
- 封面、音频、PV 直接保留远端 URL,不复制到本地
