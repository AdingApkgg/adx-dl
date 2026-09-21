import { useEffect, useEffectEvent, useState } from "react";
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
  //
  // 连接只应该在这个组件挂载时开一次、卸载时关一次——但 revalidator 本身
  // 不是一个能放心放进依赖数组的值：react-router 的 useRevalidator() 每次
  // revalidate() 都会把 router 的 revalidation 状态从 idle 甩到 loading
  // 再甩回 idle，每一次甩动都让 useRevalidator() 返回一个新对象（哪怕
  // revalidate 这个函数本身从来没变过）。而"runs" 事件恰好就是触发
  // revalidate() 的原因——如果拿 revalidator 当依赖，这个连接会在 run
  // 正在跑、最需要它保持在线的时候，被自己收到的每一条事件反复拆掉重连，
  // 中间还会留出一个"旧连接已关、新连接未开"的窗口，事件可能在这个窗口
  // 里被漏掉。用 useEffectEvent 读最新的 revalidator，让下面这个 effect
  // 的依赖数组保持空——它只关心"组件是否还活着"，不关心 revalidator 变没变。
  const onRunsEvent = useEffectEvent(() => {
    revalidator.revalidate();
  });

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("runs", () => {
      onRunsEvent();
    });
    return () => source.close();
  }, []);

  const act = async (label: string, fn: () => Promise<void>) => {
    // disabled={busy} 只挡得住"React 已经重新渲染过"之后的点击；两次点击
    // 落在同一个渲染帧里时，DOM 属性还没来得及更新，第二次点击照样会跑
    // 进这里。这几个按钮背后是真的 dispatch/rerun/cancel，会在活的仓库上
    // 启动/打断真实的 CI——不能只靠 DOM 属性兜底，这里要挡一次。
    if (busy) return;
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
