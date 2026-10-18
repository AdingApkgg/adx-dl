import { Button } from "@astrodx/ui/components/button";
import { Input } from "@astrodx/ui/components/input";
import { Share2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { localizeHref } from "@/paraglide/runtime.js";
import { m } from "@/paraglide/messages.js";

export function ShareChartButton({ title, publicId }: { title: string; publicId: string }) {
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (manualUrl) { input.current?.focus(); input.current?.select(); }
  }, [manualUrl]);

  async function share() {
    if (busy) return;
    const locale = /^\/(en|ja)(?:\/|$)/.exec(pathname)?.[1];
    const path = locale ? `/${locale}/charts/${publicId}` : localizeHref(`/charts/${publicId}`);
    const url = new URL(path, window.location.origin).href;
    setBusy(true); setCopied(false); setManualUrl(null);
    try {
      if (typeof navigator.share === "function") {
        try { await navigator.share({ title, url }); return; }
        catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
      }
      if (typeof navigator.clipboard?.writeText !== "function") { setManualUrl(url); return; }
      try { await navigator.clipboard.writeText(url); setCopied(true); }
      catch { setManualUrl(url); }
    } finally { setBusy(false); }
  }
  return <>
    <Button ref={button} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void share()}>
      <Share2Icon aria-hidden="true" />{m.public_chart_share()}
    </Button>
    {copied ? <p role="status" className="basis-full text-sm text-muted-foreground">{m.public_chart_link_copied()}</p> : null}
    {manualUrl ? <div className="w-full basis-full space-y-2 rounded-lg border p-3">
      <p className="text-sm">{m.public_chart_copy_manually()}</p>
      <Input ref={input} aria-label={m.public_chart_link()} readOnly value={manualUrl} onFocus={event => event.currentTarget.select()} />
      <Button type="button" size="sm" variant="outline" onClick={() => { setManualUrl(null); button.current?.focus(); }}>{m.public_chart_link_close()}</Button>
    </div> : null}
  </>;
}
