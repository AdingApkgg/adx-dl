import { Link } from "react-router";

import { api } from "../lib/api";
import type { Route } from "./+types/overview";

export async function clientLoader() {
  return api.me();
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  return (
    <main className="dash-shell">
      <h1>AstroDX dash</h1>
      <dl className="dash-facts">
        <dt>登录身份</dt>
        <dd>{loaderData.email}</dd>
        <dt>目标仓库</dt>
        <dd>
          {loaderData.repo
            ? `${loaderData.repo.owner}/${loaderData.repo.repo}（默认分支 ${loaderData.repo.defaultBranch}）`
            : `连接失败：${loaderData.repoError}`}
        </dd>
      </dl>
      <p>
        <Link to="/actions">查看 Actions →</Link>
      </p>
    </main>
  );
}
