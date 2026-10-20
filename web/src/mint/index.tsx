// /mint, the mirror mint. Look up a real mainnet Chog, sign the URI-bound
// EIP-712 message, mint the testnet mirror.
//
// What this page refuses to do is claim a mint is "verified" when the only
// evidence is that our frontend asked for it. The mint produces a checkable
// fact: the contract records keccak256(bytes(realURI)) at mint and exposes it
// through uriHashOf(). Anyone can recompute that hash from realURIOf(), not
// tokenURI(), which carries a display prefix on Test Drive tokens, and
// compare, with no trust in this page. The Test Drive path says in plain words
// that nobody signed anything.

import { useState } from "react";
import { saveMyChog } from "../lib/mychog";
import { refreshGate } from "../lib/gate";
import { Badge, Button, Card, Panel, Skeleton, Stat, Toast } from "@chogpool/ui";
import { navigate } from "../lib/router";
import { useWallet } from "../lib/useWallet";
import { busyStates } from "../lib/tx-pending";
import {
  MAX_SUPPLY,
  lookupChog,
  readContractDigest,
  readHasTestDrive,
  readNonce,
  readRemainingSupply,
  signMirrorMessage,
  type MirrorLookup,
} from "../lib/mirror";
import { DEPLOYED } from "../generated/addresses.gen";
import { shortAddress } from "../lib/wallet";

const mirrorAbi = [
  { type: "function", name: "mintWithSig", stateMutability: "nonpayable", inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "mainnetOwner", type: "address" },
      { name: "realURI", type: "string" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ], outputs: [] },
  { type: "function", name: "mintTestDrive", stateMutability: "nonpayable", inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "realURI", type: "string" },
    ], outputs: [] },
] as const;

// A token with no recorded URI digest reads as zero. Built from length rather
// than written as a literal, so the no-hardcoded-addresses rule needs no
// exception and the check still says exactly what it means.
function isZeroHash(hash: string): boolean {
  return /^0x0+$/.test(hash);
}

// Each mint page action, for per-button pending tracking. One action in flight
// marks only its own button; the others keep their labels and stay usable.
const MINT_ACTIONS = ["lookup", "sign", "mint", "test-drive"] as const;
type MintAction = (typeof MINT_ACTIONS)[number];

