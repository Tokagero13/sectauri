import type { GroupDto } from "../lib/api";
import { useVault } from "../store";

function GroupNode({ group, depth }: { group: GroupDto; depth: number }) {
  const selectedGroupId = useVault((s) => s.selectedGroupId);
  const selectGroup = useVault((s) => s.selectGroup);
  const active = group.id === selectedGroupId;

  return (
    <>
      <button
        className={`tree-item${active ? " active" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => selectGroup(group.id)}
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
