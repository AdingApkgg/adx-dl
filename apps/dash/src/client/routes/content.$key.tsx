import { useState } from "react";

import { findContentFile, validateContentFile } from "@astrodx/content-schema";

import { LinkEntryFields } from "../components/link-entry-fields";
import { api } from "../lib/api";
import { errorsByPath, replaceEntry, type LinkEntryDraft } from "../lib/content-draft";
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

export default function ContentFile({ loaderData }: Route.ComponentProps) {
  const { file, staged } = loaderData;
  const spec = findContentFile(file.key);

  // ↓ 表单主体：状态、暂存逻辑、渲染，从这里到函数末尾是一个整体。Task 7
  // 会把这一段整个抽成独立的 ContentForm 组件，好让外层用 key 控制何时
  // 重建状态（增删条目之后重置、或者切换到另一份暂存）——抽取时按这个
  // 边界直接剪过去就行，不要把状态或渲染拆散到这段之外。
  const [draft, setDraft] = useState<Draft>(() => structuredClone(staged ?? (file.data as Draft)));
  const [errors, setErrors] = useState<Map<string, string[]>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  if (!spec) return <p className="dash-notice dash-notice--bad">没有这个内容文件</p>;

  const stage = () => {
    // 只喂客户端这次自己跑出来的 errors——绝不能喂服务端 commit 失败时
    // 回的 errors（那份消息前面冠了文件标题，errorsByPath 会切错路径，
    // 见 content-draft.ts 顶部的长注释）。
    const result = validateContentFile(file.key, draft);
    if (!result.ok) {
      setErrors(errorsByPath(result.errors));
      setNotice(`还有 ${result.errors.length} 处要改`);
      return;
    }
    setErrors(new Map());
    const storage = globalThis.localStorage ?? null;
    saveStaging(stageFile(loadStaging(storage), file.key, draft, file.sha, Date.now()), storage);
    setNotice("已暂存，到顶部点「发布」才会提交");
  };

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

      {spec.arrays.map((array) => (
        <fieldset key={array.key} className="dash-array">
          <legend>{array.key}</legend>
          {(draft[array.key] ?? []).map((entry, index) => (
            // key={index} 是对的：条目没有稳定 id，增删移都靠重建整个
            // 数组完成（Task 7）。不要换成 key={entry.url}——那正是用户
            // 正在编辑的字段，一变就会让输入框失焦。
            <LinkEntryFields
              key={index}
              entry={entry}
              path={`${array.key}[${index}]`}
              errors={errors}
              onChange={(next) =>
                setDraft({ ...draft, [array.key]: replaceEntry(draft[array.key], index, next) })
              }
            />
          ))}
        </fieldset>
      ))}

      {notice ? <p className="dash-notice">{notice}</p> : null}
      <button type="button" onClick={stage}>
        暂存改动
      </button>
    </section>
  );
}
