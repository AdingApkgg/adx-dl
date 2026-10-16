import { z } from "zod";
import { isPublicUserId } from "./user-public-id";

/** Permanent URL reservation only; never contains a name or revives an account. */
export const userPublicIdFact = z.object({
  version: z.literal(1),
  publicId: z.string().refine(isPublicUserId),
}).strict();
export type UserPublicIdFact = z.infer<typeof userPublicIdFact>;
