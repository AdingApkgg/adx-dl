"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Sheet(
  props: React.ComponentProps<typeof SheetPrimitive.Root>
) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(
  props: React.ComponentProps<typeof SheetPrimitive.Trigger>
) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(
  props: React.ComponentProps<typeof SheetPrimitive.Close>
) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * Where the panel sits. `side` is the original right-hand drawer; the other two
 * exist so the chart-detail panels can drop their hand-rolled `motion.div`
 * dialogs — those had `role="dialog"`, Esc and a scroll lock, but no focus
 * trap, no initial focus and no focus restore, all of which Radix provides.
 */
type SheetVariant = "side" | "centered" | "fullscreen";

const sheetVariantClass: Record<SheetVariant, string> = {
  side: cn(
    "inset-y-0 right-0 h-dvh w-full max-w-2xl border-l border-border",
    "data-closed:slide-out-to-right-8 data-open:slide-in-from-right-8"
  ),
  // `inset-0 + m-auto` centers without a transform. A translate-based centering
  // would be overwritten mid-animation: tw-animate-css's enter/exit keyframes
  // set `transform` wholesale, so the panel would snap to the top-left corner
  // for the duration of the fade.
  centered: cn(
    "inset-0 m-auto h-fit max-h-[min(88vh,760px)] w-[calc(100vw-2rem)] max-w-4xl rounded-xl border border-border/70",
    "data-closed:zoom-out-95 data-open:zoom-in-95"
  ),
  fullscreen: cn(
    "inset-0 h-dvh w-full",
    "data-closed:slide-out-to-bottom-4 data-open:slide-in-from-bottom-4"
  ),
};

function SheetContent({
  className,
  children,
  closeLabel = "Close",
  variant = "side",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  closeLabel?: string;
  variant?: SheetVariant;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        data-motion-sensitive=""
        className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[2px] data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-motion-sensitive=""
        className={cn(
          "fixed z-[91] flex flex-col bg-background shadow-2xl outline-none",
          "data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0",
          sheetVariantClass[variant],
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          aria-label={closeLabel}
          title={closeLabel}
          className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <XIcon className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("space-y-1.5", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
