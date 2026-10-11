import { m } from "@/paraglide/messages.js";
import { errorCodeOf, errorMessage } from "./auth-errors";
export function storageErrorMessage(error: unknown): string {
  switch (errorCodeOf(error)) {
    case "AVATAR_CHANGED":
      return m.error_avatar_changed();
    case "MEDIA_REVOCATION_PENDING":
      return m.error_storage_revoking();
    case "TYPE_NOT_ALLOWED":
    case "IMAGE_INVALID":
    case "IMAGE_TOO_LARGE":
    case "ANIMATED_IMAGE_NOT_ALLOWED":
    case "FILE_TOO_LARGE":
      return m.error_storage_image();
    case "HASH_MISMATCH":
    case "PART_HASH_MISMATCH":
      return m.error_storage_hash();
    case "UPLOAD_EXPIRED":
    case "UPLOAD_CANCELLED":
    case "NOT_FOUND":
      return m.error_storage_expired();
    case "QUOTA_EXCEEDED":
      return m.error_storage_quota();
    case "STORAGE_MAINTENANCE":
    case "STORAGE_UNAVAILABLE":
    case "STORAGE_BUSY":
    case "STORAGE_BUDGET_EXCEEDED":
    case "TOO_MANY_UPLOADS":
    case "PART_BUSY":
      return m.error_storage_busy();
    case "HASH_BLOCKED":
    case "PROCESSING_FAILED":
      return m.error_storage_failed();
    case "UNAUTHORIZED":
    case "ACCOUNT_PENDING_DELETION":
    case "RATE_LIMITED":
      return errorMessage(error) ?? m.error_unknown();
    default:
      return m.error_storage_upload();
  }
}
