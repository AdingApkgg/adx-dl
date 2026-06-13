import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

describe("SeoJsonLd", () => {
  test("renders JSON-LD script tags for array payloads", async () => {
    const { SeoJsonLd } = await import("./seo-json-ld");
    const html = renderToStaticMarkup(
      <SeoJsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "AstroDX Archive",
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [],
          },
        ]}
      />
    );

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  test("escapes unsafe characters inside JSON-LD output", async () => {
    const { SeoJsonLd } = await import("./seo-json-ld");
    const html = renderToStaticMarkup(
      <SeoJsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Thing",
          name: "</script><script>alert('xss')</script>",
        }}
      />
    );

    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert('xss')\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>alert('xss')</script>");
  });
});
