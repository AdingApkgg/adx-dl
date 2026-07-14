import { Reveal } from "@/components/motion";
import { FriendLinkCard } from "@/components/site/friend-link-card";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { friendLinks, hostnameOf } from "@/lib/friend-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function LinksView({ locale = "zh" }: { locale?: Locale }) {
  const { links, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/links",
          title: links.title,
          description: seo.links,
          items: friendLinks.map((link) => ({ name: link.name, url: link.url })),
        })}
      />
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
            <FriendLinkCard
              href={link.url}
              name={link.name}
              description={link.description[locale]}
              hostname={hostnameOf(link.url)}
              ariaLabel={`${links.visit} ${link.name}`}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
