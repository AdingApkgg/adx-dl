import { ArrowUpRightIcon } from "lucide-react";

import { Reveal } from "@/components/motion";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { friendLinks } from "@/lib/friend-links";
import { getDictionary, type Locale } from "@/lib/i18n";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinksView({ locale = "zh" }: { locale?: Locale }) {
  const { links } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{links.title}</h1>
        <p className="text-muted-foreground">{links.description}</p>
        <p className="text-sm text-muted-foreground">{links.intro}</p>
      </Reveal>
      {/* Rendered plainly (no scroll-reveal): these cards are the entire page,
          so they must be visible without JS — mirroring the catalog grid. */}
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
        {friendLinks.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener"
              aria-label={`${links.visit} ${link.name}`}
              className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors group-hover:ring-primary/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5">
                    <span>{link.name}</span>
                    <ArrowUpRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
                    />
                  </CardTitle>
                  <CardDescription>{link.description[locale]}</CardDescription>
                  <span className="text-xs text-muted-foreground/80">
                    {hostnameOf(link.url)}
                  </span>
                </CardHeader>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
