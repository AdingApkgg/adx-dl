"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { motion, springSoft } from "@/components/motion"
import { cn } from "@/lib/utils"

// Mirrors Radix's active value so each trigger knows whether to host the
// sliding indicator (Radix exposes it only as a data attribute).
const TabsValueContext = React.createContext<string | undefined>(undefined)

// Per-list layoutId scope + variant, so multiple lists never share an indicator.
const TabsIndicatorContext = React.createContext<{
  layoutId: string
  variant: "default" | "line"
} | null>(null)

function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  // Tracks the value for uncontrolled usage; controlled usage reads `value`.
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const activeValue = value !== undefined ? value : uncontrolledValue
  return (
    <TabsValueContext.Provider value={activeValue}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(nextValue) => {
          setUncontrolledValue(nextValue)
          onValueChange?.(nextValue)
        }}
        className={cn(
          "group/tabs flex gap-2 data-horizontal:flex-col",
          className
        )}
        {...props}
      />
    </TabsValueContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const layoutId = React.useId()
  const indicator = React.useMemo(
    () => ({ layoutId, variant: variant ?? "default" }),
    [layoutId, variant]
  )
  return (
    <TabsIndicatorContext.Provider value={indicator}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsIndicatorContext.Provider>
  )
}

// Shared by TabsTrigger and by tab-styled controls that are not real ARIA tabs
// (e.g. the catalog's category filter buttons, which have no tab panels).
const tabsTriggerClassName = cn(
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
  "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
  "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100"
)

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const indicator = React.useContext(TabsIndicatorContext)
  const activeValue = React.useContext(TabsValueContext)
  const isActive = indicator !== null && activeValue === value
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        tabsTriggerClassName,
        // The sliding indicator below owns the active pill/underline, so the
        // trigger's own static active surface is suppressed (same-variant
        // overrides so tailwind-merge replaces them deterministically).
        indicator &&
          "data-active:bg-transparent dark:data-active:border-transparent dark:data-active:bg-transparent group-data-[variant=default]/tabs-list:data-active:shadow-none after:hidden",
        className
      )}
      {...props}
    >
      {isActive ? (
        <motion.span
          aria-hidden="true"
          layoutId={indicator.layoutId}
          initial={false}
          transition={springSoft}
          className={
            indicator.variant === "line"
              ? "absolute bg-foreground group-data-horizontal/tabs:inset-x-0 group-data-horizontal/tabs:bottom-[-5px] group-data-horizontal/tabs:h-0.5 group-data-vertical/tabs:inset-y-0 group-data-vertical/tabs:-right-1 group-data-vertical/tabs:w-0.5"
              : "absolute inset-0 rounded-md bg-background shadow-sm dark:border dark:border-input dark:bg-input/30"
          }
        />
      ) : null}
      {/* Painted after the indicator so the label rides above the pill. */}
      <span className="relative inline-flex items-center gap-1.5">
        {children}
      </span>
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants, tabsTriggerClassName }
