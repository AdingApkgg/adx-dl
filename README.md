# AstroDX

本项目现在以远端目录索引为主：构建阶段直接扫描 `https://adx-dl.larx.cc/`，进入每个曲目目录读取 `maidata.txt` 或 `maidata_dx.txt`，再生成供站点使用的 `catalog/index.json`。

## 当前主流程

1. 构建远端索引

```bash
python3 -c "from pathlib import Path; from tools.build_catalog import build_catalog; print(build_catalog(Path('.').resolve(), max_workers=16))"
```

2. 构建站点

```bash
cd site
bun run build
```

## 关键目录

- `catalog/`：构建生成的索引数据
- `tools/`：远端抓取、目录解析与辅助脚本
- `site/`：读取 `catalog/index.json` 的静态站点

## 索引来源

- 根目录来自 `https://adx-dl.larx.cc/`
- 逐目录提取 `title`、`artist`、`version`、`genre`、`cabinet`、`short_id`、难度信息
- 封面、音频、PV 直接保留远端 URL，不再复制到本地 `site/public/catalog-assets`
