import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMotionEnabled } from "./motion-preference";

export function ScrollingChartLabel({ text, children }: { text: string; children?: ReactNode }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const enabled = useMotionEnabled();
  const [shift, setShift] = useState(0);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const viewport = outer.current;
    const content = inner.current;
    if (!viewport || !content || typeof ResizeObserver === "undefined" || typeof IntersectionObserver === "undefined") return;
    const measure = () => setShift(Math.max(0, content.offsetWidth - viewport.clientWidth));
    measure();
    const size = new ResizeObserver(measure);
    size.observe(viewport);
    size.observe(content);
    const visibility = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    visibility.observe(viewport);
    return () => {
      size.disconnect();
      visibility.disconnect();
    };
  }, []);

  const scrolling = enabled && shift > 1;
  return (
    <span ref={outer} title={text} className="block overflow-hidden whitespace-nowrap">
      <span
        ref={inner}
        className="inline-block"
        style={scrolling ? ({
          animation: `community-chart-marquee ${Math.max(6, shift / 10 + 3)}s ease-in-out infinite`,
          animationPlayState: inView ? "running" : "paused",
          "--community-chart-marquee-shift": `-${shift}px`,
        } as CSSProperties) : undefined}
      >
        {children ?? text}
      </span>
    </span>
  );
}
