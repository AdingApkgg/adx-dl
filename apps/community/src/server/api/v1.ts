import { governanceRoutes } from "./governance";
import {discoveryRoutes} from "./discovery";
import {downloadPlanRoutes} from "./download-plans";
import { libraryRoutes,publicListRoutes,dashLibraryRoutes } from "./library";
import { followingRoutes } from "./following";
import {communitySiteRoutes} from "./community-site";
import {discussionRoutes} from "./discussions";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { fileRoutes } from "./files";
import { avatarRoutes } from "./avatar";
import { uploadRoutes } from "./uploads";
import { favoriteRoutes, myReportRoutes } from "./community-social";
import { dashRoutes } from "./dash";
import { meRoutes } from "./me";
import { userRoutes } from "./users";
import { publicChartRoutes } from "./public-charts";
import { chartRoutes } from "./charts";

// 必须链式定义：Hono RPC 从链式调用的返回类型里推导出每个接口的类型。
export const apiV1 = new Hono<AppEnv>()
  .get("/meta", (c) => c.json({ name: "astrodx-community", apiVersion: 1 as const }))
  // 登录页的配置：Turnstile 站点密钥、QQ 登录能不能用。不要求登录。
  .get("/login-options", async (c) => c.json(await c.get("services").loginOptions()))
  .route("/", discoveryRoutes)
  .route("/download-plans", downloadPlanRoutes)
  .route("/me/lists", libraryRoutes)
  .route("/lists", publicListRoutes)
  .route("/dash/lists", dashLibraryRoutes)
  .route("/site", communitySiteRoutes)
  .route("/discussions", discussionRoutes)
  .route("/me/following", followingRoutes)
  .route("/dash", dashRoutes)
  .route("/governance", governanceRoutes)
  .route("/uploads", uploadRoutes)
  .route("/files", fileRoutes)
  .route("/me/avatar", avatarRoutes)
  .route("/me/charts", chartRoutes)
  .route("/me/favorites", favoriteRoutes)
  .route("/me/reports", myReportRoutes)
  .route("/charts", publicChartRoutes)
  .route("/me", meRoutes)
  // 个人主页的公开资料（spec 第 10.5 节），不要求登录。
  .route("/users", userRoutes);

export const apiRoutes = new Hono<AppEnv>().route("/api/v1", apiV1);
