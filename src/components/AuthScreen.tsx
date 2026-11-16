// Sectauri app login: first-time master password setup, then password (+ TOTP) on launch.
import { useState } from "react";
import { api, type AuthStatus } from "../lib/api";
import { LayoutWarning } from "./common";

const TRUST_DAYS = 7;

export function AuthScreen({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [needCode, setNeedCode] = useState(status.awaiting_totp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = !status.configured;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const submitSetup = () =>
    run(async () => {
      if (password !== confirm) throw new Error("The passwords do not match.");
      await api.authSetup(password, remember);
      setPassword("");
      setConfirm("");
      onDone();
    });

  const submitPassword = () =>
    run(async () => {
      const totpRequired = await api.authLogin(password, remember);
      setPassword("");
      if (totpRequired) setNeedCode(true);
      else onDone();
    });

  const submitCode = () =>
    run(async () => {
      try {
        await api.authVerifyTotp(code, remember);
      } catch (e) {
        // Too many wrong codes, or the challenge expired: back to the password.
        if (String(e).includes("master password")) {
          setNeedCode(false);
          setCode("");
        }
        throw e;
      }
      onDone();
    });

  const rememberBox = (
    <label className="check">
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
      Remember this device for {TRUST_DAYS} days
    </label>
  );

  return (
    <div className="unlock">
      <div className="unlock-card">
        <h1 className="brand">Sectauri</h1>

        {setup ? (
          <>
            <p className="subtitle">Create the master password that opens Sectauri.</p>
            <input
              className="full"
              type="password"
              placeholder="Master password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <LayoutWarning value={password} />
            <input
              className="full"
              type="password"
              placeholder="Confirm master password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSetup()}
            />
            <LayoutWarning value={confirm} />
            {rememberBox}
            <button className="primary full" onClick={submitSetup} disabled={busy || !password || !confirm}>
              {busy ? "Saving…" : "Create master password"}
            </button>
            <p className="hint">
              It cannot be recovered. Your vaults keep their own passwords. Turning on TOTP in
              Settings afterwards is recommended.
            </p>
          </>
        ) : needCode ? (
          <>
            <p className="subtitle">Enter the 6-digit code from your authenticator app.</p>
            <input
              className="full code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCode()}
              autoFocus
            />
            {rememberBox}
            <button className="primary full" onClick={submitCode} disabled={busy || code.trim().length < 6}>
              {busy ? "Checking…" : "Verify"}
            </button>
          </>
        ) : (
          <>
            <p className="subtitle">Enter your master password.</p>
            <input
              className="full"
              type="password"
              placeholder="Master password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitPassword()}
              autoFocus
            />
            <LayoutWarning value={password} />
            {rememberBox}
            <button className="primary full" onClick={submitPassword} disabled={busy || !password}>
              {busy ? "Checking…" : "Log in"}
            </button>
          </>
        )}

        {error && <div className="error">{error.replace(/^Error: /, "")}</div>}
      </div>
    </div>
  );
}
