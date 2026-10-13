import type { Locale } from "@/lib/i18n";
import { getLive2DCopy } from "./live2d-copy";
import { MascotControls, MascotCornerToggle, MascotStage } from "./mascot-stage";

/**
 * /live2d: a page of her own. The corner mascot only shows on wide screens
 * with a mouse (and not in simple compatibility mode, nor once dismissed);
 * here she shows for everyone, with real buttons instead of a hover toolbar.
 * No scroll-reveal on the stage: she is anchored to it, and a transform would
 * leave her standing where the slot is about to be.
 */
export function MascotPageView({ locale }: { locale: Locale }) {
  const copy = getLive2DCopy(locale);
  const page = copy.page;
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{page.title}</h1>
        <p className="text-muted-foreground">{page.description}</p>
      </div>
      <div className="grid gap-8 md:grid-cols-[minmax(0,21.5625rem)_minmax(0,1fr)] md:items-start">
        <MascotStage locale={locale} />
        <div className="flex flex-col gap-8 md:pt-6">
          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">{page.actionsTitle}</h2>
            <MascotControls locale={locale} />
            <p className="text-sm text-muted-foreground">{page.tapHint}</p>
          </section>
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold">{page.cornerTitle}</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {copy.settings.description}
              </p>
            </div>
            <MascotCornerToggle locale={locale} />
          </section>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <a
              className="underline underline-offset-4 hover:text-foreground"
              href="https://github.com/AdingApkgg/live2d-api"
              target="_blank"
              rel="noreferrer"
            >
              {page.credits}
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
