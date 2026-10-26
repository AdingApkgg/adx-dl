import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "bun:test";

// 故障注入：验证 exerciseMotion 失败后仍逐项清理、保留首次错误。
const ACCEPTANCE = new URL("../acceptance/", import.meta.url);

type EmulateOptions = {reducedMotion: string};
type Exercise = (input: {page: FakePage; origin: string; authenticated?: boolean}) => Promise<void>;
type FakePage = {
 setViewportSize(size: {width: number; height: number}): Promise<void>;
 goto(path: string): Promise<{status(): number}>;
 locator(selector: string): {first(): {waitFor(): Promise<void>}};
 evaluate(fn: unknown, arg?: unknown): Promise<null>;
 emulateMedia(options: EmulateOptions): Promise<void>;
 getByRole(role: string, options?: unknown): {filter(options?: unknown): {click(): Promise<void>}};
};

// 最小 fake page：前置全部成功，第一次 emulateMedia 抛 primary，恢复 choose 的点击抛 restore。
function makeFakePage(){
 const calls: {emulate: string[]; evaluate: number; openSettingsClick: number} = {emulate: [], evaluate: 0, openSettingsClick: 0};
 const primary = new Error("PRIMARY_SENTINEL");
 const restore = new Error("RESTORE_SENTINEL");
 let emulateCount = 0;
 const page: FakePage = {
  async setViewportSize(){},
  async goto(){return {status: () => 200};},
  locator(){return {first: () => ({waitFor: async () => {}})};},
  async evaluate(){calls.evaluate++; return null;},
  async emulateMedia(options){calls.emulate.push(options.reducedMotion); emulateCount++; if(emulateCount === 1) throw primary;},
  getByRole(){return {filter: () => ({click: async () => {calls.openSettingsClick++; throw restore;}})};},
 };
 return {page, calls, primary};
}

// 从正式 smoke 源码提取真实内嵌 exerciseMotion，不导入整个 smoke 以免触发浏览器。
function loadInline(): Exercise {
 const source = readFileSync(new URL("production-smoke.mjs", ACCEPTANCE), "utf8");
 const start = source.indexOf("async function exerciseMotion(");
 const end = source.indexOf("async function exerciseMotionPlayer(", start);
 assert.ok(start >= 0 && end > start, "inline exerciseMotion anchors");
 const body = source.slice(start, end);
 return new Function("assert", `${body}\nreturn exerciseMotion;`)(assert) as Exercise;
}

async function runCase(exerciseMotion: Exercise, label: string){
 const {page, calls, primary} = makeFakePage();
 let error: unknown;
 try{await exerciseMotion({page, origin: "https://example.test"});}catch(caught){error = caught;}
 assert.ok(error, `${label}: expected rejection`);
 assert.equal(error, primary, `${label}: primary error preserved`);
 assert.equal(calls.openSettingsClick, 1, `${label}: restore choose attempted`);
 assert.ok(calls.evaluate >= 2, `${label}: localStorage restore attempted`);
 assert.equal(calls.emulate.at(-1), "no-preference", `${label}: OS cleanup attempted`);
}

test("canonical exerciseMotion preserves primary error and still cleans up", async () => {
 const {exerciseMotion} = await import(new URL("motion-browser.mjs", ACCEPTANCE).href) as {exerciseMotion: Exercise};
 await runCase(exerciseMotion, "canonical");
});

test("inline production-smoke exerciseMotion preserves primary error and still cleans up", async () => {
 await runCase(loadInline(), "inline");
});
