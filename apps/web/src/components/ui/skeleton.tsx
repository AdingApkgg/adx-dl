import * as React from "react"

import { cn } from "@/lib/utils"

function Skeleton({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      {/* One compositor-driven sweep shared by every instance — the keyframes
          live in globals.css (.shimmer-sweep), which also disables the loop
          under prefers-reduced-motion. */}
      <span className="shimmer-sweep pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
      {children}
    </div>
  )
}

export { Skeleton }
