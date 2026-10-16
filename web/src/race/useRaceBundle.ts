// Race data assembly: one draw from the chain, plus the real Chog records and
// mirror badges every lane needs. Shared by the race show, the spectator board
// and Draft Night so all three present exactly the same facts.

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { readChog, ipfsToGateway, type ChogRecord } from "../lib/chog";
import {
  readCareer,
  readDrawEvents,
  readMirrorBadge,
  readTeamWallet,
  type CareerRecord,
  type MirrorBadge,
} from "../lib/draw";
import { getRaceSource } from "../lib/game";
import { readOutcome, type ReadOutcome } from "../lib/read-outcome";
import { traitsOf, tierOf } from "../lib/traits";
import { friendlyError } from "../lib/format";
import type { DrawEventRecord, DrawRecord } from "../types/race";

export type RacerDisplay = {
  tokenId: bigint;
  tickets: bigint;
  /** On-chain trait boost in 1e18, as the live boostOf mapping reads it now. */
  boost: bigint;
  /** Real Tier trait value from IPFS metadata, "" when unknown. */
  tier: string;
  /** Real trait key/values from IPFS metadata ({} when metadata is unreachable). */
  traits: Record<string, string>;
  name: string;
  imageUrl: string | null;
  /** True when the IPFS metadata could not be loaded: the lane shows its
   *  tokenId and says so instead of inventing a Chog. */
  metadataMissing: boolean;
  /** The mirror badge read in three states: a badge the mirror records, a
   *  mirror that answered with no badge, or a read that did not answer (never
   *  shown as "no badge": a failed read is not an answer). */
  badge: ReadOutcome<MirrorBadge>;
  /** The team-wallet read in the same three states. */
  team: ReadOutcome<Address>;
  career: CareerRecord | null;
};

export type RaceBundle = {
  draw: DrawRecord;
  events: DrawEventRecord | null;
  racers: RacerDisplay[];
};

export type RaceBundleState = {
  bundle: RaceBundle | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** One racer's display record. Exported for the three-state read tests. */
export async function loadRacer(tokenId: bigint, draw: DrawRecord): Promise<RacerDisplay> {
  const recordedCareer = draw.recordedCareers?.[tokenId.toString()] ?? null;
  const [chog, reads, career] = await Promise.all([
    readChog(tokenId).catch(() => null),
    // The badge and team reads keep their three states: a read that did not
    // answer is "failed", never folded into "nothing is recorded on chain".
    Promise.allSettled([readMirrorBadge(tokenId), readTeamWallet(tokenId)]),
    recordedCareer ? Promise.resolve(recordedCareer) : readCareer(tokenId, draw.drawId).catch(() => null),
  ]);
  const badge = readOutcome(reads[0], (b) => b.badge === 0); // badge 0: the mirror records no badge
  const team = readOutcome(reads[1], (address) => BigInt(address) === 0n); // zero address: nothing bound on chain
  const frozen = draw.racers.find((r) => r.tokenId === tokenId);
  const record: ChogRecord | null = chog;
  const traits = record ? traitsOf(record.metadata) : {};
  return {
    tokenId,
    tickets: frozen?.tickets ?? 0n,
    boost: frozen?.boost ?? 0n,
    tier: tierOf(traits) ?? "",
    traits,
    name: record?.metadata.name ?? `Chog #${tokenId.toString()}`,
    imageUrl: record && record.metadata.image ? ipfsToGateway(record.metadata.image) : null,
    metadataMissing: record === null,
    badge,
    team,
    career,
  };
}

export function useRaceBundle(drawId: bigint | null): RaceBundleState {
  const [bundle, setBundle] = useState<RaceBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (drawId === null) {
      setBundle(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const source = getRaceSource();
        const draw = source ? await source.getDraw(drawId) : null;
        if (!draw) throw new Error(`No draw ${drawId.toString()} exists on chain.`);
        // A dev draw can carry its own RaceRecorded trail; live draws get theirs
        // from the real event-log scan.
        const recorded = draw.recordedInscriptions;
        const [racers, events] = await Promise.all([
          Promise.all(draw.racers.map((r) => loadRacer(r.tokenId, draw))),
          recorded
            ? Promise.resolve<DrawEventRecord>({
                scannedFrom: 0n,
                scannedTo: 0n,
                revealedAt: null,
                awardedAt: null,
                inscriptions: recorded,
              })
            : draw.revealBlock > 0n
              ? readDrawEvents(draw).catch(() => null)
              : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setBundle({ draw, events, racers });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(friendlyError(e));
        setBundle(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drawId, tick]);

  return { bundle, loading, error, reload };
}
