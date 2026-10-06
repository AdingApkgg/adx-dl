import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/utils"

// shadcn's alert (radix-nova) without the icon grid (has-[>svg]:*, *:[svg]:*),
// the action slot (AlertAction), the link styling inside the text, and three
// rules on AlertDescription: the destructive-variant rule that recolours it to
// the destructive colour at 90% opacity, the balanced/pretty text wrapping, and
// the margin between its paragraphs. Every class here is one web already
// generates, so adding this file leaves web's CSS byte-for-byte the same
// (theme.css scans the whole package for both apps). Restoring any of them
// grows web's CSS by those rules.
//
// Because the recolouring is gone, AlertDescription keeps text-muted-foreground
// even inside a destructive Alert, so its text renders grey, not in the warning
// colour. In a destructive Alert put the message directly inside <Alert>, or
// pass AlertDescription a className with text-destructive (web already
// generates it, and cn's tailwind-merge lets it override the muted colour).
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "bg-card text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
