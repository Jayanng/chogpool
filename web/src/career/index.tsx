// /career: a Chog's real racing record and the standings, read live from the
// CareerStore. Merged under the Race section as its Career tab.
//
// Every number here comes from the CareerStore on chain: trophies, wins, races,
// fatigue and the placement recorded for each race. Nothing is projected or
// invented. A Chog that has never raced shows an honest empty record, and a read
// that does not answer is shown as an error rather than dressed up as empty.

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Panel, Stat } from "@chogpool/ui";
import { ChogViewer } from "../components/ChogViewer";
import {
  fatigueLevel,
  multiplierValue,
  placementLabel,
  readCareerProfile,
  readLadder,
  type CareerProfile,
  type LadderEntry,
} from "../lib/career";

export default function Career() {
  const [idText, setIdText] = useState("1462");
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ladder, setLadder] = useState<LadderEntry[] | null>(null);
  const [ladderLoading, setLadderLoading] = useState(true);
  const [ladderError, setLadderError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  // Track mount so a slow read that lands after unmount never sets state.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The standings are global, so they load once on mount.
  useEffect(() => {
    let cancelled = false;
    readLadder()
      .then((rows) => {
        if (!cancelled) setLadder(rows);
      })
      .catch(() => {
        if (!cancelled) setLadderError("The standings did not answer on this RPC.");
      })
      .finally(() => {
        if (!cancelled) setLadderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function load(): Promise<void> {
    // Bump the sequence first so an in-flight read is superseded even on the
    // validation path: only the latest call may set state.
    const requestId = ++requestIdRef.current;
    const tokenId = Number(idText.trim());
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 1969) {
      setError("Enter a Chog ID between 1 and 1,969.");
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await readCareerProfile(BigInt(tokenId));
      // Drop a response a newer request superseded, or one that landed after
      // unmount: only the latest in-flight read may set state.
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setProfile(result);
    } catch (cause) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setProfile(null);
      setError(cause instanceof Error ? cause.message : "That read did not answer on this RPC.");
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }

  return (
    <>
      <section className="page-head">
        <p className="kicker">RACING CAREER</p>
        <h1>
          Every Chog
          <br />
          <em>leaves a record.</em>
        </h1>
        <p className="lede">
          Trophies, wins and fatigue are written to the CareerStore on chain, race by race. Look up
          any Chog to read its real record, never a projection.
        </p>
        <div className="network-note">
          <span className="status-dot" /> Play: Monad Testnet · recorded on chain
        </div>
      </section>

      <Panel className="feature-panel">
        <Card
          title="The ladder"
          aside={<Badge tone="neutral">{ladder ? `${ladder.length} ON THE BOARD` : "STANDINGS"}</Badge>}
          footer="RANKED BY WINS, THEN TROPHIES, THEN RACES · EVERY ROW IS REAL"
        >
          {ladderLoading && (
            <div className="loading-line">
              <span className="loading-dot" />Reading the standings from the chain…
            </div>
          )}
          {ladderError && (
            <p className="viewer-error" role="alert">
              {ladderError}
            </p>
          )}
          {ladder && ladder.length === 0 && (
            <p className="muted">
              No Chog has a recorded race yet. The ladder fills in as races finish.
            </p>
          )}
          {ladder && ladder.length > 0 && (
            <div className="career-history">
              {ladder.map((row, i) => (
                <div className="career-row" key={String(row.tokenId)}>
                  <span className="career-race">
                    <span className="career-rank">#{i + 1}</span> CHOG #{String(row.tokenId)}
                  </span>
                  <span className="career-record">
                    {row.wins} {row.wins === 1 ? "win" : "wins"} · {row.gold + row.silver + row.bronze}{" "}
                    {row.gold + row.silver + row.bronze === 1 ? "trophy" : "trophies"} · {row.races}{" "}
                    {row.races === 1 ? "race" : "races"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Panel>

      <Panel className="feature-panel">
        <Card
          title="Look up a career"
          aside={<Badge tone="neutral">CAREERSTORE</Badge>}
          footer="READ LIVE FROM THE CAREERSTORE · EVERY FIELD IS ON CHAIN"
        >
          <label className="field">
            <span>CHOG ID (1–1,969)</span>
            <input
              inputMode="numeric"
              value={idText}
              onChange={(e) => setIdText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) void load();
              }}
            />
          </label>
          <div className="button-row">
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? "Reading the record…" : "Read the record"}
            </Button>
          </div>
          {error && (
            <p className="viewer-error" role="alert">
              {error}
            </p>
          )}
        </Card>
      </Panel>

      {profile && (
        <>
          <Panel className="feature-panel">
            <Card
              title={`CHOG #${profile.tokenId}`}
              aside={
                <Badge tone={profile.wins > 0 ? "lime" : "neutral"}>
                  {profile.wins > 0 ? "WINNER" : "NO WINS YET"}
                </Badge>
              }
              footer="TROPHIES AND RACES RECORDED BY THE DRAW ENGINE ON FINISH"
            >
              <div className="stat-row">
                <Stat label="GOLD" value={String(profile.gold)} tone="accent" />
                <Stat label="SILVER" value={String(profile.silver)} />
                <Stat label="BRONZE" value={String(profile.bronze)} />
                <Stat label="WINS" value={String(profile.wins)} tone="lime" />
                <Stat label="RACES" value={String(profile.races)} />
              </div>
              <div className="stat-row">
                <Stat
                  label="FATIGUE ODDS"
                  value={`×${multiplierValue(profile.fatigueMultiplier).toFixed(2)}`}
                  note="1.00 is neutral. Below 1.00 is a fatigue drag."
                />
                <Stat
                  label="FATIGUE LEVEL"
                  value={`${Math.round(fatigueLevel(profile.fatigue) * 100)}%`}
                  note="0% is fresh, higher is more burdened."
                />
                <Stat
                  label="LAST RACE"
                  value={profile.lastRaceAt > 0 ? new Date(profile.lastRaceAt * 1000).toLocaleDateString() : "Never"}
                  note="When the store last recorded a race for this Chog."
                />
              </div>
            </Card>
          </Panel>

          <Panel className="feature-panel">
            <Card
              title="Race history"
              aside={<Badge tone="neutral">{profile.history.length} RECORDED</Badge>}
              footer="EVERY ROW IS A RACE THE CAREERSTORE RECORDED"
            >
              {profile.history.length === 0 ? (
                <p className="muted">
                  No races recorded for this Chog yet. Its first record lands here the moment the
                  draw engine records a finish.
                </p>
              ) : (
                <div className="career-history">
                  {[...profile.history].reverse().map((row) => (
                    <div className="career-row" key={String(row.raceId)}>
                      <span className="career-race">Race {String(row.raceId)}</span>
                      <span
                        className={
                          "career-place" +
                          (row.placement === 1 ? " place-gold" : row.placement === 2 ? " place-silver" : row.placement === 3 ? " place-bronze" : "")
                        }
                      >
                        {placementLabel(row.placement)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Panel>
        </>
      )}

      <Panel className="feature-panel">
        <Card title="The Chog's identity" footer="REAL IPFS METADATA, LOOKED UP LIVE">
          <ChogViewer />
        </Card>
      </Panel>
    </>
  );
}
