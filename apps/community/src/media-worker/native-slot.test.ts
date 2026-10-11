import { expect, test } from "bun:test";
import { withNativeSlot } from "./native-slot";
test("avatar and chart share capacity until the owned operation reaps; abort and failure release it",async()=>{
  let release!:()=>void;
  const held = new Promise<void>(resolve=>{release=resolve;});
  const controller = new AbortController();
  const avatar = withNativeSlot(async()=>{await held;return "avatar";},controller.signal);
  controller.abort();
  await expect(withNativeSlot(async()=>"chart")).rejects.toMatchObject({code:"STORAGE_BUSY"});
  release(); expect(await avatar).toBe("avatar");
  await expect(withNativeSlot(async()=>{throw new Error("child failed");})).rejects.toThrow("child failed");
  expect(await withNativeSlot(async()=>"chart")).toBe("chart");
});
