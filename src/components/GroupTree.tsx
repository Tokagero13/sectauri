import { useState } from "react";
import { api, GROUP_COLORS, type GroupDto } from "../lib/api";
import { findGroup, useVault } from "../store";
import { confirmDanger, ContextMenu, NameDialog } from "./common";

export const ENTRY_MIME = "text/entry-id";
const GROUP_MIME = "text/group-id";

type Dialog = { kind: "add"; parentId: string } | { kind: "rename"; group: GroupDto };

function countEntries(g: GroupDto): number {
  return g.entries.length + g.groups.reduce((n, c) => n + countEntries(c), 0);
}

function GroupNode({
  group,
  depth,
  isRoot,
  onMenu,
}: {
  group: GroupDto;
  depth: number;
  isRoot: boolean;
  onMenu: (group: GroupDto, x: number, y: number) => void;
}) {
  const selectedGroupId = useVault((s) => s.selectedGroupId);
  const selectGroup = useVault((s) => s.selectGroup);
  const moveEntry = useVault((s) => s.moveEntry);
  const moveGroup = useVault((s) => s.moveGroup);
  const setError = useVault((s) => s.setError);
  const locked = useVault((s) => s.settings.layoutLocked);
  const active = group.id === selectedGroupId;
  const [dropTarget, setDropTarget] = useState(false);

  const accepts = (types: readonly string[]) =>
    !locked && (types.includes(ENTRY_MIME) || types.includes(GROUP_MIME));

  return (
    <>
      <button
        className={`tree-item${active ? " active" : ""}${dropTarget ? " drop-target" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        draggable={!locked && !isRoot}
        onDragStart={(e) => {
          e.dataTransfer.setData(GROUP_MIME, group.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => selectGroup(group.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          selectGroup(group.id);
          onMenu(group, e.clientX, e.clientY);
        }}
        onDragOver={(e) => {
          if (!accepts(e.dataTransfer.types)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={async (e) => {
          if (!accepts(e.dataTransfer.types)) return;
          e.preventDefault();
          setDropTarget(false);
          const entryId = e.dataTransfer.getData(ENTRY_MIME);
          const groupId = e.dataTransfer.getData(GROUP_MIME);
          try {
            if (entryId) await moveEntry(entryId, group.id);
            else if (groupId && groupId !== group.id) await moveGroup(groupId, group.id);
          } catch (err) {
            setError(String(err));
          }
        }}
      >
        <span className="tree-icon" style={group.color ? { color: group.color } : undefined}>
          {group.color ? "●" : "🗀"}
        </span>
        <span className="tree-name">{group.name || "(unnamed)"}</span>
        <span className="tree-count">{group.entries.length}</span>
      </button>
      {group.groups.map((child) => (
        <GroupNode key={child.id} group={child} depth={depth + 1} isRoot={false} onMenu={onMenu} />
      ))}
    </>
  );
}

export function GroupTree({ root }: { root: GroupDto }) {
  const { selectedGroupId, selectGroup, refreshTree, markDirty, setError } = useVault();
  const [menu, setMenu] = useState<{ group: GroupDto; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      markDirty();
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(group: GroupDto) {
    const n = countEntries(group);
    const ok = await confirmDanger(
      `Delete group “${group.name}”${n ? ` and its ${n} entr${n === 1 ? "y" : "ies"}` : ""}, including all subgroups?`,
      "Delete group"
    );
    if (!ok) return;
    if (findGroup(group, selectedGroupId)) selectGroup(root.id);
    await act(() => api.deleteGroup(group.id));
  }

  return (
    <nav className="tree">
      <div className="tree-head">
        <span className="list-header-label">Groups</span>
        <button
          className="secondary small"
          onClick={() => setDialog({ kind: "add", parentId: selectedGroupId ?? root.id })}
          title="Add a group inside the selected one"
        >
          + Add Group
        </button>
      </div>

      <GroupNode
        group={root}
        depth={0}
        isRoot
        onMenu={(group, x, y) => setMenu({ group, x, y })}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            className="context-menu-item"
            onClick={() => {
              setDialog({ kind: "add", parentId: menu.group.id });
              setMenu(null);
            }}
          >
            + New subgroup
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              setDialog({ kind: "rename", group: menu.group });
              setMenu(null);
            }}
          >
            ✎ Rename
          </button>
          <div className="context-menu-label">Color</div>
          <div className="swatches">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${menu.group.color === c ? " on" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  act(() => api.setGroupColor(menu.group.id, c));
                  setMenu(null);
                }}
              />
            ))}
            <button
              className="swatch none"
              title="No color"
              onClick={() => {
                act(() => api.setGroupColor(menu.group.id, null));
                setMenu(null);
              }}
            >
              ∅
            </button>
          </div>
          {menu.group.id !== root.id && (
            <button
              className="context-menu-item danger-item"
              onClick={() => {
                const g = menu.group;
                setMenu(null);
                remove(g);
              }}
            >
              🗑 Delete group
            </button>
          )}
        </ContextMenu>
      )}

      {dialog && (
        <NameDialog
          title={dialog.kind === "add" ? "New group name" : "Rename group"}
          initial={dialog.kind === "rename" ? dialog.group.name : ""}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const d = dialog;
            setDialog(null);
            act(() =>
              d.kind === "add" ? api.createGroup(d.parentId, name) : api.renameGroup(d.group.id, name)
            );
          }}
        />
      )}
    </nav>
  );
}
