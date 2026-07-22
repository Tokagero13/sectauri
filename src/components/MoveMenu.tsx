import { useEffect } from "react";
import type { GroupDto } from "../lib/api";

interface FlatGroup {
  id: string;
  name: string;
  depth: number;
}

// Flatten the group tree into an indented list for the menu.
function flatten(group: GroupDto, depth = 0, acc: FlatGroup[] = []): FlatGroup[] {
  acc.push({ id: group.id, name: group.name || "(unnamed)", depth });
  for (const child of group.groups) flatten(child, depth + 1, acc);
  return acc;
}

export function MoveMenu({
  tree,
  x,
  y,
  onPick,
  onClose,
}: {
  tree: GroupDto;
  x: number;
  y: number;
  onPick: (groupId: string) => void;
  onClose: () => void;
}) {
  // Close on any left-click elsewhere or Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu-label">Move to group</div>
      {flatten(tree).map((g) => (
        <button
          key={g.id}
          className="context-menu-item"
          style={{ paddingLeft: 12 + g.depth * 14 }}
          onClick={() => {
            onPick(g.id);
            onClose();
          }}
        >
          🗀 {g.name}
        </button>
      ))}
    </div>
  );
}
