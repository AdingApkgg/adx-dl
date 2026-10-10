export const COMPATIBILITY_STORAGE_KEY = "astrodx-browser-compatibility-v1";
const CHANGE_EVENT = "astrodx-browser-compatibility-change";
let sessionPreference: boolean | null = null;

export function readCompatibilityPreference(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(COMPATIBILITY_STORAGE_KEY) === "simple";
  } catch {
    return false;
  }
}

export function getCompatibilitySnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionPreference !== null) return sessionPreference;
  try {
    return readCompatibilityPreference(window.localStorage);
  } catch {
    return false;
  }
}

export function syncCompatibilityAttribute(): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.compatibility = getCompatibilitySnapshot() ? "simple" : "normal";
  }
}

export function setCompatibilityPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  sessionPreference = enabled;
  try {
    window.localStorage.setItem(COMPATIBILITY_STORAGE_KEY, enabled ? "simple" : "normal");
  } catch {
    // A blocked store must not prevent the setting from working in this tab.
  }
  syncCompatibilityAttribute();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCompatibilityPreference(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== COMPATIBILITY_STORAGE_KEY) return;
    sessionPreference = null;
    syncCompatibilityAttribute();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

/** Shares its key and value with the runtime preference; runs before paint. */
export function compatibilityBootScript(): string {
  return `(function(){var e=document.documentElement;try{e.dataset.compatibility=localStorage.getItem(${JSON.stringify(COMPATIBILITY_STORAGE_KEY)})==='simple'?'simple':'normal';}catch(x){e.dataset.compatibility='normal';}})();`;
}
