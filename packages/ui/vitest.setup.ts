import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Runs after every test in the package. Components and providers write to
// localStorage and to <html> (the dark class, color-scheme, data-accent,
// data-motion, data-reduced-motion), so each test starts from a blank page.
afterEach(() => {
  // ThemeProvider keeps the last choice in module state; a storage event makes
  // it re-read localStorage. Send it while the provider is still mounted.
  window.dispatchEvent(new StorageEvent("storage"));
  cleanup();
  window.localStorage.clear();
  const html = document.documentElement;
  html.removeAttribute("class");
  html.removeAttribute("style");
  for (const name of html.getAttributeNames()) {
    if (name.startsWith("data-")) html.removeAttribute(name);
  }
});
