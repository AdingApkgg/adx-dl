import { useState } from "react";
import { useRevalidator } from "react-router";

import { findContentFile, validateContentFile, type ContentFileSpec } from "@astrodx/content-schema";

import type { ContentFileResponse } from "@/shared/dto";

import { LinkEntryFields } from "../components/link-entry-fields";
import { api } from "../lib/api";
import {
  contentFormKey,
  emptyEntry,
  errorsByPath,
  moveEntry,
  removeEntry,
  replaceEntry,
  type LinkEntryDraft,
} from "../lib/content-draft";
import { loadStaging, saveStaging, stageFile } from "../lib/content-staging";
import type { Route } from "./+types/content.$key";

type Draft = Record<string, LinkEntryDraft[]>;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const file = await api.contentFile(params.key);
  // 有草稿就用草稿，但 sha 始终用这次读到的：草稿里那个是上次打开时的，
  // 拿它去提交会平白触发一次冲突。
  const staged = loadStaging(globalThis.localStorage ?? null)[params.key];
  return { file, staged: staged?.data as Draft | undefined };
}

type ContentFormProps = {
  file: ContentFileResponse;
  spec: ContentFileSpec;
  initial: Draft;
  /** 暂存成功或校验失败时往上报一句话。外层持有它，好让它在组件重建后仍然留在屏幕上。 */
  onNotice: (message: string) => void;
};

/**
 * 表单主体：状态、暂存逻辑、渲染。外层（ContentFile）用 `contentFormKey` 给它一个
 * 跟着 file.key / file.sha / 暂存状态走的 key——三者任一变化都要重建这个组件，
 * 好让 `draft`（useState 惰性初始化，只在挂载时跑一次）回到正确的数据上。
 * 见 content-draft.ts 里 contentFormKey 的长注释。
 *
 * `notice` 不在这里：它由外层持有并通过 `onNotice` 回调接收，好让它在这个组件
 * 因为 key 变化重建（比如第一次暂存这个文件）之后仍然留在屏幕上。`errors`
 * 则相反，留在这里——丢弃改动、切换草稿之后，旧的错误标记没有意义，应该跟着
 * 重建一起清掉。
 */
