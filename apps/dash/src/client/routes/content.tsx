import { useState } from "react";
import { Link, Outlet, useRevalidator } from "react-router";

import { CONTENT_FILES } from "@astrodx/content-schema";

import { api, ApiError } from "../lib/api";
import { loadStaging, pendingKeys, saveStaging, unstageFile } from "../lib/content-staging";
import type { Route } from "./+types/content";

function titleOf(key: string): string {
  return CONTENT_FILES.find((file) => file.key === key)?.title ?? key;
}

/**
 * 暂存区从 loader 读，不放 useState。
 *
 * 表单页在子路由里写 localStorage，这个布局要跟着变。useState 的初始化函数
 * 只跑一次，`revalidate()` 也不会重跑它——顶部计数会一直停在进页面那一刻的
 * 数字。走 loader 就对了：`revalidate()` 会重跑包括祖先在内的所有活跃 loader，
 * 子路由暂存完调一次，这里自然拿到新值。
 */
export async function clientLoader() {
  return loadStaging(globalThis.localStorage ?? null);
}

export default function ContentLayout({ loaderData }: Route.ComponentProps) {
  const storage = globalThis.localStorage ?? null;
  const staging = loaderData;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; conflicts: string[] } | null>(null);
  const revalidator = useRevalidator();

  const pending = pendingKeys(staging);
  const defaultMessage = `content: 更新 ${pending.map(titleOf).join("、")}`;

  const publish = async () => {
    // 见 actions.tsx 的同类处理：连点两下「发布」会发出两个 commit 请求，
    // 第二个大概率因为第一个已经改了 sha 而撞 409，但消息会让人以为是别人
    // 动了仓库。入口处直接挡住。
    if (busy || pending.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await api.commitContent({
        message: (message.trim() || defaultMessage).trim(),
        files: pending.map((key) => ({
          key,
          data: staging[key].data,
          baseSha: staging[key].baseSha,
        })),
      });
      // 提交成功才清暂存。清早了，一次网络抖动就等于把刚打完的文案扔了。
      saveStaging({}, storage);
      revalidator.revalidate();
      setMessage("");
      setResult({ ok: true, text: `已提交 ${response.commitSha.slice(0, 7)}，主站构建已触发`, conflicts: [] });
    } catch (error) {
      const conflicts =
        error instanceof ApiError && Array.isArray(error.detail.conflictPaths)
          ? (error.detail.conflictPaths as string[])
          : [];
      const errors =
        error instanceof ApiError && Array.isArray(error.detail.errors) ? (error.detail.errors as string[]) : [];
      setResult({
        ok: false,
        text: errors.length > 0 ? errors.join("；") : error instanceof Error ? error.message : String(error),
        conflicts,
      });
    } finally {
      setBusy(false);
    }
  };

  const discard = (key: string) => {
    if (!window.confirm(`丢弃「${titleOf(key)}」的改动？`)) return;
    saveStaging(unstageFile(staging, key), storage);
    // 重跑 loader：这个布局的暂存计数、以及子路由表单页里那份草稿，
    // 两边都要按 localStorage 的新状态重读。
    revalidator.revalidate();
  };

  return (
    <main className="dash-shell">
      <h1>内容编辑</h1>

      <section className="dash-staging" aria-live="polite">
        <p>
          待发布改动：<strong>{pending.length}</strong>
          {pending.length > 0 ? (
            <>
              （
              {/* 每个待发布文件都链到它的编辑页——这正是 Step 0b 修的那个
                  坑会被触发的主路径：点这里从一个 :key 切到另一个，同一个
                  路由只有路径参数变了，组件不会卸载重挂载。 */}
              {pending.map((key, index) => (
                <span key={key}>
                  {index > 0 ? "、" : null}
                  <Link to={`/content/${key}`}>{titleOf(key)}</Link>
                </span>
              ))}
              ）
            </>
          ) : null}
        </p>
        {pending.length > 0 ? (
          <>
            <label>
              <span>提交信息</span>
              <input value={message} placeholder={defaultMessage} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <button type="button" onClick={publish} disabled={busy}>
              {busy ? "提交中…" : `发布这 ${pending.length} 处改动`}
            </button>
            {/* 每次发布都会触发一轮数分钟的主站部署，所以把代价写在按钮旁边。 */}
            <p className="dash-muted">一次发布 = 一个 commit = 一轮完整部署（数分钟）。</p>
          </>
        ) : null}

        {result ? (
          <div className={result.ok ? "dash-notice dash-notice--ok" : "dash-notice dash-notice--bad"} role="status">
            <p>{result.text}</p>
            {result.conflicts.length > 0 ? (
              <>
                <p>这些文件在仓库里已被改过，你的草稿还留着：</p>
                <ul>
                  {result.conflicts.map((path) => {
                    const file = CONTENT_FILES.find((candidate) => candidate.path === path);
                    return (
                      <li key={path}>
                        {file?.title ?? path}
                        {file ? (
                          <button type="button" onClick={() => discard(file.key)}>
                            丢弃我的改动，用仓库最新版重来
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <Outlet />
    </main>
  );
}
