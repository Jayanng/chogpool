import { createRoot } from "react-dom/client";
import { UI_VERSION } from "@chogpool/ui";
import { MAINNET, TESTNET } from "./generated/addresses.gen";

function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Chog Track</h1>
      <p>Phase 0 skeleton. UI base v{UI_VERSION}.</p>
      <p>
        Read network: {MAINNET ? "Monad mainnet (143) wired" : "missing"} · Play network:{" "}
        {TESTNET ? "Monad testnet (10143) wired" : "missing"}
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
