import { Reveal } from "@/components/motion";
import { FriendLinkCard } from "@/components/site/friend-link-card";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { communityChannels } from "@/lib/community-links";
import { hostnameOf } from "@/lib/friend-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function CommunityView({ locale = "zh" }: { locale?: Locale }) {
  const { community, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/community",
          title: community.title,
          description: seo.community,
          items: communityChannels.map((channel) => ({
            name: channel.name[locale],
            url: channel.url,
          })),
        })}
      />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{community.title}</h1>
        <p className="text-muted-foreground">{community.description}</p>
        <p className="text-sm text-muted-foreground">{community.intro}</p>
      </Reveal>
      {/* Rendered plainly (no scroll-reveal): these cards are the entire page,
          so they must be visible without JS — mirroring /links. */}
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
        {communityChannels.map((channel) => (
          <li key={channel.url}>
            <FriendLinkCard
              href={channel.url}
              name={channel.name[locale]}
              description={channel.description[locale]}
              hostname={hostnameOf(channel.url)}
              ariaLabel={community.join(channel.name[locale])}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