function ContentForm({ file, spec, initial, onNotice }: ContentFormProps) {
  const [draft, setDraft] = useState<Draft>(() => structuredClone(initial));
  const [errors, setErrors] = useState<Map<string, string[]>>(new Map());
  const revalidator = useRevalidator();

  const stage = () => {
    // 只喂客户端这次自己跑出来的 errors——绝不能喂服务端 commit 失败时
    // 回的 errors（那份消息前面冠了文件标题，errorsByPath 会切错路径，
    // 见 content-draft.ts 顶部的长注释）。
    const result = validateContentFile(file.key, draft);
    if (!result.ok) {
      setErrors(errorsByPath(result.errors));
      onNotice(`还有 ${result.errors.length} 处要改`);
      return;
    }
    setErrors(new Map());
    const storage = globalThis.localStorage ?? null;
    saveStaging(stageFile(loadStaging(storage), file.key, draft, file.sha, Date.now()), storage);
    onNotice("已暂存，到顶部点「发布」才会提交");
    // 顶部暂存条的计数是从 content.tsx 的 clientLoader 读的，这里的 setState
    // 不会自动传到那一层——revalidate() 重跑包括祖先在内的所有活跃 loader，
    // 让它读到刚写进 localStorage 的新值。
    revalidator.revalidate();
  };

  return (
    <>
      {spec.arrays.map((array) => {
        const entries = draft[array.key] ?? [];
        return (
          <fieldset key={array.key} className="dash-array">
            <legend>{array.key}</legend>
            {entries.map((entry, index) => (
              // key={index} 是对的：条目没有稳定 id，增删移都靠重建整个数组
              // 完成（下面的上移/下移/删除按钮）。不要换成 key={entry.url}——
              // 那正是用户正在编辑的字段，一变就会让输入框失焦。
              <div key={index} className="dash-entry-row">
                <LinkEntryFields
                  entry={entry}
                  path={`${array.key}[${index}]`}
                  errors={errors}
                  onChange={(next) => setDraft({ ...draft, [array.key]: replaceEntry(entries, index, next) })}
                />
                <div className="dash-entry-actions">
                  <button
                    type="button"
                    aria-label={`上移第 ${index + 1} 条`}
                    disabled={index === 0}
                    onClick={() => setDraft({ ...draft, [array.key]: moveEntry(entries, index, -1) })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`下移第 ${index + 1} 条`}
                    disabled={index === entries.length - 1}
                    onClick={() => setDraft({ ...draft, [array.key]: moveEntry(entries, index, 1) })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`删除第 ${index + 1} 条`}
                    onClick={() => {
                      // 删掉的是一段手打的三语文案，撤不回来（草稿不做历史）。
                      // 这是这个页面上唯一一个会丢内容的操作，所以问一句。
                      if (!window.confirm(`删除「${entry.name.zh || "（未命名）"}」？`)) return;
                      setDraft({ ...draft, [array.key]: removeEntry(entries, index) });
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, [array.key]: [...entries, emptyEntry(array.requireDescription)] })
              }
            >
              新增条目
            </button>
          </fieldset>
        );
      })}

      <button type="button" onClick={stage}>
        暂存改动
      </button>
    </>
  );
}

export default function ContentFile({ loaderData }: Route.ComponentProps) {
  const { file, staged } = loaderData;
  const spec = findContentFile(file.key);
  // 带上 fileKey 而不是裸 string：这个组件本身不会因为切换 :key 而重挂载
  // （React Router 同一路由、只有路径参数变化时不会卸载重挂载），只有
  // ContentForm 会（它的 key 里含 file.key，见 contentFormKey）。如果
  // notice 只是个裸字符串，从 community 暂存完（notice = "已暂存…"）
  // 再点链接切到 donate，这个组件不重挂载，notice 会原样带过去，在
  // donate 页面上显示一句关于 community 的话。
  //
  // 修法不是在 useEffect 里 setNotice(null)（那是"记得去同步"，漏一次
  // 就会复发，而且这仓库的 react-hooks lint 规则大概率会拦 effect 里
  // 直接 setState），而是让状态自己带上它的归属，渲染时只认当前文件的
  // 那条——旧文件的 notice 不需要被清掉，只是不再被认领，结构上不可能
  // 显示错文件。
  const [notice, setNotice] = useState<{ fileKey: string; text: string } | null>(null);

  if (!spec) return <p className="dash-notice dash-notice--bad">没有这个内容文件</p>;

  return (
    <section>
      <h2>{file.title}</h2>
      <p className="dash-muted">
        <code>{file.path}</code>
      </p>
      {/* spec §10.4：这句话必须留在界面上——暂存前的校验只挡得住结构性
          错误（三语字段是否齐、URL 格式对不对），挡不住类型层面的错，
          那个只有 CI 的 tsc 知道。不写这句，操作员会把「暂存成功」当成
          万无一失。 */}
      <p className="dash-muted">
        暂存前会检查三语字段与链接格式。类型层面的错只有 CI 的 tsc 知道——发布后留意那次构建。
      </p>

      <ContentForm
        // loaderData 变了就重建，让 useState 重新初始化。比在 effect 里
        // 手动 setDraft 可靠——那种写法要自己判断"什么时候该覆盖用户正在
        // 打的字"。三段缺一不可，见 contentFormKey 的长注释：尤其是
        // file.key——不同文件的 sha 通常不同、能"碰巧"挡住串档，但那不是
        // 保证，两份内容相同的文件 sha 就会相同。
        key={contentFormKey(file.key, file.sha, staged !== undefined)}
        file={file}
        spec={spec}
        initial={staged ?? (file.data as Draft)}
        onNotice={(text) => setNotice({ fileKey: file.key, text })}
      />

      {notice?.fileKey === file.key ? <p className="dash-notice">{notice.text}</p> : null}
    </section>
  );
}
