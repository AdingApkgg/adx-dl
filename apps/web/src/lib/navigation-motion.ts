/** Installed before hydration so native page lifecycle events cannot be missed. */
export function navigationMotionBootScript(): string {
  return `(() => {
    const root = document.documentElement;
    const key = 'astrodx-pending-navigation-v1';
    let generation = 0;
    const clear = () => root.removeAttribute('data-navigation-fallback');
    window.addEventListener('pageswap', event => {
      generation++;
      clear();
      try {
        sessionStorage.removeItem(key);
        const activation = event.activation;
        if (!activation || !['push', 'replace'].includes(activation.navigationType)) return;
        const target = new URL(activation.entry.url);
        if (target.origin !== location.origin || target.pathname + target.search === location.pathname + location.search) return;
        sessionStorage.setItem(key, JSON.stringify({ url: target.href, time: Date.now() }));
      } catch {}
    });
    window.addEventListener('pagereveal', event => {
      const current = ++generation;
      clear();
      let pending;
      try {
        pending = JSON.parse(sessionStorage.getItem(key) || 'null');
        sessionStorage.removeItem(key);
      } catch { return; }
      if (!pending || pending.url !== location.href || typeof pending.time !== 'number' || Date.now() - pending.time < 0 || Date.now() - pending.time > 30000) return;
      const recover = () => {
        if (current !== generation || root.hasAttribute('data-reduced-motion') || root.dataset.motion === 'off' || root.dataset.compatibility === 'simple') return;
        root.setAttribute('data-navigation-fallback', '');
        // A safety release if a route has no main animation or CSS cannot load.
        window.setTimeout(clear, 5000);
      };
      if (event.viewTransition) event.viewTransition.ready.catch(recover);
      else recover();
    });
    document.addEventListener('animationend', event => {
      if (event.animationName === 'adx-page-enter' && event.target?.id === 'main-content') clear();
    });
  })();`;
}
