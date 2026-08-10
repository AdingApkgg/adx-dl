import "./globals.css";
import Script from "next/script";

// Prefetch the remaining cross-document navigations without running their page
// scripts. Unsupported browsers ignore this as progressive enhancement.
//
// The catalog page is excluded on purpose. In-site clicks are soft navigations
// that fetch an RSC payload, so the speculatively prefetched *document* is
// thrown away — and /charts inlines the whole card catalog, which makes that
// wasted fetch the single most expensive one on the site (~263 KB gzip) at
// `moderate` eagerness, i.e. as soon as a finger touches the link.
const speculationRules = JSON.stringify({
  prefetch: [
    {
      where: {
        and: [
          { href_matches: "/*" },
          { not: { href_matches: "/charts" } },
          { not: { href_matches: "/:locale/charts" } },
        ],
      },
      eagerness: "moderate",
    },
  ],
});

/**
 * The (default) and [locale] route groups render their own <html>/<body> so
 * each tree can set the correct lang. This shared root owns global scripts so
 * they are installed once and never re-rendered during a locale transition.
 * It also lets `app/not-found.tsx` build as /_not-found and export to
 * `out/404.html` (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md
 * and 02-guides/static-exports.md).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {/* The no-flash boot script lives in RootLayoutShell (top of <body>):
          React 19 rejects inline scripts rendered outside the <html> tree,
          which this fragment root is. */}
      <Script
        id="speculation-rules"
        type="speculationrules"
        strategy="afterInteractive"
      >
        {speculationRules}
      </Script>
      {children}
    </>
  );
}
