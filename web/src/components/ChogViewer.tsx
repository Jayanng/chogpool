import { useState } from "react";
import { Badge, Button, Card, Skeleton } from "@chogpool/ui";
import { ipfsToGateway, readChog, type ChogRecord } from "../lib/chog";
import { ipfsName } from "../lib/result-copy";

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; record: ChogRecord };

/** Real mainnet Chog lookup: ownerOf + tokenURI + real IPFS metadata. No invented traits. */
export function ChogViewer({ onRecord }: { onRecord?: (record: ChogRecord) => void }) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });

  async function lookup() {
    const raw = input.trim();
    if (!/^\d{1,4}$/.test(raw)) {
      setState({ phase: "error", message: "Enter a Chog ID from 1 to 1,969." });
      return;
    }
    const tokenId = BigInt(raw);
    if (tokenId < 1n || tokenId > 1969n) {
      setState({ phase: "error", message: "Enter a Chog ID from 1 to 1,969." });
      return;
    }
    setState({ phase: "loading" });
    try {
      const record = await readChog(tokenId);
      setState({ phase: "ready", record });
      onRecord?.(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lookup failed.";
      setState({
        phase: "error",
        message: message.includes("Failed to fetch") || message.includes("NetworkError")
          ? "Network or RPC unavailable. Check your connection and try again."
          : message,
      });
    }
  }

  const traits = state.phase === "ready" ? (state.record.metadata.attributes ?? []) : [];
  const tier = traits.find((t) => (t.trait_type ?? "").toLowerCase() === "tier");

  return (
    <Card
      title="Look up any Chog"
      aside={<Badge tone="accent">LIVE MAINNET READ</Badge>}
      footer="READ: MONAD MAINNET · OWNER + TOKENURI + IPFS METADATA"
    >
      <div className="viewer-row">
        <input
          className="viewer-input"
          inputMode="numeric"
          placeholder="Chog ID (1–1969)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
          aria-label="Chog ID"
        />
        <Button onClick={() => void lookup()}>Look up</Button>
      </div>

      {state.phase === "loading" && (
        <div className="viewer-loading">
          <Skeleton variant="block" height={180} />
          <Skeleton variant="text" />
          <Skeleton variant="text" width={220} />
        </div>
      )}

      {state.phase === "error" && (
        <p className="viewer-error" role="alert">{state.message}</p>
      )}

      {state.phase === "ready" && (
        <div className="viewer-result">
          {state.record.metadata.image ? (
            <img
              className="viewer-image"
              src={ipfsToGateway(state.record.metadata.image)}
              alt={`Chog #${state.record.tokenId.toString()}`}
            />
          ) : (
            <div className="viewer-noimage">Metadata has no image field.</div>
          )}
          <div className="viewer-meta">
            <h3>CHOG #{state.record.tokenId.toString()}</h3>
            {ipfsName(state.record.tokenId, state.record.metadata.name) && (
              <p className="viewer-line">
                <span>IPFS NAME</span>
                <strong>{ipfsName(state.record.tokenId, state.record.metadata.name)}</strong>
              </p>
            )}
            <p className="viewer-line"><span>OWNER</span><code>{state.record.owner}</code></p>
            <p className="viewer-line"><span>TOKEN URI</span><code>{state.record.tokenURI}</code></p>
            {tier ? <p className="viewer-line"><span>TIER</span><strong>{String(tier.value)}</strong></p> : null}
            {traits.length > 0 && (
              <div className="viewer-traits">
                {traits.map((t, i) => (
                  <Badge key={`${t.trait_type}-${i}`}>{t.trait_type ?? "?"}: {String(t.value)}</Badge>
                ))}
              </div>
            )}
            <p className="viewer-note">Traits are real off-chain IPFS metadata. Any pace or boost mapping in the game is our design, derived from real traits, not an on-chain stat.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
