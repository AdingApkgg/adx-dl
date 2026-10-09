import { Link } from "react-router";

import { api } from "../lib/api";
import type { Route } from "./+types/content._index";

export async function clientLoader() {
  return api.contentFiles();
}

export default function ContentIndex({ loaderData }: Route.ComponentProps) {
  return (
    <ul className="dash-content-list">
      {loaderData.map((file) => (
        <li key={file.key}>
          <Link to={`/content/${file.key}`}>{file.title}</Link>
          <code>{file.path}</code>
        </li>
      ))}
    </ul>
  );
}
