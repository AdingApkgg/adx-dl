import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/overview.tsx"),
  route("actions", "routes/actions.tsx"),
  route("actions/:runId", "routes/actions.$runId.tsx"),
] satisfies RouteConfig;
