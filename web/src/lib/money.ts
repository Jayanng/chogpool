// The real money path: faucet → approve → deposit → withdraw, plus Test CHOG
// tips and harvest. Every call is a transaction the user signs, every address
// comes from the generated module, and every error is decoded to a sentence a
// human can act on rather than a hex blob.
//
// This module deliberately does NOT read pool state — `live.ts` owns reads, this
// owns writes. Splitting them means a read failure never blocks a write prompt
// and a write never silently changes a cached value the UI is showing.

import { type Address, type Hash, type PublicClient, type WalletClient, formatUnits, parseUnits } from "viem";
import { DEPLOYED, TESTNET } from "../generated/addresses.gen";

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

const stableFaucetAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "nextClaimAt", stateMutability: "view", inputs: [{ name: "who", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "cooldown", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const routerAbi = [
  { type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: [{ name: "amounts", type: "uint256[]" }] },
  { type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amounts", type: "uint256[]" }] },
] as const;

const poolAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "shares", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawAll", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
  { type: "function", name: "harvest", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const testChogAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nextClaimAt", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "claimAmount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "testLabel", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

export const USDC_DECIMALS = 6;
export const TEST_CHOG_DECIMALS = 18;

/** The pool's asset: PuddleSwap core USDC. NOT mintable, obtained by swap. */
export const ASSET = TESTNET.usdc as Address;
/** The faucet that mints the swappable quote token (USDT), 1000 per day. */
export const STABLE_FAUCET = TESTNET.stableFaucet as Address;
/** The quote token StableFaucet mints. */
export const QUOTE = TESTNET.usdt as Address;
/** PuddleSwap router, the only honest route from quote to asset. */
export const ROUTER = TESTNET.v2Router as Address;

export type TxOutcome =
  | { ok: true; hash: Hash; detail: string }
  | { ok: false; error: string };

/** A revert reason a user can act on. Every message names the next thing to do. */
function decodeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/user (rejected|denied)/i.test(raw)) return "You rejected the request in your wallet. Nothing was sent.";
  if (/insufficient allowance|ERC20InsufficientAllowance/i.test(raw)) return "The pool is not approved to move that much USDC. Approve first, then deposit.";
  if (/ERC20InsufficientBalance|transfer amount exceeds balance/i.test(raw)) return "Not enough USDC in this wallet. Claim from the faucet and swap it first.";
  if (/ClaimTooSoon/i.test(raw)) return "The faucet pays out once per day. Come back when the cooldown clears.";
  if (/CooldownActive/i.test(raw)) return "The Test CHOG faucet pays out once per day. Come back when the cooldown clears.";
  if (/TokenAlreadyMinted/i.test(raw)) return "That Chog is already mirrored. Pick another ID.";
  if (/SupplyExceeded/i.test(raw)) return "Chog IDs run from 1 to 1,969. That one does not exist.";
  if (/TestDriveAlreadyClaimed/i.test(raw)) return "This wallet already used its Test Drive mirror.";
  if (/InvalidSignature/i.test(raw)) return "The mainnet owner's signature did not match this mint. Nothing was sent.";
  if (/EXPIRED|insufficient output/i.test(raw)) return "The swap expired or the price moved too far. Retry with a fresh quote.";
  if (/nonce|replacement/i.test(raw)) return "A pending transaction from this wallet is blocking the next one. Wait for it, then retry.";
  if (/insufficient funds/i.test(raw)) return "This wallet needs MON for gas.";
  return raw.split("\n")[0].slice(0, 220);
}

// Structural shape of a viem writeContract request, without inferring from the
// generic (which pins the ABI and then rejects every call site whose literal ABI
// differs). `chain` and `account` are added by `send`.
type WriteRequest = Omit<Parameters<WalletClient["writeContract"]>[0], "account" | "chain">;

async function send(walletClient: WalletClient, account: Address, request: WriteRequest): Promise<TxOutcome> {
  try {
    // chain is passed explicitly so the wallet never has to guess which network
    // the call belongs to, and so a wallet on the wrong chain is caught here
    // rather than by the user's wallet showing an unrelated error.
    const hash = await walletClient.writeContract({
      ...request,
      account,
      chain: walletClient.chain,
      abi: request.abi,
      address: request.address,
      functionName: request.functionName,
      args: request.args,
    } as Parameters<WalletClient["writeContract"]>[0]);
    return { ok: true, hash, detail: "Sent. Waiting for confirmation." };
  } catch (error) {
    return { ok: false, error: decodeError(error) };
  }
}

// ---------------- reads backing the flows ----------------

export async function readUsdcBalance(client: PublicClient, account: Address): Promise<bigint> {
  return client.readContract({ address: ASSET, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

export async function readQuoteBalance(client: PublicClient, account: Address): Promise<bigint> {
  return client.readContract({ address: QUOTE, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

export async function readAllowance(client: PublicClient, owner: Address): Promise<bigint> {
  return client.readContract({ address: ASSET, abi: erc20Abi, functionName: "allowance", args: [owner, DEPLOYED.pool as Address] });
}

/** When `who` may next claim from the stable faucet. 0 = now. */
export async function readStableFaucetReadyAt(client: PublicClient, who: Address): Promise<number> {
  const at = await client.readContract({ address: STABLE_FAUCET, abi: stableFaucetAbi, functionName: "nextClaimAt", args: [who] });
  return Number(at);
}

/** When `who` may next claim Test CHOG. 0 = now. */
export async function readTestChogReadyAt(client: PublicClient, who: Address): Promise<number> {
  const at = await client.readContract({ address: DEPLOYED.testChogToken as Address, abi: testChogAbi, functionName: "nextClaimAt", args: [who] });
  return Number(at);
}

export async function readTestChogBalance(client: PublicClient, account: Address): Promise<bigint> {
  return client.readContract({ address: DEPLOYED.testChogToken as Address, abi: testChogAbi, functionName: "balanceOf", args: [account] });
}

/**
 * Quote for swapping `amountIn` quote tokens into the pool's asset.
 * A view call, so the UI can show what a claim is actually worth before
 * anyone signs anything.
 */
export async function quoteQuoteToAsset(client: PublicClient, amountIn: bigint): Promise<bigint | null> {
  try {
    const amounts = await client.readContract({
      address: ROUTER,
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [amountIn, [QUOTE, ASSET]],
    });
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

// ---------------- writes ----------------

/** Step 1 of funding: mint the swappable quote token. 1000 USDT, once per day. */
export async function claimStableFaucet(walletClient: WalletClient, account: Address): Promise<TxOutcome> {
  return send(walletClient, account, { address: STABLE_FAUCET, abi: stableFaucetAbi, functionName: "claim" });
}

/**
 * Swap quote into the pool's asset. Slippage is bounded at 1% against a quote
 * refreshed immediately before sending, so a thin pool can waste a claim but
 * cannot be sandwiched for an unbounded amount.
 */
export async function swapQuoteToAsset(walletClient: WalletClient, account: Address, amountIn: bigint, quotedOut: bigint, readClient: PublicClient): Promise<TxOutcome> {
  // Re-quote: a stale quote understates the minimum and hands value away.
  const fresh = await quoteQuoteToAsset(readClient, amountIn);
  const expected = fresh ?? quotedOut;
  const minOut = expected === 0n ? 0n : (expected * 99n) / 100n;
  // Deadline is measured from now, not from page load, so a slow wallet cannot
  // expire a valid swap.
  return send(walletClient, account, {
    address: ROUTER,
    abi: routerAbi,
    functionName: "swapExactTokensForTokens",
    args: [amountIn, minOut, [QUOTE, ASSET], account, BigInt(Math.floor(Date.now() / 1000) + 900)],
  });
}

/** Approve the pool to pull `amount` of the asset. Exact-amount, not infinite. */
export async function approveAsset(walletClient: WalletClient, account: Address, amount: bigint): Promise<TxOutcome> {
  return send(walletClient, account, {
    address: ASSET,
    abi: erc20Abi,
    functionName: "approve",
    args: [DEPLOYED.pool as Address, amount],
  });
}

export async function depositToPool(walletClient: WalletClient, account: Address, tokenId: bigint, amount: bigint): Promise<TxOutcome> {
  return send(walletClient, account, { address: DEPLOYED.pool as Address, abi: poolAbi, functionName: "deposit", args: [tokenId, amount] });
}

export async function withdrawFromPool(walletClient: WalletClient, account: Address, tokenId: bigint, shares: bigint): Promise<TxOutcome> {
  return send(walletClient, account, { address: DEPLOYED.pool as Address, abi: poolAbi, functionName: "withdraw", args: [tokenId, shares] });
}

export async function withdrawAllFromPool(walletClient: WalletClient, account: Address, tokenId: bigint): Promise<TxOutcome> {
  return send(walletClient, account, { address: DEPLOYED.pool as Address, abi: poolAbi, functionName: "withdrawAll", args: [tokenId] });
}

/**
 * Harvest realized yield into the prize pot. Callable by anyone — the money
 * only ever comes from real trades, so a UI button cannot inflate the pot.
 */
export async function harvestPot(walletClient: WalletClient, account: Address): Promise<TxOutcome> {
  return send(walletClient, account, { address: DEPLOYED.pool as Address, abi: poolAbi, functionName: "harvest" });
}

/** Test CHOG faucet: 1000 per day per wallet, play money for tips and rerolls. */
export async function claimTestChog(walletClient: WalletClient, account: Address): Promise<TxOutcome> {
  return send(walletClient, account, { address: DEPLOYED.testChogToken as Address, abi: testChogAbi, functionName: "claim" });
}

/**
 * Tip `amount` of Test CHOG to another address. Test CHOG is play money: the
 * label travels with the number in every caller's copy.
 */
export async function tipTestChog(walletClient: WalletClient, account: Address, to: Address, amount: bigint): Promise<TxOutcome> {
  return send(walletClient, account, {
    address: DEPLOYED.testChogToken as Address,
    abi: testChogAbi,
    functionName: "transfer",
    args: [to, amount],
  });
}

// ---------------- formatting ----------------

export function formatUsdc(value: bigint, maximumFractionDigits = 2): string {
  const text = formatUnits(value, USDC_DECIMALS);
  const [whole, frac = ""] = text.split(".");
  const trimmed = frac.replace(/0+$/, "").slice(0, maximumFractionDigits);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export function formatTestChog(value: bigint, maximumFractionDigits = 2): string {
  const text = formatUnits(value, TEST_CHOG_DECIMALS);
  const [whole, frac = ""] = text.split(".");
  const trimmed = frac.replace(/0+$/, "").slice(0, maximumFractionDigits);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Parses user input into asset units, rejecting junk rather than throwing. */
export function parseUsdc(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  try {
    return parseUnits(trimmed, USDC_DECIMALS);
  } catch {
    return null;
  }
}

export function parseTestChog(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null;
  try {
    return parseUnits(trimmed, TEST_CHOG_DECIMALS);
  } catch {
    return null;
  }
}

/** Countdown text for a cooldown, e.g. "7h 12m". Zero once the cooldown clears. */
export function cooldownLabel(readyAt: number, now: number = Math.floor(Date.now() / 1000)): string {
  const left = readyAt - now;
  if (left <= 0) return "";
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
