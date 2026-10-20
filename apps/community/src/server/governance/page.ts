import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { UUID_PATTERN } from "../uuid";
export function governancePage(input:{cursor?:string},identity:string){
 const scope=createHash("sha256").update(identity).digest("hex");let cursor:{at:string;id:string;source:string}|undefined;
 if(input.cursor!==undefined){try{
  if(input.cursor.length>4096||! /^[A-Za-z0-9_-]+$/.test(input.cursor))throw new Error();
  const c=JSON.parse(Buffer.from(input.cursor,"base64url").toString());
  if(!c||Object.keys(c).sort().join()!=="at,id,scope,source"||c.scope!==scope||typeof c.at!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(c.at)||!Number.isFinite(Date.parse(c.at))||new Date(c.at).toISOString().slice(0,19)!==c.at.slice(0,19)||typeof c.id!=="string"||!UUID_PATTERN.test(c.id)||typeof c.source!=="string"||! /^[a-z_]{1,32}$/.test(c.source))throw new Error();
  cursor={at:c.at,id:c.id,source:c.source};
 }catch{throw new HTTPException(400,{message:"Invalid governance cursor"});}}
 return {cursor,condition:(at:SQL,id:SQL,source:SQL)=>cursor?sql`(${at},${id},${source})<(${cursor.at}::timestamptz,${cursor.id}::uuid,${cursor.source}::text)`:sql`true`,encode:(at:string,id:string,source:string)=>Buffer.from(JSON.stringify({at,id,source,scope})).toString("base64url")};
}
// PostgreSQL has microsecond precision. Do not round cursor timestamps through JS Date.
export const governanceStamp=(column:SQL)=>sql<string>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
