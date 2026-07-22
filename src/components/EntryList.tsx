import { useMemo, useState } from "react";
import type { GroupDto } from "../lib/api";
import { useVault, type SortKey } from "../store";
import { MoveMenu } from "./MoveMenu";

function arrow(active: boolean, dir: "asc" | "desc") {
  if (!active) return "";
  return dir === "asc" ? " ▲" : " ▼";
}

export function EntryList({ group }: { group: GroupDto }) {
  const selectedEntryId = useVault((s) => s.selectedEntryId);
  const selectEntry = useVault((s) => s.selectEntry);
  const sortKey = useVault((s) => s.sortKey);
  const sortDir = useVault((s) => s.sortDir);
  const setSort = useVault((s) => s.setSort);
  const tree = useVault((s) => s.tree);
  const moveEntry = useVault((s) => s.moveEntry);
  const setError = useVault((s) => s.setError);
  const [menu, setMenu] = useState<{ entryId: string; x: number; y: number } | null>(null);

  const entries = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...group.entries].sort((a, b) => {
      const av = (sortKey === "title" ? a.title : a.username).toLowerCase();
      const bv = (sortKey === "title" ? b.title : b.username).toLowerCase();
      return av.localeCompare(bv) * factor;
    });
  }, [group.entries, sortKey, sortDir]);

  function sortBtn(key: SortKey, label: string) {
    return (
      <button
        className={`sort-btn${sortKey === key ? " active" : ""}`}
        onClick={() => setSort(key)}
      >
        {label}
        {arrow(sortKey === key, sortDir)}
      </button>
    );
  }

  return (
    <>
      <div className="list-header">
        <span className="list-header-label">Sort</span>
        {sortBtn("title", "Title")}
        {sortBtn("username", "Username")}
      </div>

      {entries.length === 0 ? (
        <div className="empty">No entries in “{group.name}”.</div>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className={`entry-row${entry.id === selectedEntryId ? " active" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/entry-id", entry.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  selectEntry(entry.id);
                  setMenu({ entryId: entry.id, x: e.clientX, y: e.clientY });
                }}
                onClick={() => selectEntry(entry.id)}
              >
                <span className="entry-title">{entry.title || "(no title)"}</span>
                <span className="entry-user">{entry.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu && tree && (
        <MoveMenu
          tree={tree}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onPick={async (groupId) => {
            try {
              await moveEntry(menu.entryId, groupId);
            } catch (err) {
              setError(String(err));
            }
          }}
        />
      )}
    </>
  );
}
