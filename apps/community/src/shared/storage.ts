/** JSON contracts: timestamps are ISO strings; bytes/revisions are safe integers. */
export type StoragePurpose = "avatar" | "chart-source";
export type UploadState = "receiving" | "processing" | "ready" | "rejected" | "cancelled" | "expired";
export type FileState = "processing" | "ready" | "rejected" | "deleted";
export const STORAGE_ERROR_CODES = [
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
};
export type AvatarDto = { image: string | null; avatarRevision: number };
export type SaveAvatarInput = { fileId: string; expectedRevision: number };
export type RemoveAvatarInput = { expectedRevision: number };
