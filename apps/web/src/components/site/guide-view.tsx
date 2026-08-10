import { Reveal } from "@/components/motion";
import { ContentSections } from "@/components/site/content-sections";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { guideFaqItems, guideHowToSteps, guideSections } from "@/lib/guide-content";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  buildFaqStructuredData,
  buildHowToStructuredData,
  buildInfoPageStructuredData,
} from "@/lib/structured-data";

export function GuideView({ locale = "zh" }: { locale?: Locale }) {
  const { guide, seo } = getDictionary(locale);
  const sections = guideSections[locale];

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={[
          buildInfoPageStructuredData(locale, {
            pathname: "/guide",
            title: guide.title,
            description: seo.guide,
          }),
          buildHowToStructuredData(locale, {
            pathname: "/guide",
            name: guide.title,
            description: guide.description,
            steps: guideHowToSteps(locale),
          }),
          buildFaqStructuredData(locale, guideFaqItems(locale)),
        ]}
      />
      <Reveal ssrVisible className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{guide.title}</h1>
        <p className="text-muted-foreground">{guide.description}</p>
        <p className="text-sm text-muted-foreground">{guide.intro}</p>
      </Reveal>
      {/* Plain anchors, not a scroll-spy: the page is four sections long, and a
          reader who arrives from a "download stalls" search wants the jump to
          work before any JavaScript has run. */}
      <nav aria-label={guide.tocLabel} className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {section.heading}
          </a>
        ))}
      </nav>
      <article className="min-w-0">
        <ContentSections sections={sections} />
      </article>
    </main>
  );
}
