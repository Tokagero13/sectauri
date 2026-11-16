// Vault unlock attempts: time, vault, result, device.
import { useState } from "react";
import type { AuditEvent } from "../lib/api";
import { formatTime } from "../lib/text";

const SHOWN = 50;

function name(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function AuditLog({ events }: { events: AuditEvent[] }) {
  const [vault, setVault] = useState("");
  const vaults = [...new Set(events.map((e) => e.vault_path))];
  const shown = events.filter((e) => !vault || e.vault_path === vault).slice(0, SHOWN);

  return (
    <section className="audit">
      <div className="dash-head">
        <h2>Access log</h2>
        <select value={vault} onChange={(e) => setVault(e.target.value)}>
          <option value="">All vaults</option>
          {vaults.map((p) => (
            <option key={p} value={p}>
              {name(p)}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="empty small">No unlock attempts recorded yet.</div>
      ) : (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Vault</th>
              <th>Result</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={i} className={e.success ? "" : "failed"}>
                <td>{formatTime(e.at)}</td>
                <td title={e.vault_path}>{name(e.vault_path)}</td>
                <td title={e.detail}>{e.success ? "✓ Unlocked" : "✕ Failed"}</td>
                <td>{e.device}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
