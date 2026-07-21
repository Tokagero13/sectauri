import "./styles.css";
import { useVault } from "./store";
import { UnlockScreen } from "./components/UnlockScreen";
import { VaultView } from "./components/VaultView";

export default function App() {
  const unlocked = useVault((s) => s.unlocked);
  return unlocked ? <VaultView /> : <UnlockScreen />;
}
