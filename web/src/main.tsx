import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Panel, Skeleton } from "@chogpool/ui";
import "@chogpool/ui/styles.css";
import "./styles.css";
import { usePath, navigate } from "./lib/router";
import { WalletProvider } from "./lib/useWallet";
import { WalletButton } from "./components/WalletButton";
import { CHAIN } from "./generated/addresses.gen";

// One async page bundle per route.
const Landing = lazy(() => import("./landing"));
const Play = lazy(() => import("./sections/Play"));
const RaceSection = lazy(() => import("./sections/Race"));
const EarnSection = lazy(() => import("./sections/Earn"));
const Proof = lazy(() => import("./verify"));
const StyleGuide = lazy(() => import("./style-guide"));

const routes: Array<{ path: string; label: string; Component: LazyExoticComponent<ComponentType>; hidden?: boolean }> = [
  { path: "/", label: "Track", Component: Landing },
  { path: "/play", label: "Play", Component: Play },
  { path: "/race", label: "Race", Component: RaceSection },
  { path: "/earn", label: "Earn", Component: EarnSection },
  { path: "/proof", label: "Proof", Component: Proof },

  // Aliases keep every existing deep link and navigate() call working.
  { path: "/deposit", label: "Play", Component: Play },
  { path: "/mint", label: "Play", Component: Play },
  { path: "/draft", label: "Play", Component: Play },
  { path: "/spectator", label: "Race", Component: RaceSection },
  { path: "/career", label: "Race", Component: RaceSection },
  { path: "/yield", label: "Earn", Component: EarnSection },
  { path: "/tips", label: "Earn", Component: EarnSection },
  { path: "/verify", label: "Proof", Component: Proof },

  { path: "/style", label: "Style", Component: StyleGuide, hidden: true },
];

// One nav entry per section: the first route for each label is the primary tab.
const navRoutes = routes
  .filter((r) => !r.hidden)
  .filter((r, i, arr) => arr.findIndex((x) => x.label === r.label) === i);

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
              className={r.label === match.label ? "nav-active" : ""}
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
        <div className="footer-card">
          <div className="footer-top">
            <a className="footer-brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>CHOG<span>TRACK</span></a>
            <nav className="footer-nav">
              {navRoutes.map((r) => (
                <a key={r.path} href={r.path} onClick={(e) => { e.preventDefault(); navigate(r.path); }}>{r.label}</a>
              ))}
            </nav>
          </div>
          <p className="footer-tag">Your dollars never enter the race.</p>
          <div className="footer-note">
            Deposits are principal-safe by design, not by guarantee. Yield sources carry their own risks.
          </div>
          <div className="footer-meta">
            <Badge tone="neutral">MONAD TESTNET BUILD</Badge>
            <span>Monad testnet · test funds only · draws re-derivable from the published seed</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <WalletProvider>
    <App />
  </WalletProvider>,
);
