import type { PgBoss } from "pg-boss";
import type { Logger } from "@/shared/log";
import type { Db } from "../db/client";

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ObjectBucket = "original" | "derived";
export type ObjectHead = { size: number; mime: string; sha256: string; etag?: string };
export type ObjectRead = ObjectHead & { body: ReadableStream<Uint8Array> };
export type ObjectDriver = {
  put(input: {
    bucket: ObjectBucket;
    key: string;
    body: ReadableStream<Uint8Array>;
    size: number;
    mime: string;
    sha256: string;
    signal?: AbortSignal;
  }): Promise<void>;
  get(input: {
    bucket: ObjectBucket;
    key: string;
    range?: { start: number; end: number };
    signal?: AbortSignal;
  }): Promise<ObjectRead>;
  head(input: { bucket: ObjectBucket; key: string; signal?: AbortSignal }): Promise<ObjectHead | null>;
  delete(input: { bucket: ObjectBucket; key: string; signal?: AbortSignal }): Promise<void>;
  list(input: {
    bucket: ObjectBucket;
    prefix: string;
    cursor?: string;
    maxKeys?: number;
    signal?: AbortSignal;
  }): Promise<{ objects: { key: string; size: number; modifiedAt: Date }[]; cursor?: string }>;
  copy(input: { bucket: ObjectBucket; sourceKey: string; key: string; signal?: AbortSignal }): Promise<void>;
  ready(signal?: AbortSignal): Promise<void>;
};
export type StorageRole = "web" | "media" | "control" | "backup";
export type StorageConfigBase = {
  publicOrigin: string;
  endpoint: string;
  region: string;
  originalBucket: string;
  derivedBucket: string;
  credentialsRef: string;
  accessKeyId: string;
  secretAccessKey: string;
  tempDir: string;
  capacityDir?: string;
  recipeBuild: string;
  limits: {
    temporaryBudget: number;
    originalBudget: number;
    derivedBudget: number;
    minFreeDiskBytes: number;
  };
};
export type StorageConfig = StorageConfigBase &
  (
    | { role: "web"; internalMediaSecret: string }
    | {
        role: "control";
        internalMediaSecret: string;
        internalMediaUrl: string;
        zoneId: string;
        purgeToken: string;
      }
    | { role: "media" | "backup" }
  );
export type StorageContext = {
  db: Db;
  boss: () => Promise<PgBoss>;
  driver: ObjectDriver;
  config: StorageConfig;
  log: Logger;
  now?: () => Date;
  /** Executable process lifecycle; tests/library callers may omit it. */
  lifecycle?: { signal: AbortSignal; run<T>(operation: () => Promise<T>): Promise<T> };
  /** Web publication notification, after commit only. Task11 must configure real web/control publishers. */
  onMediaPublished?: (hash: string, generation: number) => Promise<void>;
};
export type StorageJobData = { uploadId: string; generation: number };
