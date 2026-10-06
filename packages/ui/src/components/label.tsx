"use client"

import type * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "../lib/utils"

// shadcn's label (radix-nova) without its disabled-state variants
// (group-data-[disabled=true]:*, peer-disabled:*). Every class here is one web
// already generates, so adding this file leaves web's CSS byte-for-byte the
// same: theme.css scans the whole package for both apps. Put a variant back
// when a disabled control needs it, and expect web's CSS to grow by it.
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        className
      )}
      {...props}
    />
  )
}

export { Label }
