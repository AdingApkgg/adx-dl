import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { FileState, StorageErrorCode, StoragePurpose, UploadState } from "@/shared/storage";
import { user } from "./auth";
const tz = { withTimezone: true } as const;
const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp(tz).defaultNow().notNull();
const bytes = () => bigint({ mode: "number" }).default(0).notNull();
const generation = bytes;
const properties = () => jsonb().$type<Record<string, unknown>>().default({}).notNull();
const nonnegative = (name: string, col: AnyPgColumn) =>
  check(name, sql`${col} >= 0 and ${col} <= 9007199254740991`);
const validHash = (name: string, col: AnyPgColumn) => check(name, sql`${col} ~ '^[0-9a-f]{64}$'`);
const physicalState = () =>
  text({ enum: ["pending", "ready", "deleting", "deleted", "blocked"] })
    .default("pending")
    .notNull();
const physicalChecks = (
  prefix: string,
  t: { size: AnyPgColumn; generation: AnyPgColumn; state: AnyPgColumn },
) => [
  check(`${prefix}_size_check`, sql`${t.size} > 0 and ${t.size} <= 480000000`),
  nonnegative(`${prefix}_generation_check`, t.generation),
  check(`${prefix}_state_check`, sql`${t.state} in ('pending','ready','deleting','deleted','blocked')`),
];
export const storagePolicies = pgTable(
  "storage_policies",
  {
    id: id(),
    name: text().notNull().unique(),
    driver: text({ enum: ["s3"] })
      .default("s3")
      .notNull(),
    endpoint: text().notNull(),
    region: text().notNull(),
    originalBucket: text().notNull(),
    derivedBucket: text().notNull(),
    credentialsRef: text().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("storage_policies_driver_check", sql`${t.driver} = 's3'`),
    check("storage_policies_credentials_ref_check", sql`${t.credentialsRef} ~ '^[A-Z][A-Z0-9_]*$'`),
  ],
);
export const blobs = pgTable(
  "blobs",
  {
    id: id(),
    sha256: text().notNull().unique(),
    policyId: uuid()
      .notNull()
      .references(() => storagePolicies.id, { onDelete: "restrict" }),
    key: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    detectedMime: text(),
    state: physicalState(),
    properties: properties(),
    verifiedAt: timestamp(tz),
    orphanedAt: timestamp(tz),
    generation: generation(),
    leaseUntil: timestamp(tz),
    createdAt: createdAt(),
  },
  (t) => [
    validHash("blobs_sha256_check", t.sha256),
    ...physicalChecks("blobs", t),
    uniqueIndex("blobs_policy_key_uidx").on(t.policyId, t.key),
    index("blobs_gc_idx").on(t.state, t.orphanedAt),
    check(
      "blobs_ready_verified_check",
      sql`${t.state} <> 'ready' or (${t.verifiedAt} is not null and ${t.detectedMime} is not null)`,
    ),
  ],
);
export const files = pgTable(
  "files",
  {
    id: id(),
    ownerId: text().references(() => user.id, { onDelete: "set null" }),
    blobId: uuid()
      .notNull()
      .references(() => blobs.id, { onDelete: "restrict" }),
    originalName: text().notNull(),
    purpose: text().$type<StoragePurpose>().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    state: text().$type<FileState>().default("processing").notNull(),
    deletedAt: timestamp(tz),
    createdAt: createdAt(),
    retainedUntil: timestamp(tz),
  },
  (t) => [
    index("files_owner_idx").on(t.ownerId),
    index("files_blob_idx").on(t.blobId),
    index("files_retention_idx").on(t.state, t.retainedUntil),
    check("files_size_check", sql`${t.size} > 0 and ${t.size} <= 480000000`),
    check("files_state_check", sql`${t.state} in ('processing','ready','rejected','deleted')`),
    check("files_purpose_check", sql`${t.purpose} in ('avatar','chart-source')`),
    check(
      "files_name_check",
      sql`char_length(${t.originalName}) between 1 and 255 and ${t.originalName} !~ '[[:cntrl:]/]' and position(chr(92) in ${t.originalName}) = 0 and ${t.originalName} not in ('.','..')`,
    ),
    check("files_deleted_check", sql`(${t.state} = 'deleted') = (${t.deletedAt} is not null)`),
  ],
);
export const derivedObjects = pgTable(
  "derived_objects",
  {
    id: id(),
    outputSha256: text().notNull().unique(),
    policyId: uuid()
      .notNull()
      .references(() => storagePolicies.id, { onDelete: "restrict" }),
    key: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    mime: text().notNull(),
    properties: properties(),
    state: physicalState(),
    generation: generation(),
    leaseUntil: timestamp(tz),
    orphanedAt: timestamp(tz),
    createdAt: createdAt(),
  },
  (t) => [
    validHash("derived_objects_hash_check", t.outputSha256),
    ...physicalChecks("derived_objects", t),
    uniqueIndex("derived_objects_policy_key_uidx").on(t.policyId, t.key),
    index("derived_objects_gc_idx").on(t.state, t.orphanedAt),
  ],
);
export const blobDerivatives = pgTable(
  "blob_derivatives",
  {
    id: id(),
    sourceBlobId: uuid()
      .notNull()
      .references(() => blobs.id, { onDelete: "restrict" }),
    recipe: text().notNull(),
    recipeBuild: text().notNull(),
    derivedObjectId: uuid().references(() => derivedObjects.id, { onDelete: "restrict" }),
    state: text({ enum: ["pending", "ready", "rejected", "retired"] })
      .default("pending")
      .notNull(),
    generation: generation(),
    leaseUntil: timestamp(tz),
    errorCode: text().$type<StorageErrorCode>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("blob_derivatives_recipe_uidx").on(t.sourceBlobId, t.recipe, t.recipeBuild),
    index("blob_derivatives_object_idx").on(t.derivedObjectId),
    check("blob_derivatives_state_check", sql`${t.state} in ('pending','ready','rejected','retired')`),
    check("blob_derivatives_ready_check", sql`${t.state} <> 'ready' or ${t.derivedObjectId} is not null`),
    nonnegative("blob_derivatives_generation_check", t.generation),
  ],
);
export const userAvatars = pgTable(
  "user_avatars",
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    fileId: uuid().references(() => files.id, { onDelete: "restrict" }),
    derivativeId: uuid().references(() => blobDerivatives.id, { onDelete: "restrict" }),
    revision: bytes(),
    updatedAt: createdAt(),
    suspendedAt: timestamp(tz),
  },
  (t) => [
    check("user_avatars_pair_check", sql`(${t.fileId} is null) = (${t.derivativeId} is null)`),
    nonnegative("user_avatars_revision_check", t.revision),
    index("user_avatars_file_idx").on(t.fileId),
    index("user_avatars_derivative_idx").on(t.derivativeId),
  ],
);
export const blobBlocks = pgTable(
  "blob_blocks",
  {
    sha256: text().primaryKey(),
    reasonCode: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [validHash("blob_blocks_hash_check", t.sha256)],
);
export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: id(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text().$type<StoragePurpose>().notNull(),
    originalName: text().notNull(),
    expectedSha256: text().notNull(),
    expectedSize: bigint({ mode: "number" }).notNull(),
    partSize: integer().notNull(),
    partCount: integer().notNull(),
    state: text().$type<UploadState>().default("receiving").notNull(),
    fileId: uuid().references(() => files.id, { onDelete: "restrict" }),
    expiresAt: timestamp(tz).notNull(),
    errorCode: text().$type<StorageErrorCode>(),
    flowJobIds: jsonb().$type<string[]>().default([]).notNull(),
    generation: generation(),
    reservedBytes: bytes(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
    idempotencyKey: uuid().notNull(),
    requestDigest: text().notNull(),
  },
  (t) => [
    uniqueIndex("upload_sessions_idempotency_uidx").on(t.ownerId, t.idempotencyKey),
    index("upload_sessions_expiry_idx").on(t.state, t.expiresAt),
    index("upload_sessions_file_idx").on(t.fileId),
    check(
      "upload_sessions_state_check",
      sql`${t.state} in ('receiving','processing','ready','rejected','cancelled','expired')`,
    ),
    validHash("upload_sessions_hash_check", t.expectedSha256),
    validHash("upload_sessions_digest_check", t.requestDigest),
    check("upload_sessions_size_check", sql`${t.expectedSize} between 1 and 480000000`),
    check(
      "upload_sessions_parts_check",
      sql`${t.partSize} = 4194304 and ${t.partCount} between 1 and 115 and ${t.partCount} = (${t.expectedSize} + ${t.partSize} - 1) / ${t.partSize}`,
    ),
    check("upload_sessions_purpose_check", sql`${t.purpose} in ('avatar','chart-source')`),
    check(
      "upload_sessions_name_check",
      sql`char_length(${t.originalName}) between 1 and 255 and ${t.originalName} !~ '[[:cntrl:]/]' and position(chr(92) in ${t.originalName}) = 0 and ${t.originalName} not in ('.','..')`,
    ),
    nonnegative("upload_sessions_generation_check", t.generation),
    check("upload_sessions_reservation_check", sql`${t.reservedBytes} between 0 and ${t.expectedSize}`),
  ],
);
// No session/user FK: deleting personal rows must preserve every physical attempt's accounting.
export const uploadAttempts = pgTable(
  "upload_attempts",
  {
    id: id(),
    uploadId: uuid().notNull(),
    index: integer().notNull(),
    policyId: uuid()
      .notNull()
      .references(() => storagePolicies.id, { onDelete: "restrict" }),
    tempKey: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    sha256: text(),
    state: text({ enum: ["writing", "ready", "deleting", "deleted"] })
      .default("writing")
      .notNull(),
    generation: generation(),
    reservedBytes: bytes(),
    writtenBytes: bytes(),
    leaseUntil: timestamp(tz).notNull(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("upload_attempts_policy_key_uidx").on(t.policyId, t.tempKey),
    index("upload_attempts_upload_idx").on(t.uploadId, t.index),
    index("upload_attempts_cleanup_idx").on(t.state, t.leaseUntil),
    check("upload_attempts_index_check", sql`${t.index} between 0 and 114`),
    check("upload_attempts_size_check", sql`${t.size} between 1 and 4194304`),
    check("upload_attempts_state_check", sql`${t.state} in ('writing','ready','deleting','deleted')`),
    check("upload_attempts_hash_check", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    nonnegative("upload_attempts_generation_check", t.generation),
    check(
      "upload_attempts_accounting_check",
      sql`${t.reservedBytes} between 0 and ${t.size} and ${t.writtenBytes} between 0 and ${t.size}`,
    ),
  ],
);
export const uploadParts = pgTable(
  "upload_parts",
  {
    uploadId: uuid()
      .notNull()
      .references(() => uploadSessions.id, { onDelete: "cascade" }),
    index: integer().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    tempKey: text().notNull(),
    state: text({ enum: ["writing", "ready"] })
      .default("writing")
      .notNull(),
    attemptId: uuid()
      .notNull()
      .references(() => uploadAttempts.id, { onDelete: "restrict" }),
    leaseUntil: timestamp(tz).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.uploadId, t.index] }),
    validHash("upload_parts_hash_check", t.sha256),
    check("upload_parts_state_check", sql`${t.state} in ('writing','ready')`),
    check("upload_parts_size_check", sql`${t.size} between 1 and 4194304`),
    check("upload_parts_index_check", sql`${t.index} between 0 and 114`),
    uniqueIndex("upload_parts_attempt_uidx").on(t.attemptId),
  ],
);
export const storageUsage = pgTable(
  "storage_usage",
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    usedBytes: bytes(),
    reservedBytes: bytes(),
    activeUploads: integer().default(0).notNull(),
    updatedAt: createdAt(),
  },
  (t) => [
    nonnegative("storage_usage_used_check", t.usedBytes),
    nonnegative("storage_usage_reserved_check", t.reservedBytes),
    check("storage_usage_active_check", sql`${t.activeUploads} >= 0`),
  ],
);
export const storageBudget = pgTable(
  "storage_budget",
  {
    id: text().primaryKey().default("global"),
    temporaryReserved: bytes(),
    temporaryWritten: bytes(),
    originalReserved: bytes(),
    originalWritten: bytes(),
    derivedReserved: bytes(),
    derivedWritten: bytes(),
    updatedAt: createdAt(),
  },
  (t) => [
    check("storage_budget_singleton_check", sql`${t.id} = 'global'`),
    ...[
      t.temporaryReserved,
      t.temporaryWritten,
      t.originalReserved,
      t.originalWritten,
      t.derivedReserved,
      t.derivedWritten,
    ].map((c, i) => nonnegative(`storage_budget_bytes_${i}_check`, c)),
  ],
);
export const mediaPublications = pgTable(
  "media_publications",
  {
    outputSha256: text()
      .primaryKey()
      .references(() => derivedObjects.outputSha256, { onDelete: "restrict" }),
    state: text({ enum: ["public", "revoking", "private", "blocked"] })
      .default("private")
      .notNull(),
    generation: generation(),
    updatedAt: createdAt(),
    lastPurgeAt: timestamp(tz),
  },
  (t) => [
    validHash("media_publications_hash_check", t.outputSha256),
    check("media_publications_state_check", sql`${t.state} in ('public','revoking','private','blocked')`),
    nonnegative("media_publications_generation_check", t.generation),
  ],
);
export type MediaPurgeObservation = { at: string; elapsedMs: number; status: number };
export type MediaPurgeEvidence = {
  failure?: { code: string; status?: number; apiCodes?: number[] };
  drain?: MediaPurgeObservation & { generation: number };
  purges: MediaPurgeObservation[];
  probes: (MediaPurgeObservation & { cacheStatus: string | null; bodyLength: number; bodySha256: string })[];
};
// Durable revocation outbox must outlive deleted accounts and physical metadata.
export const mediaPurgeRequests = pgTable(
  "media_purge_requests",
  {
    id: id(),
    outputSha256: text().notNull(),
    generation: generation(),
    state: text({ enum: ["pending", "running", "done", "failed"] })
      .default("pending")
      .notNull(),
    attempts: integer().default(0).notNull(),
    attemptStartedAt: timestamp(tz),
    evidence: jsonb().$type<MediaPurgeEvidence>(),
    nextAttemptAt: createdAt(),
    lastErrorCode: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("media_purge_requests_generation_uidx").on(t.outputSha256, t.generation),
    validHash("media_purge_requests_hash_check", t.outputSha256),
    nonnegative("media_purge_requests_generation_check", t.generation),
    check("media_purge_requests_attempts_check", sql`${t.attempts} >= 0`),
    check("media_purge_requests_state_check", sql`${t.state} in ('pending','running','done','failed')`),
    index("media_purge_requests_retry_idx").on(t.state, t.nextAttemptAt),
  ],
);
export const avatarMutations = pgTable(
  "avatar_mutations",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    idempotencyKey: uuid().notNull(),
    requestDigest: text().notNull(),
    resultImage: text(),
    resultRevision: bytes(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.idempotencyKey] }),
    validHash("avatar_mutations_digest_check", t.requestDigest),
    nonnegative("avatar_mutations_revision_check", t.resultRevision),
    index("avatar_mutations_retention_idx").on(t.createdAt),
  ],
);
export const storageMaintenance = pgTable(
  "storage_maintenance",
  {
    id: text().primaryKey().default("global"),
    ownerId: uuid(),
    leaseUntil: timestamp(tz),
    updatedAt: createdAt(),
  },
  (t) => [
    check("storage_maintenance_singleton_check", sql`${t.id} = 'global'`),
    check("storage_maintenance_lease_check", sql`(${t.ownerId} is null) = (${t.leaseUntil} is null)`),
  ],
);
// Minimal recovery facts: never cascading FKs or personal names. Rolled-back identity gaps
// are legal; exporters chain ordered committed records and checkpoint the last sequence.
export const storageTombstones = pgTable(
  "storage_tombstones",
  {
    sequence: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text({ enum: ["user_deleted", "file_deleted", "hash_blocked", "media_revoked"] }).notNull(),
    userId: text(),
    fileId: uuid(),
    sha256: text(),
    generation: bigint({ mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "storage_tombstones_kind_check",
      sql`${t.kind} in ('user_deleted','file_deleted','hash_blocked','media_revoked')`,
    ),
    check(
      "storage_tombstones_subject_check",
      sql`(${t.kind} = 'user_deleted' and ${t.userId} is not null) or (${t.kind} = 'file_deleted' and ${t.fileId} is not null) or (${t.kind} in ('hash_blocked','media_revoked') and ${t.sha256} is not null)`,
    ),
    check("storage_tombstones_hash_check", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "storage_tombstones_generation_check",
      sql`${t.generation} is null or (${t.generation} >= 0 and ${t.generation} <= 9007199254740991)`,
    ),
  ],
);
export const storageJournalProgress = pgTable(
  "storage_journal_progress",
  {
    id: text().primaryKey().default("global"),
    exportedSequence: bytes(),
    chainHash: text(),
    exportedAt: timestamp(tz),
    updatedAt: createdAt(),
  },
  (t) => [
    check("storage_journal_progress_singleton_check", sql`${t.id} = 'global'`),
    nonnegative("storage_journal_progress_sequence_check", t.exportedSequence),
    check(
      "storage_journal_progress_hash_check",
      sql`${t.chainHash} is null or ${t.chainHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "storage_journal_progress_checkpoint_check",
      sql`(${t.exportedSequence} = 0 and ${t.chainHash} is null and ${t.exportedAt} is null) or (${t.exportedSequence} > 0 and ${t.chainHash} is not null and ${t.exportedAt} is not null)`,
    ),
  ],
);
