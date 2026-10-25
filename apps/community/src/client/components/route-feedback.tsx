import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigation } from "react-router";
import { m } from "@/paraglide/messages.js";

/** Keep the previous page mounted while a loader runs; never cache private page labels here. */
export function RouteFeedback() {
  const navigation = useNavigation(), location = useLocation(), pending = navigation.state !== "idle";
  const [visible, setVisible] = useState(false);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (pending) return;
    const changed = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (!changed || location.hash) return;
    const focusAtCommit = document.activeElement, hashAtCommit = window.location.hash;
    const frame = requestAnimationFrame(() => {
      // Explicit focus/input or a native hash can change before the router's next effect.
      const active = document.activeElement;
      if (active !== focusAtCommit || window.location.hash !== hashAtCommit || active?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      // A global settings sheet can stay open during Back. Its focus trap owns focus.
      if (document.querySelector('[role="dialog"]:not([data-state="closed"]),[role="alertdialog"]:not([data-state="closed"]),dialog[open]')) return;
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, location.pathname, location.hash]);
  return <><p role="status" className="sr-only" aria-atomic="true">{pending ? m.ui_route_loading() : ""}</p>{pending && visible ? <div role="progressbar" aria-label={m.ui_route_loading()} className="community-route-progress"><span aria-hidden="true" /></div> : null}</>;
}
