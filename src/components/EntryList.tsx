import { useMemo, useState } from "react";
import type { EntrySummary, GroupDto } from "../lib/api";
import { entriesUsed, markEntryUsed } from "../lib/recent";
import { useVault, type SortKey } from "../store";
import { confirmDanger, ContextMenu, CopyButton } from "./common";
import { ENTRY_MIME } from "./GroupTree";

// Groups with at least this many entries get a "Recently used" strip on top.
const RECENT_MIN_ENTRIES = 5;
const RECENT_COUNT = 3;

interface Row {
  entry: EntrySummary;
  /** Group path, shown in search results. */
  path?: string;
}

function arrow(active: boolean, dir: "asc" | "desc") {
  if (!active) return "";
  return dir === "asc" ? " ▲" : " ▼";
}

function allEntries(group: GroupDto, path: string[] = [], acc: Row[] = []): Row[] {
  const here = [...path, group.name || "(unnamed)"];
  for (const entry of group.entries) acc.push({ entry, path: here.join(" › ") });
  for (const child of group.groups) allEntries(child, here, acc);
  return acc;
}

function flatGroups(group: GroupDto, depth = 0, acc: { id: string; name: string; depth: number }[] = []) {
  acc.push({ id: group.id, name: group.name || "(unnamed)", depth });
  for (const child of group.groups) flatGroups(child, depth + 1, acc);
  return acc;
}

function matches(e: EntrySummary, q: string) {
  return [e.title, e.username, e.url, ...e.tags].some((v) => v.toLowerCase().includes(q));
}

export function EntryList({ group }: { group: GroupDto }) {
  const {
    tree,
    vaultPath,
    selectedEntryId,
    selectEntry,
    sortKey,
    sortDir,
    setSort,
    search,
    moveEntry,
    createEntry,
    deleteEntry,
    setError,
  } = useVault();
  const locked = useVault((s) => s.settings.layoutLocked);
  const [menu, setMenu] = useState<{ entry: EntrySummary; x: number; y: number } | null>(null);
  const query = search.trim().toLowerCase();

  const rows = useMemo(() => {
    const source: Row[] = query && tree
      ? allEntries(tree).filter((r) => matches(r.entry, query))
      : group.entries.map((entry) => ({ entry }));
    const factor = sortDir === "asc" ? 1 : -1;
    return source.sort((a, b) => {
      if (sortKey === "modified") return ((a.entry.modified ?? 0) - (b.entry.modified ?? 0)) * factor;
      const av = (sortKey === "title" ? a.entry.title : a.entry.username).toLowerCase();
      const bv = (sortKey === "title" ? b.entry.title : b.entry.username).toLowerCase();
      return av.localeCompare(bv) * factor;
    });
  }, [tree, group.entries, query, sortKey, sortDir]);

  // Recently used entries of this group (by last view or copy on this computer).
  const recent = useMemo(() => {
    if (query || !vaultPath || group.entries.length < RECENT_MIN_ENTRIES) return [];
    const used = entriesUsed(vaultPath);
    return group.entries
      .filter((e) => used[e.id])
      .sort((a, b) => used[b.id] - used[a.id])
      .slice(0, RECENT_COUNT);
    // selectedEntryId: re-rank after a selection marks an entry used.
  }, [vaultPath, group.entries, query, selectedEntryId]);

  function markUsed(entry: EntrySummary) {
    if (vaultPath) markEntryUsed(vaultPath, entry.id);
  }

  function open(entry: EntrySummary) {
    markUsed(entry);
    selectEntry(entry.id);
  }

  async function remove(entry: EntrySummary) {
    if (!(await confirmDanger(`Delete entry “${entry.title || "(no title)"}”?`, "Delete entry"))) return;
    try {
      await deleteEntry(entry.id);
    } catch (e) {
      setError(String(e));
    }
  }

  function sortBtn(key: SortKey, label: string) {
    return (
      <button className={`sort-btn${sortKey === key ? " active" : ""}`} onClick={() => setSort(key)}>
        {label}
        {arrow(sortKey === key, sortDir)}
      </button>
    );
  }

  function row({ entry, path }: Row, keyPrefix = "") {
    return (
      <li key={keyPrefix + entry.id}>
        <div
          role="button"
          tabIndex={0}
          className={`entry-row${entry.id === selectedEntryId ? " active" : ""}`}
          draggable={!locked}
          onDragStart={(e) => {
            e.dataTransfer.setData(ENTRY_MIME, entry.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            open(entry);
            setMenu({ entry, x: e.clientX, y: e.clientY });
          }}
          onClick={() => open(entry)}
          onKeyDown={(e) => e.key === "Enter" && open(entry)}
        >
          <div className="entry-text">
            <span className="entry-title">{entry.title || "(no title)"}</span>
            <span className="entry-user">{entry.username}</span>
            {path && <span className="entry-path">{path}</span>}
          </div>
          <div className="entry-actions">
            {entry.username && <CopyButton entryId={entry.id} field="username" onCopied={() => markUsed(entry)} />}
            <CopyButton entryId={entry.id} field="password" onCopied={() => markUsed(entry)} />
          </div>
        </div>
      </li>
    );
  }

  return (
    <>
      <div className="list-header">
        <span className="list-header-label">Sort</span>
        {sortBtn("title", "Title")}
        {sortBtn("username", "Username")}
        {sortBtn("modified", "Modified")}
        <div className="spacer" />
        <button className="primary small" onClick={() => createEntry(group.id).catch((e) => setError(String(e)))}>
          + Entity
        </button>
      </div>

      {query && <div className="list-note">{rows.length} result{rows.length === 1 ? "" : "s"} in all groups</div>}

      {recent.length > 0 && (
        <>
          <div className="list-note">Recently used</div>
          <ul className="entry-list recent-strip">{recent.map((entry) => row({ entry }, "recent-"))}</ul>
          <div className="list-note">All entries</div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="empty">{query ? `Nothing matches “${search}”.` : `No entries in “${group.name}”.`}</div>
      ) : (
        <ul className="entry-list">{rows.map((r) => row(r))}</ul>
      )}

      {menu && tree && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            className="context-menu-item danger-item"
            onClick={() => {
              const entry = menu.entry;
              setMenu(null);
              remove(entry);
            }}
          >
            🗑 Delete entry
          </button>
          <div className="context-menu-label">Move to group</div>
          {flatGroups(tree).map((g) => (
            <button
              key={g.id}
              className="context-menu-item"
              style={{ paddingLeft: 12 + g.depth * 14 }}
              onClick={async () => {
                const entry = menu.entry;
                setMenu(null);
                try {
                  await moveEntry(entry.id, g.id);
                } catch (err) {
                  setError(String(err));
                }
              }}
            >
              🗀 {g.name}
            </button>
          ))}
        </ContextMenu>
      )}
    </>
  );
}
