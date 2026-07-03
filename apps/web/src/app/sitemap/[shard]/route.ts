import { getSitemapShard, getSitemapShardCount, serializeUrlset } from "@/lib/sitemap";

// Child sitemaps at /sitemap/0.xml, /sitemap/1.xml, … referenced by the
// /sitemap.xml index. Each is a <urlset> shard. Static at build time.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const count = await getSitemapShardCount();
  return Array.from({ length: count }, (_, id) => ({ shard: `${id}.xml` }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ shard: string }> }) {
  const { shard } = await params;
  const id = Number(shard.replace(/\.xml$/, ""));
  const entries = await getSitemapShard(Number.isFinite(id) ? id : 0);

  return new Response(serializeUrlset(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
