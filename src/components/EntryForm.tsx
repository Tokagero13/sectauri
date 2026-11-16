import { useEffect, useRef, useState } from "react";
import { api, type CustomField, type EntryInput } from "../lib/api";
import { useVault } from "../store";
import { confirmDanger, LayoutWarning } from "./common";

type Standard = Omit<EntryInput, "custom">;
const EMPTY: Standard = { title: "", username: "", password: "", url: "", notes: "" };

export function EntryForm({ entryId }: { entryId: string }) {
  const { markDirty, refreshTree, deleteEntry, setError, setPendingApply } = useVault();
  const clearSeconds = useVault((s) => s.settings.clipboardClearSeconds);
  const [form, setForm] = useState<Standard>(EMPTY);
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [reveal, setReveal] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  // What the backend holds, to tell unapplied edits (a draft) apart.
  const [loaded, setLoaded] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setReveal(false);
    setRevealed(new Set());
    api
      .getEntry(entryId)
      .then((detail) => {
        if (!alive) return;
        const standard = {
          title: detail.title,
          username: detail.username,
          password: detail.password,
          url: detail.url,
          notes: detail.notes,
        };
        const extra = detail.extra.map((f) => ({ ...f }));
        setForm(standard);
        setCustom(extra);
        setLoaded(JSON.stringify({ form: standard, custom: extra }));
      })
      .catch((e) => setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entryId, setError]);

  function field<K extends keyof Standard>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateCustom(i: number, patch: Partial<CustomField>) {
    setCustom((list) => list.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function addCustom() {
    setCustom((list) => [...list, { key: "", value: "", protected: false }]);
  }

  function removeCustom(i: number) {
    setCustom((list) => list.filter((_, idx) => idx !== i));
    setRevealed((r) => {
      const next = new Set<number>();
      r.forEach((idx) => {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      });
      return next;
    });
  }

  function toggleReveal(i: number) {
    setRevealed((r) => {
      const next = new Set(r);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  // Through the backend, so the clipboard is cleared after the configured time.
  async function copy(text: string) {
    try {
      await api.copyText(text, clearSeconds);
    } catch (e) {
      setError(String(e));
    }
  }

  const draft = JSON.stringify({ form, custom });
  const hasDraft = !loading && draft !== loaded;

  /** Applies the form to the vault in memory; `rethrow` lets idle auto-close stop on failure. */
  async function saveEntry(rethrow = false) {
    const payload: EntryInput = {
      ...form,
      custom: custom.filter((f) => f.key.trim() !== ""),
    };
    try {
      await api.updateEntry(entryId, payload);
      setLoaded(draft);
      markDirty();
      await refreshTree();
    } catch (e) {
      setError(String(e));
      if (rethrow) throw e;
    }
  }

  // Let idle auto-close (and the close prompt) know about unapplied edits.
  const saveRef = useRef(saveEntry);
  saveRef.current = saveEntry;
  useEffect(() => {
    setPendingApply(hasDraft ? () => saveRef.current(true) : null);
  }, [hasDraft, setPendingApply]);
  useEffect(() => () => setPendingApply(null), [setPendingApply]);

  async function removeEntry() {
    if (!(await confirmDanger(`Delete entry “${form.title || "(no title)"}”?`, "Delete entry"))) return;
    try {
      await deleteEntry(entryId);
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <div className="entry-form">
      <label>
        Title
        <input value={form.title} onChange={(e) => field("title", e.target.value)} />
      </label>

      <label>
        Username
        <div className="field-row">
          <input value={form.username} onChange={(e) => field("username", e.target.value)} />
          <button className="icon" title="Copy" onClick={() => copy(form.username)}>
            ⧉
          </button>
        </div>
        <LayoutWarning value={form.username} />
      </label>

      <label>
        Password
        <div className="field-row">
          <input
            type={reveal ? "text" : "password"}
            value={form.password}
            onChange={(e) => field("password", e.target.value)}
          />
          <button className="icon" title="Reveal" onClick={() => setReveal((r) => !r)}>
            {reveal ? "🙈" : "👁"}
          </button>
          <button className="icon" title="Copy" onClick={() => copy(form.password)}>
            ⧉
          </button>
        </div>
        <LayoutWarning value={form.password} />
      </label>

      <label>
        URL
        <div className="field-row">
          <input value={form.url} onChange={(e) => field("url", e.target.value)} />
          <button className="icon" title="Copy" onClick={() => copy(form.url)}>
            ⧉
          </button>
        </div>
      </label>

      <label>
        <div className="label-row">
          <span>Notes</span>
          <button className="icon" title="Copy" onClick={() => copy(form.notes)}>
            ⧉
          </button>
        </div>
        <textarea rows={5} value={form.notes} onChange={(e) => field("notes", e.target.value)} />
      </label>

      <div className="custom-fields">
        <div className="label-row">
          <span className="section-title">Custom fields</span>
          <button className="secondary small" onClick={addCustom}>
            + Add field
          </button>
        </div>

        {custom.map((f, i) => {
          const masked = f.protected && !revealed.has(i);
          return (
            <div key={i} className="custom-row">
              <input
                className="custom-key"
                placeholder="Name"
                value={f.key}
                onChange={(e) => updateCustom(i, { key: e.target.value })}
              />
              <input
                className="custom-value"
                placeholder="Value"
                type={masked ? "password" : "text"}
                value={f.value}
                onChange={(e) => updateCustom(i, { value: e.target.value })}
              />
              <button
                className={`icon${f.protected ? " on" : ""}`}
                title={f.protected ? "Protected" : "Mark protected"}
                onClick={() => updateCustom(i, { protected: !f.protected })}
              >
                {f.protected ? "🔒" : "🔓"}
              </button>
              {f.protected && (
                <button className="icon" title="Reveal" onClick={() => toggleReveal(i)}>
                  {revealed.has(i) ? "🙈" : "👁"}
                </button>
              )}
              <button className="icon" title="Copy" onClick={() => copy(f.value)}>
                ⧉
              </button>
              <button className="icon" title="Remove" onClick={() => removeCustom(i)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="form-actions">
        <button className="primary" onClick={() => saveEntry()}>
          Apply changes
        </button>
        <button className="danger" onClick={removeEntry}>
          Delete entry
        </button>
      </div>
      <p className="hint">Changes are kept in memory — use “Save vault” to write them to disk.</p>
    </div>
  );
}
