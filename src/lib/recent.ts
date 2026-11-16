// Recently opened vaults, persisted in the WebView's localStorage (survives app
// restarts). We store only file paths + display metadata — never passwords.
export interface RecentVault {
  path: string;
  name: string;
  openedAt: number;
}

const KEY = "sectauri.recentVaults";
const MAX = 8;

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function getRecent(): RecentVault[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentVault[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecent(path: string): RecentVault[] {
  const others = getRecent().filter((v) => v.path !== path);
  const list = [{ path, name: fileName(path), openedAt: Date.now() }, ...others].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function removeRecent(path: string): RecentVault[] {
  const list = getRecent().filter((v) => v.path !== path);
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

// Recently used entries per vault (entry id -> last use, ms). Kept outside the vault,
// so viewing or copying an entry does not make the vault "unsaved".
const USED_KEY = "sectauri.recentEntries";
const USED_MAX = 50;

type UsedMap = Record<string, Record<string, number>>;

function readUsed(): UsedMap {
  try {
    return (JSON.parse(localStorage.getItem(USED_KEY) ?? "{}") as UsedMap) ?? {};
  } catch {
    return {};
  }
}

export function markEntryUsed(vaultPath: string, entryId: string): void {
  const all = readUsed();
  const used = { ...(all[vaultPath] ?? {}), [entryId]: Date.now() };
  const kept = Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, USED_MAX);
  all[vaultPath] = Object.fromEntries(kept);
  localStorage.setItem(USED_KEY, JSON.stringify(all));
}

export function entriesUsed(vaultPath: string): Record<string, number> {
  return readUsed()[vaultPath] ?? {};
}
