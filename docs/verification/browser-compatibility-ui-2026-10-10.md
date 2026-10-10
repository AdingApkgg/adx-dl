# Browser compatibility UI verification — 2026-10-10

This change is local and has not been deployed. Preview: http://localhost:3012/charts/1154.

## Implemented behavior

- Settings → Appearance → Browser compatibility offers standard and simplified UI. Simplification reduces animation, disables blur and adds solid surfaces; saved motion preference is restored when simplification is disabled.
- Explicit light theme uses `color-scheme: only light`. Missing `matchMedia` falls back to dark consistently before paint and after hydration. This is not a guarantee against vendor browser transformations.
- On-demand diagnostics performs a small, isolated IndexedDB Blob write/read, reports actual storage failures and remains manually selectable when clipboard access fails. Reports stay local; URL credentials, queries and fragments are stripped.
- JavaScript-disabled visitors receive a static message and an import/troubleshooting guide link.
- Large text and forced-color controls remain usable; zoom is not disabled. Download status and long filenames wrap.
- Denied `localStorage` property access no longer crashes music snapshot initialization or download preference hydration. Preference changes remain usable in memory when persistence is blocked.

## Overflow reproduction and correction

At 320/390px viewport width and 32px root font size, the detail grid and download block previously retained min-content width; progress tracks measured approximately 441/545px and extended beyond the viewport. A `minmax(0, 1fr)` grid column, shrinkable wrappers, wrapped status/source/save controls and flexible header actions correct the underlying sizing.

Chromium and WebKit checks at 320, 390 and 1024px with 32px root font now report document widths equal to the viewport and progress track widths of 158, 228 and 490px respectively. Download content has no overflow. Decorative progress animation is intentionally clipped by its track.

## Validation

- Web TypeScript + 667 tests; UI TypeScript + 38 tests; repository lint (690 files); diff whitespace check passed.
- Chromium and WebKit: mode toggle, persistence across reload, diagnostic Blob probe, clipboard-unavailable fallback, restoration of normal mode, explicit light theme and static no-JS help passed.
- Chromium fault injection: quota failure reports `quota` and save-in-batches guidance; denied localStorage getter reports unavailable preference writes while settings continue working. Forced-colors selected controls retain a visible outline.
- Regression tests failed before the relevant fixes: simplified motion override, compatibility settings, explicit light theme, missing matchMedia boot fallback, denied storage hydration.
- Independent read-only review covered preference subscriptions, motion restoration, diagnostic cleanup/privacy, layout and storage access protection. Reported missing-matchMedia boot/runtime inconsistency was corrected and re-reviewed.

## Limits

No physical iPhone/iPad, Huawei or low-memory phone was available. Browser engine checks do not establish compatibility with every vendor browser. This WebKit test environment cannot complete an IndexedDB Blob round trip; the diagnostic reports that failure and displays the fallback rather than treating API presence as successful storage. No local production build or deployment was performed.

Machine-readable evidence: [browser-compatibility-ui-2026-10-10.json](browser-compatibility-ui-2026-10-10.json).

## Split download button follow-up

On `/charts/11805` at 390px, the main download button measured 44px high while its format arrow retained the original 32px icon size. The arrow now has a 44px minimum target and stretches to the main button height. Chromium verified equal heights in standard and simplified UI at 16px and 32px root font; the document remains within the viewport. Focused lint and diff whitespace checks passed.
