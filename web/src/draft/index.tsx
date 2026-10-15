import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Panel, Skeleton } from "@chogpool/ui";
import { ipfsToGateway, readChog, type ChogRecord } from "../lib/chog";
import { perkOffers, traitsOf, tierOf, type Perk } from "../lib/traits";
import { clearPick, loadPick, savePick, type DraftPick } from "../lib/draft";
import { readCurrentRaceId } from "../lib/game";
import { navigate } from "../lib/router";

/**
 * Draft Night: before a race, pick one of three trait-derived perks for a
 * Chog. Perks are cosmetic pace flavor for the replay, capped at the same
 * +25% the contracts cap trait boosts at. They never touch the draw: the
 * winner is fixed on chain and no perk on this page can move it.
 */
export default function Draft() {
  const [drawKey, setDrawKey] = useState("next");
  const [input, setInput] = useState("");
  const [state, setState] = useState<{ phase: "idle" | "loading" | "ready" | "error"; record?: ChogRecord; message?: string }>({ phase: "idle" });
  const [pick, setPick] = useState<DraftPick | null>(null);

  useEffect(() => {
    let cancelled = false;
    readCurrentRaceId()
      .then((id) => {
        if (!cancelled && id !== null) setDrawKey(id.toString());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const raw = input.trim();
    if (!/^\d{1,4}$/.test(raw)) {
      setState({ phase: "error", message: "Enter a Chog ID from 1 to 1,969." });
      return;
    }
    setState({ phase: "loading" });
    try {
      const record = await readChog(BigInt(raw));
      setState({ phase: "ready", record });
      setPick(loadPick(drawKey, record.tokenId.toString()));
    } catch (e) {
      setState({
        phase: "error",
        message: e instanceof Error ? e.message : "That Chog could not be loaded from IPFS.",
      });
    }
  }, [input, drawKey]);

  const record = state.phase === "ready" ? state.record : undefined;
  const traits = record ? traitsOf(record.metadata) : {};
  const offers: Perk[] = record ? perkOffers(BigInt(drawKey === "next" ? "0" : drawKey), record.tokenId, traits) : [];
  const tier = tierOf(traits);

  return (
    <>
      <section className="page-head">
        <p className="kicker">DRAFT NIGHT</p>
        <h1>Pick your perk.</h1>
        <p className="lede">
          Before each race, pick 1-of-3 trait-derived perks. Perks are cosmetic pace flavor within the
          capped boost and side prizes only. They never change the on-chain winner.
        </p>
        <Badge tone="accent">{drawKey === "next" ? "DRAFTING FOR THE NEXT RACE" : `DRAFTING FOR RACE ${drawKey}`}</Badge>
      </section>

      <Panel className="feature-panel">
        <label className="field">
          <span>CHOG ID</span>
          <input
            value={input}
            placeholder="Chog ID (1–1969)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
            inputMode="numeric"
          />
        </label>
        <div className="hero-actions">
          <Button onClick={() => void load()}>Deal my three perks</Button>
          <Button variant="quiet" onClick={() => navigate("/race")}>See the race show</Button>
        </div>
        {state.phase === "error" && <p className="viewer-error" role="alert">{state.message}</p>}
      </Panel>

      {state.phase === "loading" && (
        <Panel className="feature-panel">
          <Skeleton variant="block" height={140} />
          <Skeleton variant="text" />
        </Panel>
      )}

      {record && (
        <Panel className="feature-panel">
          <div className="viewer-result">
            {record.metadata.image ? (
              <img className="viewer-image" src={ipfsToGateway(record.metadata.image)} alt={record.metadata.name ?? `Chog #${record.tokenId.toString()}`} />
            ) : (
              <div className="viewer-noimage">Metadata has no image field.</div>
            )}
            <div className="viewer-meta">
              <h3>CHOG #{record.tokenId.toString()}</h3>
              {record.metadata.name && record.metadata.name !== `CHOG #${record.tokenId.toString()}` && (
                <p className="viewer-line"><span>IPFS NAME</span><strong>{record.metadata.name}</strong></p>
              )}
              {tier && <p className="viewer-line"><span>TIER</span><strong>{tier}</strong></p>}
              <div className="viewer-traits">
                {Object.entries(traits).map(([key, value]) => (
                  <Badge key={key}>{key}: {value}</Badge>
                ))}
              </div>
              <p className="viewer-note">
                Traits are real off-chain IPFS metadata. The perk copy below weaves those real values into
                our own presentation language. Nothing here is an on-chain stat.
              </p>
            </div>
          </div>

          <div className="draft-grid">
            {offers.map((offer) => {
              const chosen = pick?.perk.id === offer.id;
              return (
                <Card
                  key={offer.id}
                  title={offer.name}
                  aside={<Badge tone={chosen ? "lime" : "neutral"}>{chosen ? "YOUR PICK" : "OFFER"}</Badge>}
                  footer={`PACE FLAVOR ${(offer.paceDelta * 100).toFixed(1)}% · INSIDE THE +25% CAP · SHOW ONLY`}
                >
                  <p className="muted">{offer.blurb}</p>
                  <div className="hero-actions">
                    {chosen ? (
                      <Button variant="outline" onClick={() => { clearPick(drawKey, record.tokenId.toString()); setPick(null); }}>
                        Change my pick
                      </Button>
                    ) : (
                      <Button onClick={() => setPick(savePick(drawKey, record.tokenId.toString(), { id: offer.id, name: offer.name, paceDelta: offer.paceDelta }))}>
                        Draft {offer.name}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {pick && (
            <p className="share-status">
              {pick.perk.name} is drafted for CHOG #{record.tokenId.toString()}. It changes only how the replay
              looks, and it is kept in this browser alone.
            </p>
          )}
        </Panel>
      )}

      <Panel className="feature-panel">
        <Card title="On-chain truth vs the show layer" footer="THE DRAW ENGINE DECIDES THE WINNER">
          <ul className="rules-list">
            <li>On-chain truth: the frozen ticket book, the commit-reveal seed, the derived winners, the pot payout.</li>
            <li>Show layer: pace flavor, style labels, the perk you draft, the confetti and the sound.</li>
            <li>The show layer reads the truth layer and can never write it. A perk is a costume, not an engine.</li>
            <li>Every perk stays inside the same +25% presentation cap the contracts use for trait boosts.</li>
          </ul>
        </Card>
        <Card
          title="Best-dressed: voted by the crowd"
          aside={<Badge tone="accent">TEST $CHOG · PLAY MONEY ON TESTNET</Badge>}
          footer="THE CROWD'S CHEERS ARE THE SIDE PRIZE"
        >
          <p className="muted">
            Spectators vote with Test $CHOG cheers. Each cheer is a real transfer on Monad testnet from the
            fan's wallet to the racer's team wallet, so the side prize is not a promise: it is the crowd's
            play money, delivered on chain as it is sent. The most-backed racer of the night takes the
            best-dressed crown.
          </p>
          <div className="hero-actions">
            <Button onClick={() => navigate("/spectator")}>Open the spectator board</Button>
          </div>
        </Card>
      </Panel>
    </>
  );
}
