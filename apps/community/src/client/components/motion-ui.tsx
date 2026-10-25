import { Card } from "@astrodx/ui/components/card";
import { DrawnCheck, EASE_OUT, motion, springSoft, useAnimate, useReducedMotion } from "@astrodx/ui/motion";
import { cn } from "@astrodx/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import { Children, createContext, createElement, isValidElement, useCallback, useContext, useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { useLocation } from "react-router";
import { motionBlocked, useMotionEnabled } from "./motion-preference";

const MotionCard = motion.create(Card);
const CascadeContext = createContext(0);
const VIEWPORT = { once: true, amount: 0.15 };

type MotionTone = "content" | "title" | "feature" | "dock";
const ENTER = {
  content: { distance: 18, duration: 0.48 },
  title: { distance: 24, duration: 0.58 },
  feature: { distance: 32, duration: 0.7 },
  dock: { distance: 0, duration: 0.46 },
  route: { distance: 16, duration: 0.44 },
};

function useEnterMotion(tone: MotionTone | "route" = "content") {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduced = useReducedMotion();
  const active = useRef<ReturnType<typeof animate> | null>(null);
  const settle = useCallback(() => {
    // stop() alone would commit a half-finished offset. Finish first so a
    // navigation or preference change cannot leave controls displaced.
    active.current?.complete();
    active.current?.stop();
    active.current = null;
  }, []);
  useEffect(() => {
    if (reduced) settle();
    return settle;
  }, [reduced, settle]);
  const enter = useCallback((delay = 0) => {
    settle();
    if (!scope.current || motionBlocked(reduced)) return;
    const { distance, duration } = ENTER[tone];
    // Anchored surfaces (dock) sit inside a fixed safe gap: a positive y offset
    // would push them under the bottom nav, so they scale in place instead.
    const target = tone === "dock"
      ? { opacity: [0.9, 1], scale: [0.96, 1] }
      : { opacity: [tone === "route" ? 1 : 0.9, 1], y: [distance, 0] };
    active.current = animate(scope.current, target, {
      duration, ease: EASE_OUT, delay,
    });
  }, [animate, reduced, scope, settle, tone]);
  return { scope, enter };
}

/** No location key and no exit snapshot: router children keep their instances. */
export function RouteMotion({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const { scope, enter } = useEnterMotion("route");
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    enter();
  }, [pathname, enter]);
  return <div ref={scope} className="min-w-0" data-community-motion="route">{children}</div>;
}

type SurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, "style" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & {
  as?: "div" | "article" | "section" | "li" | "aside" | "header" | "card";
  hover?: boolean;
  tone?: MotionTone;
};

/** Visible SSR; an optional one-time reveal never owns a child's lifecycle. */
export function MotionSurface({ as = "div", hover = false, tone = "content", className, children, ...props }: SurfaceProps) {
  const { scope, enter } = useEnterMotion(tone);
  const delay = useContext(CascadeContext);
  const entered = useRef(false);
  // The tags share the DOM attributes used here; the element stays semantic.
  const Tag = (as === "card" ? MotionCard : motion[as]) as typeof motion.div;
  return <Tag {...props} ref={scope} initial={false} viewport={VIEWPORT}
    onViewportEnter={() => { if (!entered.current) { entered.current = true; enter(delay); } }}
    className={cn(className, hover && "community-motion-hover")} data-community-motion="surface" data-motion-tone={tone}>
    {children}
  </Tag>;
}

/** Context adds no DOM between semantic lists and their keyed items. */
export function MotionGroup({ as = "div", children, ...props }: HTMLAttributes<HTMLElement> & { as?: "div" | "ul" | "ol" }) {
  let index = 0;
  const items = Children.map(children, child => isValidElement(child)
    ? <CascadeContext.Provider value={Math.min(index++, 5) * 0.055}>{child}</CascadeContext.Provider>
    : child);
  return createElement(as, props, items);
}

/** Only a decorative, bounded navigation surface participates in layout. */
export function NavigationIndicator({ group }: { group: string }) {
  const reduced = useReducedMotion();
  // Replacing only the decorative node also cancels an in-flight projection.
  if (reduced) return <span aria-hidden="true" className="community-nav-indicator"><span className="community-nav-spark" /></span>;
  return <motion.span aria-hidden="true" className="community-nav-indicator" initial={false}
    layoutId={`community-nav-${group}`} transition={{ ...springSoft, stiffness: 390, damping: 32 }}><span className="community-nav-spark" /></motion.span>;
}

export function MotionSuccess() {
  const enabled = useMotionEnabled();
  return <span className="community-motion-success inline-flex shrink-0 text-primary" aria-hidden="true">
    {enabled ? <motion.span className="community-success-ripple" initial={{ scale: 0.65, opacity: 0.4 }}
      animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 0.55, ease: EASE_OUT }} /> : null}
    {!enabled ? <CheckIcon className="size-4" /> : <DrawnCheck size={16} withCircle={false} />}
  </span>;
}
