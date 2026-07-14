import { Reveal } from "@/components/motion";
import { PostForm } from "@/components/site/post-form";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function PostView({ locale = "zh" }: { locale?: Locale }) {
  const { post, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/post",
          title: post.title,
          description: seo.post,
        })}
      />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{post.title}</h1>
        <p className="text-muted-foreground">{post.description}</p>
        <p className="text-sm text-muted-foreground">{post.intro}</p>
      </Reveal>
      <PostForm locale={locale} />
    </main>
  );
}
