import { Reveal } from "@astrodx/ui/motion";
import { FriendLinkCard } from "@/components/site/friend-link-card";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { communityChannels, QQ_COMMUNITY, QQ_COMMUNITY_GROUP_NUMBER } from "@/lib/community-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

const platformIcons = new Map([
  ["qm.qq.com", "/community-icons/qq.png"],
  ["t.me", "/community-icons/telegram.svg"],
  ["discord.gg", "/community-icons/discord.svg"],
]);

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
      </Reveal>
      {/* Rendered plainly (no scroll-reveal): these cards are the entire page,
          so they must be visible without JS — mirroring /links. */}
      <ul className="grid list-none gap-4 p-0 lg:grid-cols-3">
        {communityChannels.map((channel) => {
          const url = new URL(channel.url);
          const id = channel.url === QQ_COMMUNITY
            ? QQ_COMMUNITY_GROUP_NUMBER
            : url.pathname.split("/").filter(Boolean).at(-1) ?? "";
          const caption = url.hostname === "t.me" && id ? `@${id}` : id;

          return (
            <li key={channel.url}>
              <FriendLinkCard
                href={channel.url}
                name={channel.name[locale]}
                caption={caption}
                iconSrc={platformIcons.get(url.hostname)}
                ariaLabel={community.join(channel.name[locale])}
              />
            </li>
          );
        })}
      </ul>
    </main>
  );
}
