import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Panel, Skeleton } from "@chogpool/ui";
import "@chogpool/ui/styles.css";
import "./styles.css";
import { usePath, navigate } from "./lib/router";
import { useWallet, WalletProvider } from "./lib/useWallet";
import { useGate, CHOG_MARKETPLACE_URL } from "./lib/gate";
import { WalletButton } from "./components/WalletButton";
import { GateModal } from "./components/GateModal";
import { TxSuccessModal } from "./components/TxSuccessModal";
import { ConnectGateModal } from "./components/ConnectGateModal";
import { CHAIN, DEPLOYED } from "./generated/addresses.gen";

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
  { path: "/setup", label: "Play", Component: Play },
  { path: "/run", label: "Race", Component: RaceSection },
  { path: "/replays", label: "Race", Component: RaceSection },
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
  // The entry gate: a wallet with a real Chog or a Test Drive sails through; any
  // other connected wallet is held at the door. The mint page stays reachable so
  // it can be the way in.
  const wallet = useWallet();
  const gate = useGate(wallet.address ?? undefined);
  // Fail closed: the gate stays shut while a check is in flight too, so an
  // unanswered read never opens the app. Only a settled "in" opens it.
  // The landing is never gated: it is the storefront and stays browsable with
  // or without a Chog. The gate appears the moment a click heads inside the
  // app, exactly at the door, and the mint page stays reachable as the way in.
  const gateBlocked =
    Boolean(wallet.address) && gate !== "in" && path !== "/mint" && path !== "/";
  // Before a wallet is connected there is no app at all: no nav, and every way
  // in stops at "connect a wallet first". The landing is the only thing shown.
  const connectBlocked = !wallet.address && path !== "/";

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

  // Before a wallet is connected there is no app at all: just the connect wall,
  // with nothing rendered behind it to peek through.
  if (connectBlocked) {
    return <ConnectGateModal onConnect={() => void wallet.connect()} />;
  }

  return (
    <main className="app-shell">
      <nav className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>CHOG<span>TRACK</span></a>
        {wallet.address ? (
        <button
          className={`nav-toggle${menuOpen ? " nav-toggle--open" : ""}`}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>
        ) : null}
        <div className={`nav-links${menuOpen ? " nav-links--open" : ""}`}>
          {wallet.address && navRoutes.map((r) => (
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
          {path === "/" ? (
          <div className="footer-grid">
            <div className="footer-brandcol">
              <a className="footer-brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>CHOG<span>TRACK</span></a>
              <p className="footer-tag">Deposits are never used as prizes.</p>
              <div className="footer-badge"><Badge tone="neutral">MONAD TESTNET BUILD</Badge></div>
            </div>
            <nav className="footer-col">
              <h4>App</h4>
              {navRoutes.map((r) => (
                <a key={r.path} href={r.path} onClick={(e) => { e.preventDefault(); navigate(r.path); }}>{r.label}</a>
              ))}
            </nav>
            <nav className="footer-col">
              <h4>Explore</h4>
              <a href="/mint" onClick={(e) => { e.preventDefault(); navigate("/mint"); }}>Get a Chog</a>
              <a href="/spectator" onClick={(e) => { e.preventDefault(); navigate("/spectator"); }}>Spectate</a>
              <a href="/career" onClick={(e) => { e.preventDefault(); navigate("/career"); }}>Career</a>
              <a href="/tips" onClick={(e) => { e.preventDefault(); navigate("/tips"); }}>Tips</a>
            </nav>
            <nav className="footer-col">
              <h4>On-chain</h4>
              <a href={`${CHAIN.monadTestnet.explorer}/address/${DEPLOYED.pool}`} target="_blank" rel="noreferrer">Pool contract ↗</a>
              <a href="/proof" onClick={(e) => { e.preventDefault(); navigate("/proof"); }}>Verify a race</a>
              <a href={CHOG_MARKETPLACE_URL} target="_blank" rel="noreferrer">Chog on OpenSea</a>
              <span className="footer-fact">Monad Testnet · Chain 10143</span>
            </nav>
          </div>
          ) : (
          <div className="footer-compact">
            <a className="footer-brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>CHOG<span>TRACK</span></a>
            <p className="footer-tag">Deposits are never used as prizes.</p>
          </div>
          )}
          <div className="footer-bottom">
            <span>Your deposit never funds prizes. What comes back is your shares at live value.</span>
            <span>Monad testnet · test funds only · draws re-derivable from the published seed</span>
          </div>
        </div>
      </footer>

      {gateBlocked && gate === "checking" && (
        <div
          className="gate-overlay gate-overlay--checking"
          role="dialog"
          aria-modal="true"
          aria-label="Checking your Chog"
        >
          <div className="gate-checking">
            <p className="kicker">ONE MOMENT</p>
            <p className="gate-checking__text">Checking your Chog…</p>
          </div>
        </div>
      )}
      {gateBlocked && gate === "blocked" && <GateModal />}
      {wallet.txStage === "confirmed" && wallet.txHash && (
        <TxSuccessModal
          label={wallet.txLabel}
          txHash={wallet.txHash}
          onClose={() => wallet.resetTx()}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <WalletProvider>
    <App />
  </WalletProvider>,
);
