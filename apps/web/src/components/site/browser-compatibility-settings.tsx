"use client";

import { choiceClass } from "@astrodx/ui/components/appearance-pickers";
import { getBrowserCompatibilityCopy } from "@/lib/browser-compatibility-copy";
import { setCompatibilityPreference } from "@/lib/browser-compatibility-preference";
import type { Locale } from "@/lib/i18n";
import { useSimpleCompatibility } from "./browser-compatibility-provider";
import { BrowserDiagnostics } from "./browser-diagnostics";

export function BrowserCompatibilitySettings({ locale }: { locale: Locale }) {
  const copy = getBrowserCompatibilityCopy(locale);
  const enabled = useSimpleCompatibility();
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-border p-3" aria-label={copy.title}>
      <h3 className="text-sm font-medium">{copy.mode}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{copy.description}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {[false, true].map((value) => <button key={String(value)} type="button" aria-pressed={enabled === value} onClick={() => setCompatibilityPreference(value)} className={`${choiceClass(enabled === value)} min-h-11 whitespace-normal`}>
          {value ? copy.simple : copy.normal}
        </button>)}
      </div>
      <details className="min-w-0">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">{copy.diagnostics}</summary>
        <BrowserDiagnostics locale={locale} />
      </details>
    </section>
  );
}
