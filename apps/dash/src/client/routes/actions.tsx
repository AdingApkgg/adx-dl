import { useEffect, useEffectEvent, useState } from "react";
import { Link, useRevalidator } from "react-router";

import { api } from "../lib/api";
import { runDuration, statusLabel, statusTone } from "../lib/run-format";
import type { Route } from "./+types/actions";

/**
 * CONNECTING 状态下连续重试失败多久之后，也当成「值得打扰操作员」处理。
 *
 * 单次 CONNECTING 不值得报——EventSource 断线重连是常态（隧道抖一下、
 * 服务进程重启几秒），默认约 3 秒后就会自己再试一次。但如果重试持续
 * 失败超过这个阈值，说明不是抖了一下，而是隧道/服务进程真的起不来——
 * 这种情况下面板一样会静默冻结，操作员应该知道，而不是无限相信"浏览器
 * 在重试所以迟早会好"。30 秒足够滤掉"抖一下"，也没长到让操作员在一个
 * 冻结的面板前干等太久。
 */
const DEGRADED_AFTER_MS = 30_000;

type StreamIssue = "closed" | "degraded" | null;
type Notice = { kind: "ok" | "bad"; message: string };

export async function clientLoader() {
  const [workflows, runs, me, branches] = await Promise.all([
    api.workflows(),
    api.runs(),
    api.me(),
    api.branches(),
  ]);
  return { workflows, runs, me, branches };
}

export default function Actions({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [streamIssue, setStreamIssue] = useState<StreamIssue>(null);
  // 只在挂载时取一次默认分支做初始值——之后哪怕 loaderData 因为别的
  // revalidate 更新了，也不该把操作员已经选好的分支从下面拽走。
  const [ref, setRef] = useState(() => loaderData.me.repo?.defaultBranch ?? "");

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
    // 记录"当前这一串连续失败"是否已经挂了一个 DEGRADED_AFTER_MS 计时器；
    // 每次 open 成功都清零，避免同一串失败里重复排计时器，也避免中间某次
    // 恰好成功之后，旧计时器还在悬着，过一会儿冷不丁地把提示弹出来。
    let retrying = false;
    let degradedTimer: number | null = null;

    const clearDegradedTimer = () => {
      if (degradedTimer !== null) {
        window.clearTimeout(degradedTimer);
        degradedTimer = null;
      }
    };

    source.addEventListener("runs", () => {
      onRunsEvent();
    });

    source.addEventListener("open", () => {
      retrying = false;
      clearDegradedTimer();
      setStreamIssue(null);
    });

    source.addEventListener("error", () => {
      // readyState 是这里唯一能区分"还在重试"和"彻底死了"的信号：
      // EventSource 的重连算法规定，只要重连时拿到的响应状态码不是 2xx，
      // 或者 content-type 不是 text/event-stream，就直接判定连接失败、
      // 把 readyState 钉在 CLOSED，且不再自动重试——Access 会话过期后
      // 重连撞见登录页（无论是重定向落地页还是直接 200 HTML）正好落进
      // 这条规则。这种情况必须立刻提示，不等：浏览器不会再自己恢复了。
      if (source.readyState === EventSource.CLOSED) {
        clearDegradedTimer();
        setStreamIssue("closed");
        return;
      }

      // 走到这里 readyState 只可能是 CONNECTING——浏览器还在自动重试，
      // 单次抖动不值得打扰操作员，但持续失败要有个说法（见上面
      // DEGRADED_AFTER_MS 的注释）。
      if (!retrying) {
        retrying = true;
        degradedTimer = window.setTimeout(() => {
          setStreamIssue("degraded");
        }, DEGRADED_AFTER_MS);
      }
    });

    return () => {
      clearDegradedTimer();
      source.close();
    };
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
      setNotice({ kind: "ok", message: `${label}已提交，等待 GitHub 接手` });
      revalidator.revalidate();
    } catch (error) {
      setNotice({
        kind: "bad",
        message: `${label}失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dash-shell">
      <h1>Actions</h1>

      {streamIssue ? (
        <p className="dash-notice dash-notice--bad" role="alert">
          {streamIssue === "closed"
            ? "实时更新已断开，很可能是登录会话已过期——下面的列表可能不是最新的。"
            : "实时更新连接不稳定，重连已经持续失败超过 30 秒——下面的列表可能不是最新的。"}{" "}
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </p>
      ) : null}

      <section className="dash-toolbar">
        <label className="dash-branch-select">
          分支
          <select value={ref} onChange={(event) => setRef(event.target.value)}>
            {loaderData.branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        {loaderData.workflows.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            disabled={busy}
            onClick={() => act(`触发「${workflow.name}」`, () => api.dispatch(workflow.id, ref))}
          >
            触发 {workflow.name}
          </button>
        ))}
      </section>

      {notice ? <p className={`dash-notice dash-notice--${notice.kind}`}>{notice.message}</p> : null}

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
