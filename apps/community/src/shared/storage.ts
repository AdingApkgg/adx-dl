import { SOCIAL_ERROR_CODES } from "./community-social";
import { CHART_IMPORT_ERROR_CODES, CHART_BUSINESS_ERROR_CODES, type ChartImportSummary } from "./charts";
/** JSON contracts: timestamps are ISO strings; bytes/revisions are safe integers. */
export type StoragePurpose = "avatar" | "chart-source";
export type UploadState = "receiving" | "processing" | "ready" | "rejected" | "cancelled" | "expired";
export type FileState = "processing" | "ready" | "rejected" | "deleted";
export const STORAGE_ERROR_CODES = [
  ...CHART_IMPORT_ERROR_CODES,
  ...CHART_BUSINESS_ERROR_CODES,
  ...SOCIAL_ERROR_CODES,
  "LIBRARY_CHANGED", "LIBRARY_LIMIT", "LIBRARY_MODERATED", "LIBRARY_ENTRIES_UNAVAILABLE", "CHART_VERSION_CHANGED",
  "FOLLOWING_CHANGED", "FOLLOWING_LIMIT",
  "GOVERNANCE_CHANGED", "GOVERNANCE_LIMIT", "DISCUSSION_CHANGED", "DISCUSSION_READ_ONLY", "DISCUSSION_LOCKED", "DISCUSSION_ROOT_UNAVAILABLE", "DISCUSSION_VERSION_CHANGED", "DISCUSSION_CURSOR_CHANGED", "DISCUSSION_IDEMPOTENCY_CONFLICT", "DISCUSSION_LIMIT", "DISCUSSION_SUBSCRIPTION_LIMIT", "DISCUSSION_REPLY_LIMIT",
  "SITE_CHANGED", "SITE_INVALID",
  "PURPOSE_NOT_AVAILABLE",
  "INVALID_UPLOAD",
  "FILE_TOO_LARGE",
  "QUOTA_EXCEEDED",
  "TOO_MANY_UPLOADS",
  "IDEMPOTENCY_CONFLICT",
  "PART_CONFLICT",
  "PART_BUSY",
  "UPLOAD_INCOMPLETE",
  "UPLOAD_ALREADY_COMPLETED",
  "UPLOAD_EXPIRED",
  "UPLOAD_CANCELLED",
  "HASH_MISMATCH",
  "PART_HASH_MISMATCH",
  "TYPE_NOT_ALLOWED",
  "IMAGE_INVALID",
  "IMAGE_TOO_LARGE",
  "ANIMATED_IMAGE_NOT_ALLOWED",
  "HASH_BLOCKED",
  "PROCESSING_FAILED",
  "FILE_IN_USE",
  "AVATAR_CHANGED",
  "MEDIA_REVOCATION_PENDING",
  "INVALID_RANGE",
  "NOT_FOUND",
  "STORAGE_MAINTENANCE",
  "STORAGE_UNAVAILABLE",
  "STORAGE_BUSY",
  "STORAGE_BUDGET_EXCEEDED",
  "STORAGE_INCONSISTENT",
  "ACCOUNT_INACTIVE",
] as const;
export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];
export type ReceivedPartDto = { index: number; size: number; sha256: string };
export type UploadDto = {
  id: string;
  state: UploadState;
  expiresAt: string;
  partSize: number;
  partCount: number;
  receivedParts: ReceivedPartDto[];
  fileId?: string;
  errorCode?: StorageErrorCode;
};
export type InitUploadInput = { purpose: StoragePurpose; name: string; size: number; sha256: string };
export type FileDto = {
  id: string;
  purpose: StoragePurpose;
  name: string;
  size: number;
  state: FileState;
  createdAt: string;
  previewUrl?: string;
  chart?: ChartImportSummary;
};
export type AvatarDto = { image: string | null; avatarRevision: number };
export type SaveAvatarInput = { fileId: string; expectedRevision: number };
export type RemoveAvatarInput = { expectedRevision: number };
