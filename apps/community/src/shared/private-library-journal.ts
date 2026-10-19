import { z } from "zod";
import { libraryDraft,libraryId,libraryPublicId,libraryPublication } from "./library";
const revision=z.number().int().min(1).max(2147483647),userId=z.string().min(1).max(128),at=z.string().datetime();
const list=z.object({version:z.literal(1),entity:z.literal("list"),id:libraryId,userId,revision,publicId:libraryPublicId.nullable(),draft:libraryDraft.nullable(),publication:libraryPublication.nullable(),deleted:z.boolean(),createdAt:at,updatedAt:at}).strict().refine(f=>f.deleted?f.draft===null&&f.publication===null:f.draft!==null).refine(f=>!f.publication||f.publication.publicId===f.publicId&&f.publication.revision<=f.revision);
const control=z.object({version:z.literal(1),entity:z.literal("list_control"),id:libraryId,revision,actorId:userId,hidden:z.boolean(),publicationRevision:revision,reason:z.string().min(1).refine(s=>[...s].length<=500&&!/[\p{Cc}\p{Cf}]/u.test(s)),createdAt:at}).strict();
const account=z.object({version:z.literal(1),entity:z.literal("library_account"),id:userId,revision,cutoffAt:at}).strict();
/** Encrypted operator-only journal; private list text and membership never enter public facts. */
export const privateLibraryFact=z.union([list,control,account]);
export type PrivateLibraryFact=z.infer<typeof privateLibraryFact>;
export type PrivateListFact=z.infer<typeof list>;
export type LibraryControlFact=z.infer<typeof control>;
