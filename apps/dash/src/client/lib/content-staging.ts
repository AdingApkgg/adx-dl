/**
 * 待发布改动的暂存区。
 *
 * 为什么落 localStorage 而不是放内存：一次编辑可能要改好几个文件、打好几段
 * 三语文案，中途手滑刷新一下就全没了。为什么不放服务端：服务端现在是无状态的，
 * 为一个单人工具引入「草稿」这类持久状态，要处理的是清理、并发、以及它与仓库
 * 真相不一致时该信谁——而这些问题的收益只是省掉一次重打。
 *
 * 过期草稿不在这里判断：发布时服务端会拿 baseSha 做乐观锁（见 spec §10.2 的
 * 两层锁），陈旧的草稿会在那里被挡住并点名文件，比在这里猜一个过期时长准。
 *
 * 每一次读写都裹在 try/catch 里：隐私模式、站点数据被清、配额满，任何一种都
 * 可能让 getItem/setItem 直接抛。丢一份草稿可以接受，整页白屏不行。
 */

const STORAGE_KEY = "dash:content-staging:v1";

export type StagedFile = {
  data: unknown;
  /** 打开这个文件时读到的 blob sha，发布时原样带回服务端。 */
  baseSha: string;
  editedAt: number;
};

export type Staging = Record<string, StagedFile>;

/** 只取我们用到的三个方法，方便测试注入一个会抛的假实现。 */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isStagedFile(value: unknown): value is StagedFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    "data" in candidate &&
    typeof candidate.baseSha === "string" &&
    candidate.baseSha !== "" &&
    typeof candidate.editedAt === "number"
  );
}

export function loadStaging(storage: StorageLike | null): Staging {
  if (!storage) return {};
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  // 逐条过筛而不是整份丢弃：旧版本写进去的、或被手改坏的单条，不该连累
  // 其他还好的草稿。
  const staging: Staging = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isStagedFile(value)) staging[key] = value;
  }
  return staging;
}

export function saveStaging(staging: Staging, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    if (Object.keys(staging).length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(staging));
  } catch {
    // 见文件头注释：丢草稿可以，崩页面不行。
  }
}

export function stageFile(staging: Staging, key: string, data: unknown, baseSha: string, now: number): Staging {
  return { ...staging, [key]: { data, baseSha, editedAt: now } };
}

export function unstageFile(staging: Staging, key: string): Staging {
  // 不用 `const { [key]: _removed, ...rest } = staging`：仓库的 ESLint 配置把
  // @typescript-eslint/no-unused-vars 的 ignoreRestSiblings 限定在测试文件
  // 里（见 commit f632e8c），源码里那个 _removed 绑定不会被豁免，会被
  // no-unused-vars 报错。改用逐条过筛。
  const rest: Staging = {};
  for (const [existing, value] of Object.entries(staging)) {
    if (existing !== key) rest[existing] = value;
  }
  return rest;
}

export function pendingKeys(staging: Staging): string[] {
  return Object.keys(staging).sort();
}
