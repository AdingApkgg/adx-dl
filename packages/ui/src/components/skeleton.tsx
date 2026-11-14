"use client"

import * as React from "react"
import { useMotionActivity } from "../motion/provider"

import { cn } from "../lib/utils"

function Skeleton({ className, children, ref: forwardedRef, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement)
  const active = useMotionActivity(ref)
  return (
    <div
      data-slot="skeleton"
      data-motion-active={active}
      ref={ref}
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      {/* One compositor-driven sweep shared by every instance — the keyframes
          live in styles/theme.css (.shimmer-sweep), which also disables the loop
          under prefers-reduced-motion. */}
      <span className="shimmer-sweep pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
      {children}
    </div>
  )
}

export { Skeleton }
