import "./globals.css";
import Script from "next/script";

// Runs synchronously during HTML parse (before first paint) so persisted color
// mode, accent and motion preferences apply without a flash. An explicit
// light/dark mode wins; otherwise the color mode follows the OS.
const noFlashThemeScript = `(function(){var e=document.documentElement;try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='light'?false:(t==='dark'?true:m);e.classList.toggle('dark',d);}catch(x){e.classList.add('dark');}try{var a=localStorage.getItem('astrodx-accent');var c=['blue','violet','teal','orange','rose'];e.dataset.accent=c.indexOf(a)>=0?a:'blue';}catch(x){e.dataset.accent='blue';}try{var p=localStorage.getItem('adx-reduce-motion');p=p==='1'?'off':(p==='0'?'system':p);p=p==='on'||p==='off'?p:'system';e.dataset.motion=p;e.toggleAttribute('data-reduced-motion',p==='off');}catch(x){e.dataset.motion='system';}})();`;

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
      <Script id="theme-init" strategy="beforeInteractive">
        {noFlashThemeScript}
      </Script>
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
