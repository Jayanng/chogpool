import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";
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
const Mint = lazy(() => import("./mint"));
const Yield = lazy(() => import("./yield"));
const Tips = lazy(() => import("./tips"));
const Verify = lazy(() => import("./verify"));
const Spectator = lazy(() => import("./spectator"));
const StyleGuide = lazy(() => import("./style-guide"));

const routes: Array<{ path: string; label: string; Component: LazyExoticComponent<ComponentType>; hidden?: boolean }> = [
  { path: "/", label: "Track", Component: Landing },
  { path: "/deposit", label: "Deposit", Component: Deposit },
  { path: "/race", label: "Race", Component: Race },
  { path: "/draft", label: "Draft", Component: Draft },
  { path: "/mint", label: "Mint", Component: Mint },
  { path: "/yield", label: "Yield", Component: Yield },
  { path: "/tips", label: "Tips", Component: Tips },
  { path: "/verify", label: "Verify", Component: Verify },
  { path: "/spectator", label: "Spectate", Component: Spectator },
  // Design tool for the team, not user-facing. Reachable only by URL.
  { path: "/style", label: "Style", Component: StyleGuide, hidden: true },
];

const navRoutes = routes.filter((r) => !r.hidden);

function App() {
  const path = usePath();
  const match = routes.find((r) => r.path === path) ?? routes[0];
  const Component = match.Component;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [path]);

  // Standard menu behavior: Escape closes it and the page behind it stays still.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

  // Growing to desktop width retires the menu with it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 861px)");
    const onChange = () => { if (mq.matches) setMenuOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <main className="app-shell">
      <nav className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>CHOG<span>TRACK</span></a>
        <button
          className={`nav-toggle${menuOpen ? " nav-toggle--open" : ""}`}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>
        <div className={`nav-links${menuOpen ? " nav-links--open" : ""}`}>
          {navRoutes.map((r) => (
            <a
              href={r.path}
              key={r.path}
              className={r.path === match.path ? "nav-active" : ""}
              onClick={(e) => { e.preventDefault(); navigate(r.path); }}
            >
              {r.label}
            </a>
          ))}
          <div className="nav-menu-wallet">
            <WalletButton />
          </div>
        </div>
        <div className="nav-desktop-wallet">
          <WalletButton />
        </div>
      </nav>
      {menuOpen && <div className="nav-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}

      <Suspense fallback={<div className="page-loading"><Skeleton variant="block" /><Skeleton variant="text" /><Skeleton variant="text" width={220} /></div>}>
        <Component />
      </Suspense>

      <footer className="footer">
        <Panel className="footer-panel">
          <Badge tone="neutral">MONAD TESTNET BUILD</Badge>
          <span className="footer-note">Deposits are principal-safe by design, not by guarantee. Yield sources carry their own risks.</span>
        </Panel>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
