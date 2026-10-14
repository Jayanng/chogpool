import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Panel, Skeleton } from "@chogpool/ui";
import "@chogpool/ui/styles.css";
import "./styles.css";
import { usePath, navigate } from "./lib/router";
import { WalletButton } from "./components/WalletButton";
import { CHAIN } from "./generated/addresses.gen";

// One async page bundle per route.
const Landing = lazy(() => import("./landing"));
const Deposit = lazy(() => import("./money/deposit"));
const Race = lazy(() => import("./race"));
const Draft = lazy(() => import("./draft"));
const Verify = lazy(() => import("./verify"));
const Spectator = lazy(() => import("./spectator"));
const StyleGuide = lazy(() => import("./style-guide"));

const routes: Array<{ path: string; label: string; Component: LazyExoticComponent<ComponentType> }> = [
  { path: "/", label: "Track", Component: Landing },
  { path: "/deposit", label: "Deposit", Component: Deposit },
  { path: "/race", label: "Race", Component: Race },
  { path: "/draft", label: "Draft", Component: Draft },
  { path: "/verify", label: "Verify", Component: Verify },
  { path: "/spectator", label: "Spectate", Component: Spectator },
  { path: "/style", label: "Style", Component: StyleGuide },
];

function App() {
  const path = usePath();
  const match = routes.find((r) => r.path === path) ?? routes[0];
  const Component = match.Component;

  return (
    <main className="app-shell">
      <nav className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>CHOG<span>TRACK</span></a>
        <div className="nav-links">
          {routes.map((r) => (
            <a
              href={r.path}
              key={r.path}
              className={r.path === match.path ? "nav-active" : ""}
              onClick={(e) => { e.preventDefault(); navigate(r.path); }}
            >
              {r.label}
            </a>
          ))}
        </div>
        <WalletButton />
      </nav>

      <Suspense fallback={<div className="page-loading"><Skeleton variant="block" /><Skeleton variant="text" /><Skeleton variant="text" width={220} /></div>}>
        <Component />
      </Suspense>

      <footer className="footer">
        <Panel className="footer-panel">
          <Badge tone="neutral">MONAD TESTNET BUILD</Badge>
          <span>Read: {CHAIN.monad.name} · Play: {CHAIN.monadTestnet.name}</span>
          <span className="footer-note">Deposits are principal-safe by design, not by guarantee. Yield sources carry their own risks.</span>
        </Panel>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
