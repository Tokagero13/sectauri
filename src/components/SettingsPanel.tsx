// Settings: auto-close, clipboard clearing, TOTP second factor, trusted device.
import { useEffect, useState } from "react";
import { api, type AuthStatus, type TotpSetup } from "../lib/api";
import { formatTime } from "../lib/text";
import { useVault } from "../store";
import { LayoutWarning } from "./common";

const AUTO_LOCK = [0, 5, 15, 30, 60];
const CLIPBOARD = [0, 15, 30, 60];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useVault();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.authStatus().then(setStatus).catch((e) => setError(String(e)));
  useEffect(() => {
    reload();
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>

        <label className="setting">
          <span>Close an open vault after inactivity</span>
          <select
            value={settings.autoLockMinutes}
            onChange={(e) => updateSettings({ autoLockMinutes: Number(e.target.value) })}
          >
            {AUTO_LOCK.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Never" : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>

        <label className="setting">
          <span>Clear copied usernames and passwords from the clipboard</span>
          <select
            value={settings.clipboardClearSeconds}
            onChange={(e) => updateSettings({ clipboardClearSeconds: Number(e.target.value) })}
          >
            {CLIPBOARD.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "Never" : `after ${s} seconds`}
              </option>
            ))}
          </select>
        </label>

        <div className="section-title">Master password</div>
        <input
          type="password"
          placeholder="Current master password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <LayoutWarning value={current} />
        <input
          type="password"
          placeholder="New master password (8+ characters)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <LayoutWarning value={next} />
        <div className="field-row">
          <input
            type="password"
            placeholder="Repeat new master password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
          <button
            className="secondary"
            disabled={busy || !current || !next || !repeat}
            onClick={() =>
              run(async () => {
                if (next !== repeat) throw new Error("The new passwords do not match.");
                await api.authChangePassword(current, next);
                setCurrent("");
                setNext("");
                setRepeat("");
              }, "Master password changed. This device is no longer remembered.")
            }
          >
            Change
          </button>
        </div>
        <LayoutWarning value={repeat} />

        <div className="section-title">Two-factor login (TOTP)</div>
        {status?.totp_enabled ? (
          <>
            <p className="hint">On: logging in needs your master password and a code from your authenticator app.</p>
            <div className="field-row">
              <input
                type="password"
                placeholder="Master password to turn it off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                className="danger"
                disabled={busy || !password}
                onClick={() =>
                  run(async () => {
                    await api.totpDisable(password);
                    setPassword("");
                  }, "TOTP is off.")
                }
              >
                Turn off
              </button>
            </div>
            <LayoutWarning value={password} />
          </>
        ) : setup ? (
          <div className="totp-setup">
            <img src={`data:image/png;base64,${setup.qr_png_base64}`} alt="TOTP QR code" />
            <div>
              <p className="hint">Scan with an authenticator app, or enter this key by hand:</p>
              <code className="secret">{setup.secret}</code>
              <div className="field-row">
                <input
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={busy || code.trim().length < 6}
                  onClick={() =>
                    run(async () => {
                      await api.totpConfirmSetup(code);
                      setSetup(null);
                      setCode("");
                    }, "TOTP is on.")
                  }
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="hint">Recommended: ask for a 6-digit code from your phone at login.</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(async () => setSetup(await api.totpBeginSetup()), "")}
            >
              Set up TOTP
            </button>
          </>
        )}

        <div className="section-title">This device</div>
        {status?.trusted_until ? (
          <div className="field-row">
            <span className="hint">Login skipped on this device until {formatTime(status.trusted_until)}.</span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(() => api.forgetDevice(), "This device is no longer trusted.")}
            >
              Forget this device
            </button>
          </div>
        ) : (
          <p className="hint">Not remembered: Sectauri asks for the login at every start.</p>
        )}

        {message && <div className="notice">{message}</div>}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
