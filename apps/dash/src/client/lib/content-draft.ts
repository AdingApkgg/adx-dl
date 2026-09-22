import { CONTENT_LOCALES } from "@astrodx/content-schema";

export type LocalizedDraft = Record<string, string>;

export type LinkEntryDraft = {
  name: LocalizedDraft;
  url: string;
  description?: LocalizedDraft;
};

function blankLocalized(): LocalizedDraft {
  return Object.fromEntries(CONTENT_LOCALES.map((locale) => [locale, ""]));
}

export function emptyEntry(requireDescription: boolean): LinkEntryDraft {
  const entry: LinkEntryDraft = { name: blankLocalized(), url: "" };
  // description 只在该数组要它的时候才建。建了又留空的话，校验会报
  // 「必须是非空字符串」——而这条数组根本不该有 description，报错本身就是错的。
  if (requireDescription) entry.description = blankLocalized();
  return entry;
}

export function moveEntry<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  // 越界一律原样返回。首条的「上移」和末条的「下移」是一定会被点到的，
  // 绕回另一端是最容易让人以为条目丢了的那种行为。
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function removeEntry<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, position) => position !== index);
}

export function replaceEntry<T>(list: readonly T[], index: number, next: T): T[] {
  return list.map((item, position) => (position === index ? next : item));
}

/**
 * 把校验错误按路径归拢，供表单把每条消息放到对应的输入框下面。
 *
 * 消息格式是 `<路径>: <说明>`（见 content-schema 的 link-list.ts —— 那边的注释
 * 也写明了这个格式是有承重作用的）。只按**第一个**冒号切：说明里本身可能含冒号，
 * 比如「只允许 http/https，拿到的是 javascript:」。
 *
 * ## 前向约束：只能喂客户端自己这次校验的结果
 *
 * 只能喂客户端自己跑 `validateLinkListFile`（或走同一条路径的表单校验）得到的
 * `errors[]`。**不能**喂 `POST /api/content/commit` 失败响应体里的 `errors[]`
 * （也就是 `ApiError.detail.errors`）。
 *
 * 原因：那个端点一次提交可能横跨好几个文件，服务端为了让操作员看出
 * 「不是合法的 URL」说的到底是哪一份，给每条消息都冠上了文件标题——
 * `${spec.title}：${error}`（见 routes/content.ts），标题和原始的
 * `路径: 说明` 之间用的是**全角**冒号「：」。一条真实的服务端消息形如：
 *
 * ```
 * 社区与联系方式：contactChannels[0].name.ja: 必须是非空字符串
 * ```
 *
 * 这个函数按**第一个半角** `": "` 切——全角冒号不算数，于是真正的切点落在了
 * 消息内部、路径与说明之间的那个半角冒号上，切出来的「路径」变成
 * `社区与联系方式：contactChannels[0].name.ja`，跟表单里任何一个输入框的
 * key（`contactChannels[0].name.ja`）都对不上。后果不是报错、不是变红，是
 * **所有错误提示静默消失**——Map 里确实存了这条消息，只是没有一个输入框会去
 * 认领它。
 *
 * 服务端校验失败该怎么展示，是提交冲突/失败界面的范围：那条路径直接原样
 * 显示 `ApiError.detail.errors` 里的整条消息（文件标题前缀是特意加上去给人
 * 看的，帮操作员分清一次提交里是哪个文件出的问题），不经过这个函数、
 * 不按路径拆分。
 */
export function errorsByPath(errors: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const error of errors) {
    const at = error.indexOf(": ");
    const path = at === -1 ? "" : error.slice(0, at);
    const message = at === -1 ? error : error.slice(at + 2);
    const existing = index.get(path);
    if (existing) existing.push(message);
    else index.set(path, [message]);
  }
  return index;
}
