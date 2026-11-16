import "./styles.css";
import { useEffect, useState } from "react";
import { api, type AuthStatus } from "./lib/api";
import { useVault } from "./store";
import { Splash } from "./components/Splash";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { VaultView } from "./components/VaultView";

const SPLASH_MS = 1000;

export default function App() {
  const appUnlocked = useVault((s) => s.appUnlocked);
  const setAppUnlocked = useVault((s) => s.setAppUnlocked);
  const vaultUnlocked = useVault((s) => s.unlocked);
  const [splash, setSplash] = useState(true);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = () =>
    api
      .authStatus()
      .then((s) => {
        setStatus(s);
        setAppUnlocked(s.unlocked);
      })
      .catch((e) => setError(String(e)));

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), SPLASH_MS);
    loadStatus();
    return () => window.clearTimeout(timer);
  }, []);

  // Locking the app from the dashboard: fetch a fresh status for the login screen.
  useEffect(() => {
    if (!appUnlocked && status?.unlocked) loadStatus();
  }, [appUnlocked]);

  if (error) return <div className="error banner">{error}</div>;
  if (splash || !status) return <Splash />;
  if (!appUnlocked) return <AuthScreen key={String(status.configured)} status={status} onDone={loadStatus} />;
  return vaultUnlocked ? <VaultView /> : <Dashboard />;
}
