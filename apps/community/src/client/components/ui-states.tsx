import type { ReactNode } from "react";
import { InboxIcon } from "lucide-react";
import { Skeleton } from "@astrodx/ui/components/skeleton";

/** Static empty content is distinct from loading and service errors. */
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="community-empty community-empty-state"><span aria-hidden="true" className="community-state-icon"><InboxIcon /></span><p role="status" className="font-medium text-foreground">{title}</p>{description ? <p className="max-w-lg text-pretty leading-7">{description}</p> : null}{children ? <div className="community-toolbar justify-center">{children}</div> : null}</div>;
}
export function LoadingState({ label }: { label: string }) {
  return <div className="community-panel space-y-4" aria-busy="true"><p role="status" className="text-sm text-muted-foreground">{label}</p><div aria-hidden="true" className="space-y-3"><Skeleton className="h-5 w-2/3 max-w-64" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div></div>;
}
