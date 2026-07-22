import { useState } from "react";
import type { GroupDto } from "../lib/api";
import { useVault } from "../store";

const ENTRY_MIME = "text/entry-id";

function GroupNode({ group, depth }: { group: GroupDto; depth: number }) {
  const selectedGroupId = useVault((s) => s.selectedGroupId);
  const selectGroup = useVault((s) => s.selectGroup);
  const moveEntry = useVault((s) => s.moveEntry);
  const setError = useVault((s) => s.setError);
  const active = group.id === selectedGroupId;
  const [dropTarget, setDropTarget] = useState(false);

  return (
    <>
      <button
        className={`tree-item${active ? " active" : ""}${dropTarget ? " drop-target" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => selectGroup(group.id)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ENTRY_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={async (e) => {
          if (!e.dataTransfer.types.includes(ENTRY_MIME)) return;
          e.preventDefault();
          setDropTarget(false);
          const entryId = e.dataTransfer.getData(ENTRY_MIME);
          if (!entryId) return;
          try {
            await moveEntry(entryId, group.id);
          } catch (err) {
            setError(String(err));
          }
        }}
      >
        <span className="tree-icon">🗀</span>
        <span className="tree-name">{group.name || "(unnamed)"}</span>
        <span className="tree-count">{group.entries.length}</span>
      </button>
      {group.groups.map((child) => (
        <GroupNode key={child.id} group={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function GroupTree({ root }: { root: GroupDto }) {
  return (
    <nav className="tree">
      <GroupNode group={root} depth={0} />
    </nav>
  );
}
