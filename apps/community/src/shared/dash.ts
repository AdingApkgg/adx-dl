/** Admin-only DTOs. No provider identity, credentials, private source or raw infrastructure paths. */
export type DashAccess = { publicId: string };
export type DashOverview = {
  users: number; activeUsers: number; pendingDeletionUsers: number;
  publicCharts: number; moderatedCharts: number; activeUploads: number;
  originalBytes: number; derivedBytes: number; capturedAt: string;
};
export type DashUser = {
  publicId: string; name: string; image: string | null;
  status: "active" | "pending_deletion"; createdAt: string; charts: number; publicCharts: number;
};
export type DashUsersPage = { items: DashUser[]; nextCursor: string | null };
export type DashModeration = { reason: string; actorPublicId: string; createdAt: string };
export type DashChart = {
  id: string; publicId: string; revision: number; title: string; artist: string;
  author: { publicId: string; name: string } | null;
  publishedAt: string; status: "public" | "moderated"; moderation: DashModeration | null;
  pending: boolean;
};
export type DashChartsPage = { items: DashChart[]; nextCursor: string | null };
export type DashStatus = {
  capturedAt: string;
  qq?: import("./napcat").NapcatObservation;
  checks: { name: string; status: "ok" | "unavailable" }[];
  /** A negative heartbeat age means this role has never registered. */
  roles: { role: "web" | "media" | "control"; heartbeatAgeSeconds: number; ready: boolean }[];
  queues: { storageDead: number | null; mediaPurgeDead: number | null; purgeIncomplete: number; revoking: number };
  journal: { exportedSequence: string; pending: number; exportedAt: string | null };
  maintenance: { active: boolean };
  backup: { status: "unknown" | "running" | "succeeded" | "failed"; startedAt: string | null;
    finishedAt: string | null; lastSuccessAt: string | null; manifestSha256: string | null;
    originalCount: number | null; bytes: number | null };
};
export type DashModerateInput = { expectedRevision: number; reason: string };
