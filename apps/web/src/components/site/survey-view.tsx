import { Reveal } from "@/components/motion";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { SurveyForm } from "@/components/site/survey-form";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function SurveyView({ locale = "zh" }: { locale?: Locale }) {
  const { survey, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/survey",
          title: survey.title,
          description: seo.survey,
        })}
      />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{survey.title}</h1>
        <p className="text-muted-foreground">{survey.description}</p>
        <p className="text-sm text-muted-foreground">{survey.intro}</p>
      </Reveal>
      <SurveyForm locale={locale} />
    </main>
  );
}
