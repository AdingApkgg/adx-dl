/**
 * Whether the visitor dismissed the Live2D mascot. Shared by the mascot's own
 * "goodbye" button and the toggle in the settings panel, so either one can
 * bring her back. Same shape as browser-compatibility-preference.ts.
 */
export const MASCOT_HIDDEN_STORAGE_KEY = "astrodx-waifu-hidden";
const CHANGE_EVENT = "astrodx-waifu-hidden-change";
let sessionPreference: boolean | null = null;

export function readMascotHidden(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(MASCOT_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function getMascotHiddenSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionPreference !== null) return sessionPreference;
  try {
    return readMascotHidden(window.localStorage);
  } catch {
    return false;
  }
}

export function setMascotHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  sessionPreference = hidden;
  try {
    window.localStorage.setItem(MASCOT_HIDDEN_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // A blocked store must not prevent the setting from working in this tab.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeMascotHidden(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MASCOT_HIDDEN_STORAGE_KEY) return;
    sessionPreference = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}
