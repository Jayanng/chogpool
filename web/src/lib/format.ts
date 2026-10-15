// Small display formatters shared by the race show, the spectator board and
// the verifier. Numbers come in as the chain returns them and go out labeled.

import { formatUnits } from "viem";
import { POT_DECIMALS } from "../types/game";

/** Asset amount (pool USDC, 6 decimals) as the UI shows it, always labeled. */
export function formatAsset(amount: bigint, decimals: number = POT_DECIMALS): string {
  return `${formatUnits(amount, decimals)} USDC`;
}

/** Test $CHOG amount (18 decimals) as the UI shows it, always labeled. */
export function formatTestChog(amount: bigint): string {
  return `${formatUnits(amount, 18)} Test $CHOG`;
}

/** Ticket counts come from TWABs and can run to tens of millions. */
export function formatTickets(tickets: bigint): string {
  return tickets.toLocaleString("en-US");
}

/** Basis points as a percentage with two decimals. */
export function formatBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function shortHex(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Turn tooling errors into something a reader can act on. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "The Monad testnet RPC did not answer. Check the connection and try again.";
  }
  if (/does not support contract/i.test(message)) {
    return "The read layer could not reach the chain's helper contracts. Try again in a moment.";
  }
  return message;
}
