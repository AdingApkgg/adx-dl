import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder that stands in for the Artalk thread while its third-party bundle
 * loads over the network. Mirrors the real layout — an editor box on top, then a
 * few comment rows — so the area doesn't collapse or flash blank before init.
 */
export function CommentsSkeleton({
  rows = 3,
  className,
  ...props
}: React.ComponentProps<"div"> & { rows?: number }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {/* Editor box: avatar + textarea + send button */}
      <div className="flex gap-3 rounded-lg border border-border/70 p-4">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      {/* Comment rows: avatar + name line + body lines */}
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
