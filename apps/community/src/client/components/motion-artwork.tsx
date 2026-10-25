import { motion, useSpring } from "@astrodx/ui/motion";
import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { useFinePointer, useMotionEnabled } from "./motion-preference";

const SPRING = { stiffness: 240, damping: 25, mass: 0.55 };

/** Pointer feedback belongs to the artwork, never the link, form or player. */
export function MotionArtwork({ children }: { children: ReactNode }) {
  const allowed = useMotionEnabled(), fine = useFinePointer();
  const enabled = allowed && fine;
  const bounds = useRef<DOMRect | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const rotateX = useSpring(0, SPRING), rotateY = useSpring(0, SPRING);
  const scale = useSpring(1, SPRING);
  const lightX = useSpring(0, SPRING), lightY = useSpring(0, SPRING);
  const light = useSpring(0, SPRING);
  const reset = useCallback((immediate = false) => {
    bounds.current = null;
    detach.current?.(); detach.current = null;
    if (immediate) {
      rotateX.jump(0); rotateY.jump(0); scale.jump(1);
      lightX.jump(0); lightY.jump(0); light.jump(0);
    } else {
      rotateX.set(0); rotateY.set(0); scale.set(1); light.set(0);
    }
  }, [rotateX, rotateY, scale, lightX, lightY, light]);
  useEffect(() => {
    if (!enabled) reset(true);
    return () => reset(true);
  }, [enabled, reset]);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType !== "mouse") return;
    if (!bounds.current) {
      bounds.current = event.currentTarget.getBoundingClientRect();
      // Only the currently hovered cover registers these listeners.
      const settle = () => reset(true);
      window.addEventListener("blur", settle);
      window.addEventListener("resize", settle);
      window.addEventListener("scroll", settle, { capture: true, passive: true });
      detach.current = () => {
        window.removeEventListener("blur", settle);
        window.removeEventListener("resize", settle);
        window.removeEventListener("scroll", settle, true);
      };
    }
    const rect = bounds.current;
    if (!rect.width || !rect.height) return;
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5));
    rotateX.set(-y * 10); rotateY.set(x * 10); scale.set(1.03);
    lightX.set(x * rect.width * 0.6); lightY.set(y * rect.height * 0.6); light.set(1);
  }
  return <div className="community-artwork-motion" data-community-motion="artwork"
    onPointerMove={move} onPointerLeave={() => reset()} onPointerCancel={() => reset(true)}>
    <motion.div className="community-artwork-plate" style={enabled ? { rotateX, rotateY, scale, transformPerspective: 850 } : { rotateX: 0, rotateY: 0, scale: 1 }}>
      {children}
    </motion.div>
    <motion.span aria-hidden="true" className="community-artwork-sheen" style={enabled ? { x: lightX, y: lightY, opacity: light } : { opacity: 0 }} />
  </div>;
}
