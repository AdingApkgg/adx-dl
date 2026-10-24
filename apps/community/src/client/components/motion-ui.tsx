import { Card } from "@astrodx/ui/components/card";
import { DrawnCheck, EASE_OUT, motion, springSoft, useAnimate, useReducedMotion } from "@astrodx/ui/motion";
import { cn } from "@astrodx/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import { Children, createContext, createElement, isValidElement, useCallback, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useLocation } from "react-router";

const MotionCard = motion.create(Card);
const CascadeContext = createContext(0);
const VIEWPORT = { once: true, amount: 0.15 };

// Read the boot-script preference as well: the provider synchronizes after
// hydration, while an IntersectionObserver can fire during that first frame.
function motionBlocked(reduced: boolean) {
  if (typeof document === "undefined") return true;
  const mode = document.documentElement.dataset.motion;
  if (mode === "off") return true;
  if (mode === "on") return false;
  return reduced || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function useEnterMotion() {
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
    active.current = animate(scope.current, { opacity: [0.92, 1], y: [8, 0] }, {
      duration: 0.32, ease: EASE_OUT, delay,
    });
  }, [animate, reduced, scope, settle]);
  return { scope, enter };
}

/** No location key and no exit snapshot: router children keep their instances. */
export function RouteMotion({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const { scope, enter } = useEnterMotion();
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
};

/** Visible SSR; an optional one-time reveal never owns a child's lifecycle. */
export function MotionSurface({ as = "div", hover = false, className, children, ...props }: SurfaceProps) {
  const { scope, enter } = useEnterMotion();
  const delay = useContext(CascadeContext);
  const entered = useRef(false);
  // The tags share the DOM attributes used here; the element stays semantic.
  const Tag = (as === "card" ? MotionCard : motion[as]) as typeof motion.div;
  return <Tag {...props} ref={scope} initial={false} viewport={VIEWPORT}
    onViewportEnter={() => { if (!entered.current) { entered.current = true; enter(delay); } }}
    className={cn(className, hover && "community-motion-hover")} data-community-motion="surface">
    {children}
  </Tag>;
}

/** Context adds no DOM between semantic lists and their keyed items. */
export function MotionGroup({ as = "div", children, ...props }: HTMLAttributes<HTMLElement> & { as?: "div" | "ul" | "ol" }) {
  let index = 0;
  const items = Children.map(children, child => isValidElement(child)
    ? <CascadeContext.Provider value={Math.min(index++, 6) * 0.035}>{child}</CascadeContext.Provider>
    : child);
  return createElement(as, props, items);
}

/** Only a decorative, bounded navigation surface participates in layout. */
export function NavigationIndicator({ group }: { group: string }) {
  const reduced = useReducedMotion();
  // Replacing only the decorative node also cancels an in-flight projection.
  if (reduced) return <span aria-hidden="true" className="community-nav-indicator" />;
  return <motion.span aria-hidden="true" className="community-nav-indicator" initial={false}
    layoutId={`community-nav-${group}`} transition={springSoft} />;
}

export function MotionSuccess() {
  const reduced = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return <span className="inline-flex shrink-0 text-primary" aria-hidden="true">
    {!hydrated || motionBlocked(reduced) ? <CheckIcon className="size-4" /> : <DrawnCheck size={16} withCircle={false} />}
  </span>;
}
