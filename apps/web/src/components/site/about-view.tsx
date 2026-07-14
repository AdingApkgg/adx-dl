import { Reveal } from "@/components/motion";
import { ContentSections } from "@/components/site/content-sections";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { aboutSections } from "@/lib/about-content";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function AboutView({ locale = "zh" }: { locale?: Locale }) {
  const { about, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/about",
          title: about.title,
          description: seo.about,
        })}
      />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{about.title}</h1>
        <p className="text-muted-foreground">{about.description}</p>
      </Reveal>
      <article className="min-w-0">
        <ContentSections sections={aboutSections[locale]} />
      </article>
    </main>
  );
}
