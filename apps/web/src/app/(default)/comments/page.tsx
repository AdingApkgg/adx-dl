import { GuestbookView } from "@/components/site/guestbook-view";
import { buildGuestbookPageMetadata } from "@/lib/page-metadata";

export const metadata = buildGuestbookPageMetadata("zh");

export default function GuestbookPage() {
  return <GuestbookView locale="zh" />;
}