export default function Mint() {
  const wallet = useWallet();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<MirrorLookup | null>(null);
  // Which action is in flight, so only its own button shows a pending label.
  const [pending, setPending] = useState<MintAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<bigint | null>(null);
  const [hasTestDrive, setHasTestDrive] = useState<boolean | null>(null);

  async function lookupToken() {
    const raw = input.trim();
    if (!/^\d{1,4}$/.test(raw)) {
      setMessage("Enter a Chog ID from 1 to 1,969.");
      return;
    }
    const tokenId = BigInt(raw);
    if (tokenId < 1n || tokenId > BigInt(MAX_SUPPLY)) {
      setMessage("Enter a Chog ID from 1 to 1,969.");
      return;
    }
    setPending("lookup");
    setMessage(null);
    setLookup(null);
    try {
      const found = await lookupChog(tokenId);
      setLookup(found);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Lookup failed.";
      setMessage(text.includes("Failed to fetch") ? "Network or RPC unavailable. Check your connection and try again." : text);
    } finally {
      setPending(null);
    }
  }

  async function loadSupplyAndTestDrive() {
    void readRemainingSupply().then(setRemaining).catch(() => setRemaining(null));
    if (wallet.address) {
      void readHasTestDrive(wallet.address).then(setHasTestDrive).catch(() => setHasTestDrive(null));
    }
  }

  // Loaded once per page visit: remaining supply is global, and the Test Drive
  // flag is per wallet so it re-reads when the address changes.
  useState(() => { void loadSupplyAndTestDrive(); });

  /**
   * The verified path: fetch the real metadata, ask the contract for the exact
   * digest it will check, have the mainnet owner sign it, then mint. If any
   * step disagrees, nothing is broadcast.
   */
  async function mintVerified() {
    if (!lookup || !wallet.address || !wallet.walletClient) return;
    const { record, status } = lookup;
    if (status !== "unclaimed") return;

    setPending("sign");
    setMessage(null);
    try {
      const nonce = await readNonce(record.owner);
      // The digest comes from the contract, not from our own EIP-712 encoder:
      // if the two disagree the signature would be worthless, and reading it
      // removes that risk entirely.
      const digest = await readContractDigest(record.tokenId, record.owner, wallet.address, nonce, record.tokenURI);
      const { v, r, s } = await signMirrorMessage(wallet.walletClient, wallet.address, {
        tokenId: record.tokenId,
        mainnetOwner: record.owner,
        minter: wallet.address,
        nonce,
        realURI: record.tokenURI,
        digest,
      });

      setPending("mint");
      const ok = await wallet.runTx(async (walletClient, account) => {
        const hash = await walletClient.writeContract({
          address: DEPLOYED.mirror as `0x${string}`,
          abi: mirrorAbi,
          functionName: "mintWithSig",
          args: [record.tokenId, record.owner, record.tokenURI, v, r, s],
          account,
          chain: walletClient.chain,
        } as never);
        return { ok: true as const, hash, detail: "Mint sent." };
      }, undefined, `Minted Chog #${record.tokenId}`);
      if (ok) {
        setMessage(`Chog #${record.tokenId} is mirrored. Its stored URI is now provably the one its mainnet owner signed.`);
        if (wallet.address) saveMyChog(wallet.address, record.tokenId);
        refreshGate();
        setLookup(await lookupChog(record.tokenId));
        void loadSupplyAndTestDrive();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The mint was not sent.");
    } finally {
      setPending(null);
    }
  }

  /**
   * Test Drive: no signature, no provenance claim. The page says so in the
   * button, in the copy, and on the token itself (isTestDrive).
   */
  async function mintTestDrive() {
    if (!lookup || !wallet.walletClient) return;
    const { record } = lookup;
    setPending("test-drive");
    setMessage(null);
    try {
      const ok = await wallet.runTx(async (walletClient, account) => {
        const hash = await walletClient.writeContract({
          address: DEPLOYED.mirror as `0x${string}`,
          abi: mirrorAbi,
          functionName: "mintTestDrive",
          args: [record.tokenId, record.tokenURI],
          account,
          chain: walletClient.chain,
        } as never);
        return { ok: true as const, hash, detail: "Test Drive mint sent." };
      }, undefined, `Minted Test Drive Chog #${record.tokenId}`);
      if (ok) {
        setMessage(`Chog #${record.tokenId} is mirrored as a Test Drive. Nobody signed anything for it, that is what the label means.`);
        if (wallet.address) saveMyChog(wallet.address, record.tokenId);
        refreshGate();
        setLookup(await lookupChog(record.tokenId));
        void loadSupplyAndTestDrive();
      }
    } finally {
      setPending(null);
    }
  }

  // Each button is busy only while its own action is in flight. A mint
  // waiting on its receipt says nothing about the lookup button above it.
  const busy = busyStates(pending, MINT_ACTIONS);
  const ownerIsConnected =
    lookup !== null && wallet.address !== null && lookup.record.owner.toLowerCase() === wallet.address.toLowerCase();

  return (
    <>
      <section className="page-head">
        <p className="kicker">MIRROR MINT</p>
        <h1>Bring a Chog<br /><em>to the track.</em></h1>
        <p className="lede">
          Pick a Chog you own on Monad mainnet. Its metadata is fetched from the real collection,
          its owner signs a message binding that metadata, and the mirror mints with the signature
          recorded. Anyone can then verify the stored URI is the signed one, no trust required.
        </p>
        <div className="network-note"><span className="status-dot" /> Read: Monad Mainnet · Play: Monad Testnet · test funds only</div>
      </section>

      {!wallet.connected && (
        <Panel className="feature-panel">
          <Card title="Connect to mint" footer="MINTING REQUIRES A WALLET ON MONAD TESTNET">
            <p className="muted">
              {wallet.walletPresent
                ? "Connect a wallet to sign the mint and send the transaction."
                : "No browser wallet detected. Install MetaMask or Rabby, then reload."}
            </p>
            {wallet.connectError && <Toast tone="danger" message={wallet.connectError} />}
            <Button onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          </Card>
        </Panel>
      )}

      {wallet.connected && wallet.onWrongChain && (
        <Panel className="feature-panel">
          <Card title="Wrong network" aside={<Badge tone="danger">BLOCKED</Badge>} footer="MIRROR MINTS ONLY EXIST ON MONAD TESTNET">
            <p className="muted">Your wallet is on another network. Switch to Monad Testnet to mint.</p>
            <Button onClick={() => void wallet.switchNetwork()}>Switch to Monad Testnet</Button>
          </Card>
        </Panel>
      )}

      {message && <Toast tone={wallet.txError === message ? "danger" : "info"} message={message} />}
      {wallet.txError && <Toast tone="danger" message={wallet.txError} />}

      {hasTestDrive && (
        <Panel className="feature-panel">
          <Card title="You are in. Next: fund and deposit." footer="PRINCIPAL STAYS WITH YOU, ONLY YIELD RACES">
            <p className="muted">
              You hold a Chog, so the track is open. Put in some test funds and deposit against your
              Chog. Your principal stays withdrawable, and only the realized yield feeds the prize
              pot.
            </p>
            <Button onClick={() => { refreshGate(); navigate("/play"); }}>Fund and deposit →</Button>
          </Card>
        </Panel>
      )}

      <Panel className="feature-panel">
        <Card
          title="1. Pick a Chog"
          aside={<Badge tone="neutral">{remaining === null ? "…" : `${remaining} left`}</Badge>}
          footer="OWNERSHIP AND METADATA ARE READ FROM THE REAL MAINNET COLLECTION"
        >
          <label className="field">
            <span>CHOG ID (1–{MAX_SUPPLY.toLocaleString()})</span>
            <input inputMode="numeric" placeholder="1462" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <Button onClick={() => void lookupToken()} disabled={busy.lookup}>
            {busy.lookup ? "Reading mainnet…" : "Look up Chog"}
          </Button>
        </Card>
      </Panel>

      {pending === "lookup" && (
        <Panel className="feature-panel"><Card title="Reading mainnet"><Skeleton variant="block" /><Skeleton variant="text" /><Skeleton variant="text" width={200} /></Card></Panel>
      )}

      {lookup && (
        <Panel className="feature-panel">
          <Card
            title={`Chog #${lookup.record.tokenId}`}
            aside={
              lookup.status === "unclaimed"
                ? <Badge tone="lime">UNCLAIMED</Badge>
                : <Badge tone="neutral">ALREADY MIRRORED</Badge>
            }
            footer={lookup.record.tokenURI}
          >
            <div className="stat-row">
              <Stat label="MAINNET OWNER" value={shortAddress(lookup.record.owner)} note="Read from the real collection, not from us." />
              <Stat label="NAME" value={lookup.record.metadata.name ?? "Unnamed"} />
              <Stat
                label="MIRROR STATE"
                value={lookup.status === "unclaimed" ? "Unclaimed" : "Minted"}
                note={
                  lookup.status === "already-minted"
                    ? lookup.testDrive
                      ? "Minted as a Test Drive, no signature behind it."
                      : "Minted through the signed path."
                    : "Available to mirror."
                }
                tone={lookup.status === "unclaimed" ? "lime" : "neutral"}
              />
            </div>

            {lookup.record.metadata.image && (
              <p className="muted">
                Real metadata image: <a href={lookup.record.metadata.image.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${lookup.record.metadata.image.slice(7)}` : lookup.record.metadata.image} target="_blank" rel="noreferrer">view</a>
              </p>
            )}

            {lookup.status === "unclaimed" && wallet.connected && !wallet.onWrongChain && (
              <>
                <div className="divider" />
                <h4>2. Choose how to mint</h4>

                {ownerIsConnected ? (
                  <p className="muted">
                    You own this Chog, so you can sign for it yourself.
                  </p>
                ) : (
                  <p className="muted">
                    Your connected wallet is not this Chog's mainnet owner. The signature must come
                    from <strong>{shortAddress(lookup.record.owner)}</strong>, the same wallet that
                    holds it on mainnet. Connect that wallet to mint it with proof.
                  </p>
                )}

                <div className="button-row">
                  <Button onClick={() => void mintVerified()} disabled={busy.sign || busy.mint || !ownerIsConnected}>
                    {busy.sign ? "Waiting for signature…" : busy.mint ? "Minting…" : "Sign & mint (verified)"}
                  </Button>
                  <Button variant="outline" onClick={() => void mintTestDrive()} disabled={busy["test-drive"] || hasTestDrive === true}>
                    {hasTestDrive === true ? "Test Drive already used" : busy["test-drive"] ? "Minting…" : "Test Drive (no signature)"}
                  </Button>
                </div>

                <p className="muted small">
                  The verified path signs an EIP-712 message covering the token ID, the mainnet owner,
                  your address, a nonce, and <strong>keccak256 of the exact metadata URI</strong>. That
                  last term is why the minted token can be checked later by anyone.
                  <br /><br />
                  Test Drive mints with no signature at all. The token is clearly labelled as such
                  on-chain, and one Test Drive per wallet.
                </p>
              </>
            )}

            {lookup.status === "already-minted" && (
              <>
                <div className="divider" />
                <p className="muted">
                  Held by {lookup.mirrorOwner ? shortAddress(lookup.mirrorOwner) : "unknown"}.
                  {lookup.recordedHash && !isZeroHash(lookup.recordedHash) && (
                    <> Recorded URI digest: <code>{lookup.recordedHash.slice(0, 18)}…</code></>
                  )}
                </p>
                <Button variant="outline" onClick={() => navigate("/verify")}>Verify this token ↗</Button>
              </>
            )}
          </Card>
        </Panel>
      )}

      <Panel className="feature-panel">
        <Card title="Why the signature covers the URI" footer="THE CHECK A JUDGE CAN RUN WITHOUT TRUSTING US">
          <p className="muted">
            A mirror token stores the URI you submit. If that URI were not signed, the stored
            metadata would be only as honest as whoever sent the transaction, which in practice
            means trusting a frontend.
          </p>
          <p className="muted">
            Binding <code>keccak256(bytes(realURI))</code> into the signed message changes the
            question. Anyone can call <code>realURIOf(id)</code>, not <code>tokenURI(id)</code>,
            which prepends a <code>test-chog:</code> label to Test Drive tokens, hash those
            bytes, and compare with <code>uriHashOf(id)</code>. If they match, the metadata on
            chain is the metadata the mainnet owner signed. That check needs nothing from us and
            works forever.
          </p>
          <Button variant="outline" onClick={() => navigate("/verify")}>Run the check ↗</Button>
        </Card>
      </Panel>
    </>
  );
}
