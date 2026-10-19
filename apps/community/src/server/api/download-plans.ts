import {Hono} from "hono";
import {HTTPException} from "hono/http-exception";
import {downloadPlanInput} from "@/shared/downloads";
import type {AppEnv} from "../app-env";
import {socialStorage} from "./community-social";
import {createPublicDownloadPlan} from "../charts/publication";
/** Read-only bounded plan, never a download authorization token or persistent history. */
export const downloadPlanRoutes=new Hono<AppEnv>().post('/',async c=>{c.header('cache-control','private, no-store');let input:unknown;try{input=await c.req.json();}catch{throw new HTTPException(400);}const parsed=downloadPlanInput.safeParse(input);if(!parsed.success)throw new HTTPException(400);return c.json(await createPublicDownloadPlan(socialStorage(c),parsed.data.publicIds));});
