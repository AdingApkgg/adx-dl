import { expect, test } from "bun:test";
import { appealInputSchema, appealResolutionSchema, governanceQuerySchema } from "@/shared/governance";
import { governancePage } from "./page";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("appeal text counts Unicode codepoints, rejects controls and unknown fields", () => {
 expect(appealInputSchema.parse({decisionKey:`decision:${id}`,reason:" 😀 "}).reason).toBe("😀");
 expect(appealInputSchema.safeParse({decisionKey:`decision:${id}`,reason:"😀".repeat(1000)}).success).toBe(true);
 for (const reason of [" ","x\u0000y","x".repeat(1001)]) expect(appealInputSchema.safeParse({decisionKey:`decision:${id}`,reason}).success).toBe(false);
 expect(appealInputSchema.safeParse({decisionKey:`decision:${id}`,reason:"ok",userId:"other"}).success).toBe(false);
 expect(appealResolutionSchema.safeParse({expectedRevision:0,status:"upheld",note:"ok"}).success).toBe(false);
 expect(appealResolutionSchema.safeParse({expectedRevision:1,status:"review_required",note:"ok"}).success).toBe(true);
});
test("governance cursors preserve microseconds, ID and source and reject a different filter scope", () => {
 const first = governancePage({}, "tickets:open:all"), at="2026-10-20T00:00:00.123456Z";
 const cursor=first.encode(at,id,"discussion");
 expect(governancePage({cursor},"tickets:open:all").cursor).toEqual({at,id,source:"discussion"});
 expect(()=>governancePage({cursor},"tickets:resolved:all")).toThrow();
 expect(()=>governancePage({cursor:"x".repeat(4097)},"tickets:open:all")).toThrow();
 expect(governanceQuerySchema.safeParse({source:"private",status:"all"}).success).toBe(false);
});
