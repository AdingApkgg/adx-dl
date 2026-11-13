import Link from "next/link";
import { HeartHandshakeIcon } from "lucide-react";

import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import type { DownloadJob } from "./downloads-store";

/** A single quiet thank-you for the tray, only after a successful job. */
export function DownloadSupportPrompt({ locale, statuses }: {
  locale: Locale;
  statuses: readonly DownloadJob["status"][];
}) {
  if (!statuses.includes("success")) return null;

  return (
    <Link
      href={buildLocalePath("/donate", locale)}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <HeartHandshakeIcon className="size-4 shrink-0" aria-hidden="true" />
      {getDictionary(locale).donate.downloadThanks}
    </Link>
  );
}
