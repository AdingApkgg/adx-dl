// Shared shape for long-form static pages (/about): per-locale section lists
// rendered by components/site/content-sections.tsx. Content lives in a data
// module (about-content.ts) rather than i18n.ts so the dictionary stays
// label-sized.

export type ContentBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "links"; items: { label: string; url: string; note?: string }[] };

export type ContentSection = {
  /** Anchor id — stable across locales so #links survive language switches. */
  id: string;
  heading: string;
  blocks: ContentBlock[];
};
