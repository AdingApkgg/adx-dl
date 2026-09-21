import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";

import { api } from "../lib/api";
import { runDuration, statusLabel, statusTone } from "../lib/run-format";
import type { Route } from "./+types/actions";

export async function clientLoader() {
  const [workflows, runs] = await Promise.all([api.workflows(), api.runs()]);
  return { workflows, runs };
}

export default function Actions({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 后端已经在轮询 GitHub 了，这里只是订阅它的结论，不再各自轮询一遍。
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("runs", () => {
      revalidator.revalidate();
    });
    return () => source.close();
  }, [revalidator]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice(`${label}已提交，等待 GitHub 接手`);
      revalidator.revalidate();
    } catch (error) {
      setNotice(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dash-shell">
      <h1>Actions</h1>

      <section className="dash-toolbar">
        {loaderData.workflows.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            disabled={busy}
            onClick={() => act(`触发「${workflow.name}」`, () => api.dispatch(workflow.id))}
          >
            触发 {workflow.name}
          </button>
        ))}
      </section>

      {notice ? <p className="dash-notice">{notice}</p> : null}

      <table className="dash-table">
        <thead>
          <tr>
            <th>#</th>
            <th>工作流</th>
            <th>状态</th>
            <th>触发源</th>
            <th>耗时</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {loaderData.runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link to={`/actions/${run.id}`}>{run.runNumber}</Link>
              </td>
              <td>{run.name}</td>
              <td>
                <span className={`dash-pill dash-pill--${statusTone(run)}`}>{statusLabel(run)}</span>
              </td>
              <td>{run.event}</td>
              <td>{runDuration(run)}</td>
              <td className="dash-row-actions">
                {run.status === "completed" ? (
                  <button type="button" disabled={busy} onClick={() => act("重跑", () => api.rerun(run.id))}>
                    重跑
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => act("取消", () => api.cancel(run.id))}>
                    取消
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
