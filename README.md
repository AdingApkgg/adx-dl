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

## 别名(Aliases)

谱面可按社区俗称(别名)搜索,做法参考 `nonebot-plugin-maimaidx`。别名在**构建期**烤进 `data/catalog/index.json` 的 `aliases` 字段,运行时零成本,搜索/详情页直接读取。

- **数据源(取并集)**:两个免鉴权 JSON,均以官方 maimai 曲目 id 为键,按 id 合并 + 大小写不敏感去重(落雪在前):
  - 落雪(lxns):`https://maimai.lxns.net/api/v0/maimai/alias/list`
  - 柚子(yuzuchan):`https://www.yuzuchan.moe/api/maimaidx/maimaidxalias`
  - 每个源独立 best-effort:某一源失败只记日志跳过,不会中断构建。
- **关联键**:本站 `short_id` ↔ 源 `song_id`(同一个 maimai 曲目 id)。本站 id 带 maimai 偏移(DX +10000、宴 +100000),而别名库以基准 id 存储,故 `_aliases_for()` 按「精确 → 去偏移基准」回退。当前覆盖约 **88%(1369/1562)**。
- **生效位置**:`build_catalog()` 完整构建时自动附带;若只想在不重跑下载密集型完整构建的情况下刷新别名,运行下面的独立步骤即可就地合并进 `index.json`:

```bash
cd pipeline && python3 -c "from pathlib import Path; from tools.build_catalog import enrich_aliases; enrich_aliases(Path('..').resolve())"
```

- **前端**:`aliases` 是 Fuse 搜索键(可精确+模糊搜别名);搜索结果卡片在「仅别名命中(标题未命中)」时显示「别名命中:…」提示;详情页元数据卡展示别名 chip;结构化数据(JSON-LD `MusicRecording`)写入 `alternateName` 并并入 `keywords`,利好 SEO/GEO。
