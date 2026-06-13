import type { JsonLdValue } from "@/lib/structured-data";

type SeoJsonLdProps = {
  data: JsonLdValue | JsonLdValue[];
};

function escapeJsonForHtml(value: string) {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function serializeJsonLd(value: JsonLdValue) {
  return escapeJsonForHtml(JSON.stringify(value));
}

export function SeoJsonLd({ data }: SeoJsonLdProps) {
  const items = Array.isArray(data) ? data : [data];

  return (
    <>
      {items.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
        />
      ))}
    </>
  );
}
