import { and, eq, isNull, notExists, or, sql } from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";
import {
  blobs,
  files,
  blobDerivatives,
  derivedObjects,
  blobBlocks,
  user,
  userAvatars,
} from "../db/schema";
import type { DbTransaction } from "./contracts";
import type { Db } from "../db/client";
export type ReferenceDb = Db | DbTransaction;
/** A module must pair all three decisions with its account-deletion registration. Task8 binds storage. */
export type FileReference = {
  name: string;
  referenceTable: PgTable;
  deletionPartner: string;
  references(db: ReferenceDb, fileId: string): Promise<boolean>;
  publicRepresentations(db: ReferenceDb, outputSha256: string): Promise<boolean>;
  retention(db: ReferenceDb, fileId: string): Promise<boolean>;
};
export function registerFileReferences(
  entries: readonly FileReference[],
): readonly FileReference[] {
  const names = new Set<string>(),
    tables = new Set<string>();
  for (const e of entries) {
    const table = getTableConfig(e.referenceTable).name;
    if (
      !e.name ||
      !e.deletionPartner ||
      typeof e.references !== "function" ||
      typeof e.publicRepresentations !== "function" ||
      typeof e.retention !== "function" ||
      names.has(e.name) ||
      tables.has(table)
    )
      throw new Error("Incomplete or duplicate file reference registration");
    names.add(e.name);
    tables.add(table);
  }
  return Object.freeze([...entries]);
}
async function avatarReference(db: ReferenceDb, fileId: string) {
  return (
    (
      await db
        .select({ id: userAvatars.userId })
        .from(userAvatars)
        .where(eq(userAvatars.fileId, fileId))
        .limit(1)
    ).length > 0
  );
}
export const FILE_REFERENCES = registerFileReferences([
  {
    name: "avatar",
    referenceTable: userAvatars,
    deletionPartner: "storage",
    references: avatarReference,
    retention: avatarReference,
    async publicRepresentations(db, hash) {
      const block = db
        .select({ one: sql`1` })
        .from(blobBlocks)
        .where(
          or(
            eq(blobBlocks.sha256, blobs.sha256),
            eq(blobBlocks.sha256, derivedObjects.outputSha256),
          ),
        );
      return (
        (
          await db
            .select({ id: userAvatars.userId })
            .from(userAvatars)
            .innerJoin(user, eq(user.id, userAvatars.userId))
            .innerJoin(files, eq(files.id, userAvatars.fileId))
            .innerJoin(blobs, eq(blobs.id, files.blobId))
            .innerJoin(
              blobDerivatives,
              and(
                eq(blobDerivatives.id, userAvatars.derivativeId),
                eq(blobDerivatives.sourceBlobId, blobs.id),
              ),
            )
            .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId))
            .where(
              and(
                eq(derivedObjects.outputSha256, hash),
                eq(user.status, "active"),
                isNull(userAvatars.suspendedAt),
                eq(files.state, "ready"),
                eq(files.purpose, "avatar"),
                eq(files.ownerId, user.id),
                eq(blobs.state, "ready"),
                eq(blobDerivatives.state, "ready"),
                eq(blobDerivatives.recipe, "avatar-v1"),
                eq(derivedObjects.state, "ready"),
                notExists(block),
              ),
            )
            .limit(1)
        ).length > 0
      );
    },
  },
]);
export async function hasFileReferences(db: ReferenceDb, id: string, registry = FILE_REFERENCES) {
  for (const e of registry) if (await e.references(db, id)) return true;
  return false;
}
export async function hasPublicRepresentation(
  db: ReferenceDb,
  hash: string,
  registry = FILE_REFERENCES,
) {
  for (const e of registry) if (await e.publicRepresentations(db, hash)) return true;
  return false;
}
export async function retainsFile(db: ReferenceDb, id: string, registry = FILE_REFERENCES) {
  for (const e of registry) if (await e.retention(db, id)) return true;
  return false;
}
