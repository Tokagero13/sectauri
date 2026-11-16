// Anything outside printable ASCII in a login or password usually means the keyboard is
// on another layout (e.g. Russian): "пароль" typed instead of "gfhjkm".
export function hasNonLatin(value: string): boolean {
  return /[^\x20-\x7e]/.test(value);
}

export function formatTime(unixSeconds: number | null): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString();
}
