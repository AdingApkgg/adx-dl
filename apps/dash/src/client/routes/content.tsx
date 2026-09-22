import { Outlet } from "react-router";

export default function ContentLayout() {
  return (
    <main className="dash-shell">
      <h1>内容编辑</h1>
      <Outlet />
    </main>
  );
}
