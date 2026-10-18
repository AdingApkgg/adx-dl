import { z } from "zod";
const uuid = z.string().uuid(), userId = z.string().min(1).max(128), at = z.string().datetime();
const revision = z.number().int().min(1).max(2147483647);
const base = { version: z.literal(1), revision };
const follow = z.object({ ...base, entity: z.literal("follow"), id: uuid, userId, authorId: userId,
  followedAt: at.nullable(), notifySince: at.nullable(), updatedAt: at }).strict()
  .refine(f => f.userId !== f.authorId && (!f.notifySince || !!f.followedAt && f.notifySince >= f.followedAt));
const account = z.object({ ...base, entity: z.literal("account"), id: userId, cutoffAt: at }).strict();
const publication = z.object({ version: z.literal(1), revision: z.literal(1), entity: z.literal("publication"), id: uuid,
  chartId: uuid, versionId: uuid, authorId: userId.nullable(), occurredAt: at,
  permissionSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), notify: z.boolean() }).strict();
const notification = z.object({ ...base, entity: z.literal("notification"), id: uuid, userId, authorId: userId.nullable(),
  eventId: uuid, eventAt: at, createdAt: at, readAt: at.nullable() }).strict();
/** Only the encrypted operator journal may export these facts; never public community_content. */
export const privateSocialFact = z.union([follow, account, publication, notification]);
export type PrivateSocialFact = z.infer<typeof privateSocialFact>;
export type PrivateFollowFact = z.infer<typeof follow>;
export type PrivateNotificationFact = z.infer<typeof notification>;
