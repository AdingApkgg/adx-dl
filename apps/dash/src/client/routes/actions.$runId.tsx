import { Link } from "react-router";

import { api } from "../lib/api";
import { stepDuration } from "../lib/run-format";
import type { Route } from "./+types/actions.$runId";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const runId = Number(params.runId);
  const [detail, failureLog] = await Promise.all([
    api.run(runId),
    // 日志只在失败时才有；这里拿不到不是错误。
    api.failureLog(runId).catch(() => null),
  ]);
  return { detail, failureLog };
}

export default function RunDetailPage({ loaderData }: Route.ComponentProps) {
  const { detail, failureLog } = loaderData;

  return (
    <main className="dash-shell">
      <p>
        <Link to="/actions">← 返回列表</Link>
      </p>
      <h1>
        #{detail.run.runNumber} {detail.run.name}
      </h1>
      <p className="dash-muted">
        {detail.run.event} · {detail.run.branch} · {detail.run.sha.slice(0, 7)} ·{" "}
        <a href={detail.run.htmlUrl} target="_blank" rel="noreferrer">
          在 GitHub 打开
        </a>
      </p>

      {failureLog ? (
        <section className="dash-failure">
          <h2>
            失败于 {failureLog.jobName} / {failureLog.stepName}
          </h2>
          <pre>{failureLog.lines.join("\n")}</pre>
        </section>
      ) : null}

      {detail.jobs.map((job) => (
        <section key={job.id}>
          <h2>{job.name}</h2>
          <table className="dash-table">
            <thead>
              <tr>
                <th>步骤</th>
                <th>结果</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              {job.steps.map((step) => (
                <tr key={step.number}>
                  <td>{step.name}</td>
                  <td>{step.conclusion ?? step.status}</td>
                  <td>{stepDuration(step)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
