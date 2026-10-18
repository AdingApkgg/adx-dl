import { z } from "zod";
import { isPublicChartId } from "./chart-public-id";
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_:.-]+$/);
export const communityContentFact = z.object({
  version: z.literal(1),
  entity: z.enum(["message", "topic", "notice", "topic_control", "board_control", "forum_id", "featured"]),
  id, revision: z.number().int().min(1).max(2147483647),
  state: z.enum(["visible", "hidden", "deleted", "root_removed", "control", "allocated"]),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), authorId: z.string().min(1).max(128).optional(),
  publicId: z.string().refine(isPublicChartId).optional(),
  controls: z.object({ locked: z.boolean().optional(), board: id.optional(), pin: z.number().int().min(0).max(3).optional(),
    readOnly: z.boolean().optional(), removedRoot: z.boolean().optional(), featured: z.array(z.string().refine(isPublicChartId)).max(6).optional(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.state === "visible" && !value.hash) ctx.addIssue({code:"custom",message:"Visible content needs hash"});
  if (value.entity === "forum_id" && (value.state !== "allocated" || !value.publicId)) ctx.addIssue({code:"custom",message:"Invalid identity"});
});
export type CommunityContentFact = z.infer<typeof communityContentFact>;
