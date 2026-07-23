import "./globals.css";
import Script from "next/script";

// Prefetch the remaining cross-document navigations without running their page
// scripts. Unsupported browsers ignore this as progressive enhancement.
const speculationRules = JSON.stringify({
  prefetch: [{ where: { href_matches: "/*" }, eagerness: "moderate" }],
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
