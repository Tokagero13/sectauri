// Small building blocks shared by several screens.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, type CopyField } from "../lib/api";
import { hasNonLatin } from "../lib/text";
import { useVault } from "../store";

/** Native yes/no dialog for actions that lose data. */
export function confirmDanger(message: string, title = "Sectauri"): Promise<boolean> {
  return ask(message, { title, kind: "warning" });
}

/** Live hint under a login or password field typed on a non-Latin keyboard layout. */
export function LayoutWarning({ value }: { value: string }) {
  if (!hasNonLatin(value)) return null;
  return (
    <div className="layout-warning" role="alert">
      ⚠ Non-Latin characters (e.g. Cyrillic) — check your keyboard layout.
    </div>
  );
}

/** Copies one entry field through the backend and confirms with a short "Copied!". */
export function CopyButton({
  entryId,
  field,
  label,
  onCopied,
}: {
  entryId: string;
  field: CopyField;
  label?: string;
  onCopied?: () => void;
}) {
  const seconds = useVault((s) => s.settings.clipboardClearSeconds);
  const setError = useVault((s) => s.setError);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.copyField(entryId, field, seconds);
      onCopied?.();
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      setError(String(err));
    }
  }

  const what = field === "password" ? "password" : field;
  return (
    <button
      className={`icon copy-btn${copied ? " copied" : ""}`}
      title={seconds > 0 ? `Copy ${what} (clears in ${seconds}s)` : `Copy ${what}`}
      onClick={copy}
    >
      {copied ? "Copied!" : label ?? (field === "password" ? "🔑" : "👤")}
    </button>
  );
}

/** Positioned menu that closes on an outside click or Escape. */
export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu inside the window.
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - 320);
  return (
    <div
      className="context-menu"
      style={{ left: Math.max(4, left), top: Math.max(4, top) }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

/** Modal with one text input (group names); resolves through onSubmit or onCancel. */
export function NameDialog({
  title,
  initial = "",
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = () => name.trim() && onSubmit(name.trim());
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <input
          className="full"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={!name.trim()}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
