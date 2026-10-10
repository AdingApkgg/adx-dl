# Independent chart preview routes — 2026-10-10

Implemented `/preview/[slug]` and its English/Japanese locale routes. Detail pages expose ordinary preview and difficulty links; preview pages retain the existing player, difficulty selection and a return link. Preview pages have their own title, description, canonical, language alternates and sitemap entries. Entries without maidata have no preview page.

Legacy detail URLs with `preview=1` redirect on the client to the new route, preserving difficulty, beat, other query parameters and the fragment. New time-sharing links use the preview route directly.

## Validation

- Web check: 673 tests passed, 0 failed; TypeScript passed.
- Biome lint: 697 files passed.
- Chromium and WebKit at 390 × 844: all seven scenarios passed, including detail navigation, canonical/return/difficulty links, difficulty switching inside and outside the player, legacy English links retaining `diff=4&beat=2.50`, new sharing URLs, Japanese static content with JavaScript disabled, and no page errors.
- Independent review identified a difficulty synchronization defect. The player now synchronizes valid difficulty changes with the URL. `history.replaceState(null, ...)` allows Next.js to update search parameter subscribers while retaining its internal history state. Passing the existing Next.js history flags bypassed that synchronization; the browser regression scenario reproduced the failure and passed after the fix.
- WebKit temporarily retained outgoing metadata during the page transition. Once the transition completed, exactly one canonical remained with the new preview URL. Direct navigation with JavaScript disabled also returned the expected canonical and static content.

Browser tests used real local maidata for chart 11805. Remote audio/video requests were replaced with local media fixtures, and clipboard writes were captured by the test. These checks do not verify production media availability or physical iOS devices.

No full production build or deployment was performed. Machine-readable browser results are in the adjacent JSON report.
