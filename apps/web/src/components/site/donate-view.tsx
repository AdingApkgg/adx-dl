import { Reveal } from "@/components/motion";
import { DonateAddressCard } from "@/components/site/donate-address-card";
import { FriendLinkCard } from "@/components/site/friend-link-card";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import {
  DONATE_TRC20_ADDRESS,
  DONATE_TRC20_EXPLORER_URL,
  donateMethods,
} from "@/lib/donate-links";
import { hostnameOf } from "@/lib/friend-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function DonateView({ locale = "zh" }: { locale?: Locale }) {
  const { donate, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/donate",
          title: donate.title,
          description: seo.donate,
          items: [
            ...donateMethods.map((method) => ({
              name: method.name[locale],
              url: method.url,
            })),
            { name: donate.addressTitle, url: DONATE_TRC20_EXPLORER_URL },
          ],
        })}
      />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{donate.title}</h1>
        <p className="text-muted-foreground">{donate.description}</p>
        <p className="text-sm text-muted-foreground">{donate.intro}</p>
      </Reveal>
      {/* Rendered plainly (no scroll-reveal): these cards are the entire page,
          so they must be visible without JS — mirroring /links. */}
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
        {donateMethods.map((method) => (
          <li key={method.url}>
            <FriendLinkCard
              href={method.url}
              name={method.name[locale]}
              description={method.description[locale]}
              hostname={hostnameOf(method.url)}
              ariaLabel={donate.open(method.name[locale])}
            />
          </li>
        ))}
      </ul>
      <DonateAddressCard
        title={donate.addressTitle}
        description={donate.addressDescription}
        address={DONATE_TRC20_ADDRESS}
        copyLabel={donate.copyAddress}
        copiedLabel={donate.copied}
        explorerUrl={DONATE_TRC20_EXPLORER_URL}
        explorerLabel={donate.viewOnExplorer}
      />
      <p className="text-sm text-muted-foreground">{donate.thanks}</p>
    </main>
  );
}
