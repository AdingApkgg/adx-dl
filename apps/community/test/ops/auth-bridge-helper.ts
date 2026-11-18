import { readFileSync } from "node:fs";
import { join } from "node:path";

// Exercise the real transport function without importing the session issuer and
// its database/storage graph into the shared integration-test process.
const source = readFileSync(join(import.meta.dir, "../../ops/acceptance/auth-bridge.ts"), "utf8");
const start = source.indexOf("type UpstreamRead =");
const end = source.indexOf("async function main()");
if (start < 0 || end < start) throw new Error("readonly transport anchors not found");
const compiled = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(source.slice(start, end));
type Options = Omit<RequestInit, "signal"> & { proxy?: string; decompress: false };
type Read = (input: string, init: RequestInit & { proxy?: string; decompress: false }) => Promise<Response>;
export const fetchReadonlyPublic = new Function(`${compiled}\nreturn fetchReadonlyPublic;`)() as (input: string, init: Options, read?: Read, deadlineMs?: number) => Promise<Response>;
