// App preferences (not secrets), kept in the WebView's localStorage.
export interface Settings {
  /** Close an open vault after this many idle minutes; 0 = never. */
  autoLockMinutes: number;
  /** Clear a copied value from the clipboard after this many seconds; 0 = never. */
  clipboardClearSeconds: number;
  /** When true, drag and drop of groups and entries is off. */
  layoutLocked: boolean;
}

const KEY = "sectauri.settings";
const DEFAULTS: Settings = { autoLockMinutes: 15, clipboardClearSeconds: 30, layoutLocked: false };

export function getSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
