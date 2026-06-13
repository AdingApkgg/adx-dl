import type { Metadata } from "next";

import "../globals.css";
import { RootLayoutShell } from "@/app/root-layout-shell";
import { resolveSiteUrl } from "@/lib/site-url";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AstroDX Archive",
  description: "Chart archive, indexing, and download portal for AstroDX collections.",
  manifest: "/site.webmanifest",
};

export default async function DefaultRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RootLayoutShell lang="zh-CN" locale="zh">
      {children}
    </RootLayoutShell>
  );
}
