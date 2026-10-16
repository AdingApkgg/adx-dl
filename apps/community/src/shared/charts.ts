/** Private chart contracts. All timestamps are ISO strings; no storage keys leave the server. */
export type ChartDifficulty = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ChartDiagnostic = { code: string; difficulty?: ChartDifficulty; line?: number };
export type ChartDifficultySummary = {
  difficulty: ChartDifficulty;
  level: string | null;
  noteCount: number | null;
  durationMs: number | null;
  previewSupported: boolean;
};
export type ChartImportSummary = {
  title: string;
  artist: string;
  maidataMd5Base64: string;
  difficulties: ChartDifficultySummary[];
  warnings: ChartDiagnostic[];
  audio: { mime: string; size: number } | null;
  hasCover: boolean;
};
export type ChartAssetRole = "maidata" | "audio" | "cover";
export type ChartPreviewManifest = {
  format: 1;
  assets: { role: ChartAssetRole; path: string; mime: string; size: number; sha256: string; offset: number }[];
  summary: ChartImportSummary;
};
export type ChartPackageInspection = {
  summary: ChartImportSummary;
  manifest: ChartPreviewManifest;
  artifact: { path: string; size: number; sha256: string };
};
export type ChartVersionDto = {
  id: string;
  ordinal: number;
  sourceFileId: string;
  sourceSize: number;
  summary: ChartImportSummary;
  createdAt: string;
};
export type ChartPublicationDto = { versionId: string; title: string; artist: string; publishedAt: string; updatedAt: string };
export type PublicChartDto = ChartPublicationDto & { id: string; publicId: string; ordinal: number; summary: ChartImportSummary; sourceSize: number; author: { id: string; publicId: string | null; name: string; image: string | null } | null };
export type PublicChartsPageDto = { items: PublicChartDto[]; nextCursor: string | null };
export type ChartDto = {
  publicId?: string | null; // Server always supplies this; private drafts have no public number.
  publicationPending?: boolean; // Always supplied by the server; false is required for a durable success.
  publication?: ChartPublicationDto | null; // Transitional fixture typing; every server DTO supplies this field.
  id: string;
  title: string;
  artist: string;
  revision: number;
  currentVersionId: string;
  versions: ChartVersionDto[];
  createdAt: string;
  updatedAt: string;
};
export type ChartListItemDto = Omit<ChartDto, "versions" | "createdAt"> & { summary: ChartImportSummary };
export type ChartsPageDto = {
  items: ChartListItemDto[];
  nextCursor: string | null;
  /** Logical source bytes only; no physical disk capacity is reserved for the account. */
  usage: { usedBytes: number; reservedBytes: number; quotaBytes: number };
};
export const CHART_IMPORT_ERROR_CODES = [
  "CHART_PACKAGE_INVALID", "CHART_PATH_INVALID", "CHART_PATH_COLLISION",
  "CHART_ARCHIVE_UNSUPPORTED", "CHART_ENTRY_LIMIT", "CHART_EXPANDED_LIMIT",
  "CHART_ASSET_TOO_LARGE", "CHART_ASSET_AMBIGUOUS", "CHART_MAIDATA_MISSING",
  "CHART_INVALID_UTF8", "CHART_DIFFICULTY_INVALID", "CHART_METADATA_INVALID",
  "CHART_COMPLEXITY_EXCEEDED", "CHART_ASSET_INVALID",
] as const;
export type ChartImportErrorCode = (typeof CHART_IMPORT_ERROR_CODES)[number];
export const CHART_BUSINESS_ERROR_CODES = [
  "CHART_CHANGED", "CHART_FILE_NOT_READY", "CHART_FILE_ASSIGNED", "CHART_CURRENT_VERSION",
  "CHART_DRAFT_LIMIT", "CHART_VERSION_LIMIT", "CHART_PUBLISHED_VERSION",
] as const;
export type ChartBusinessErrorCode = (typeof CHART_BUSINESS_ERROR_CODES)[number];
