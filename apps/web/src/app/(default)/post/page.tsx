import { PostView } from "@/components/site/post-view";
import { buildPostPageMetadata } from "@/lib/page-metadata";

export const metadata = buildPostPageMetadata("zh");

export default function PostPage() {
  return <PostView locale="zh" />;
}
