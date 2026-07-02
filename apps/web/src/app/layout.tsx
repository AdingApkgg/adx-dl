import "./globals.css";

/**
 * Pass-through root layout. The (default) and [locale] route groups render
 * their own <html>/<body> (the html lang differs per tree), so this layout
 * contributes no markup. It exists so the app has a root segment that can host
 * `app/not-found.tsx` — without a root layout the /_not-found entry fails the
 * build (next-app-loader: "doesn't have a root layout"), and the static export
 * writes that route out as `out/404.html` for GitHub Pages (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md
 * and 02-guides/static-exports.md).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
