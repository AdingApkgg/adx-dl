import type { Metadata } from "next";

import "../globals.css";
import { RootLayoutShell, rootViewport } from "@/app/root-layout-shell";
import { resolveSiteUrl } from "@/lib/site-url";
import { webManifestPath } from "@/lib/web-manifest";

export const viewport = rootViewport;

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const siteDescription =
  "ADX 谱面资源是非官方 AstroDX 谱面资料站，提供 maimai 风格谱面的目录索引、曲目信息、封面、难度、在线预览与下载入口。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ADX 谱面资源 | AstroDX 谱面资料站",
  description: siteDescription,
  manifest: webManifestPath("zh"),
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
