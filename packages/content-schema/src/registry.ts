import type { LinkArraySpec, ValidationResult } from "./link-list";
import { validateLinkListFile } from "./link-list";

/** One editable content file: where it lives, what it is called, what is in it. */
export type ContentFileSpec = {
  /** Stable id used in dash URLs and API paths. Never renamed lightly — a
   *  staged draft in someone's browser is keyed by it. */
  key: string;
  /** Repo-relative path. dash reads and writes this through the GitHub API. */
  path: string;
  /** Shown in the dash UI. */
  title: string;
  /** The TS module that imports this JSON — only used to explain the pairing
   *  in the UI and in reviews; nothing resolves it. */
  module: string;
  arrays: readonly LinkArraySpec[];
};

/**
 * The single source of truth for "what dash can edit". Three consumers read
 * it: dash's GET /api/content (the list page), dash's form (it renders the
 * arrays from here), and apps/web's CI test (it validates the real JSON files
 * against it). Adding a file to batch one means adding a row here and nothing
 * else on the plumbing side.
 */
export const CONTENT_FILES = [
  {
    key: "community",
    path: "apps/web/content/community.json",
    title: "社区与联系方式",
    module: "apps/web/src/lib/community-links.ts",
    arrays: [
      { key: "contactChannels", requireDescription: false },
      { key: "communityChannels", requireDescription: true },
    ],
  },
  {
    key: "donate",
    path: "apps/web/content/donate.json",
    title: "赞助方式",
    module: "apps/web/src/lib/donate-links.ts",
    arrays: [{ key: "methods", requireDescription: true }],
  },
  {
    key: "friend-links",
    path: "apps/web/content/friend-links.json",
    title: "友情链接",
    module: "apps/web/src/lib/friend-links.ts",
    arrays: [{ key: "links", requireDescription: true }],
  },
] as const satisfies readonly ContentFileSpec[];

export function findContentFile(key: string): ContentFileSpec | undefined {
  return CONTENT_FILES.find((file) => file.key === key);
}

export function validateContentFile(key: string, data: unknown): ValidationResult {
  const spec = findContentFile(key);
  if (!spec) return { ok: false, errors: [`未知的内容键：${key}`] };
  return validateLinkListFile(data, spec.arrays);
}
