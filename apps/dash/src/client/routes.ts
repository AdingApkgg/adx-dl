import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/overview.tsx"),
  route("actions", "routes/actions.tsx"),
  route("actions/:runId", "routes/actions.$runId.tsx"),
  route("content", "routes/content.tsx", [
    index("routes/content._index.tsx"),
    route(":key", "routes/content.$key.tsx"),
  ]),
] satisfies RouteConfig;
