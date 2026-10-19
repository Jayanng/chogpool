import { createPublicClient, createWalletClient, custom, defineChain, http, type Address, type WalletClient } from "viem";
import { CHAIN } from "../generated/addresses.gen";
import { rpcFetch } from "./rpc-throttle";

export type WalletState = {
  address: Address;
  chainId: number;
  walletClient: WalletClient;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
};

function getProvider(): Eip1193Provider | null {
  return ((window as Window & { ethereum?: Eip1193Provider }).ethereum) ?? null;
}

/** Honest wallet detection: reports which wallet is present, never implies one exists. */
export function detectWallet(): { present: boolean; label: string } {
  const provider = getProvider();
  if (!provider) return { present: false, label: "No browser wallet detected" };
  if (provider.isRabby) return { present: true, label: "Rabby" };
  if (provider.isMetaMask) return { present: true, label: "MetaMask" };
  return { present: true, label: "Browser wallet" };
}

export function chainLabel(chainId: number): string {
  if (chainId === CHAIN.monad.id) return CHAIN.monad.name;
  if (chainId === CHAIN.monadTestnet.id) return CHAIN.monadTestnet.name;
  return `Unsupported network (chainId ${chainId})`;
}

export function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The chains this app talks to, built from the generated registry. */
function chainFor(chainId: number) {
  const known = (CHAIN.monad.id === chainId ? CHAIN.monad : null) ?? (CHAIN.monadTestnet.id === chainId ? CHAIN.monadTestnet : null);
  const base = known ?? CHAIN.monadTestnet;
  return defineChain({
    id: chainId,
    name: known ? base.name : chainLabel(chainId),
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [base.rpc] } },
    blockExplorers: { default: { name: "MonadScan", url: base.explorer } },
  });
}

async function readChainId(provider: Eip1193Provider): Promise<number> {
  const rawChainId = await provider.request({ method: "eth_chainId" });
  return typeof rawChainId === "string" ? Number.parseInt(rawChainId, 16) : Number(rawChainId);
}

function clientFor(provider: Eip1193Provider, chainId: number): WalletClient {
  // viem refuses to sign a write on a chainless client ("No chain was
  // provided"), so the client carries the wallet's actual chain. Without this
  // every deposit, claim and mint dies before the wallet ever sees it.
  return createWalletClient({ chain: chainFor(chainId), transport: custom(provider as never) });
}

export async function connectWallet(): Promise<WalletState> {
  const provider = getProvider();
  if (!provider) throw new Error("Install a browser wallet such as MetaMask or Rabby to connect.");
  const chainId = await readChainId(provider);
  const walletClient = clientFor(provider, chainId);
  const [address] = await walletClient.requestAddresses();
  return { address, chainId, walletClient };
}

/**
 * The silent-restore decision, kept pure so it can be tested: an
 * eth_accounts answer restores a session only when it holds a real address.
 * Anything else (no answer, empty list, malformed entries) means no session.
 */
export function pickRestoreAccount(accounts: unknown): Address | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const first = accounts[0];
  return typeof first === "string" && /^0x[0-9a-fA-F]{40}$/.test(first) ? (first as Address) : null;
}

/**
 * Silent session restore for an already-authorized wallet. eth_accounts is
 * read-only and never pops the wallet UI, unlike eth_requestAccounts. Returns
 * null when nothing is authorized; a provider failure throws so the caller can
 * keep whatever state it already holds instead of treating a flake as a
 * disconnect.
 */
export async function restoreSession(): Promise<WalletState | null> {
  const provider = getProvider();
  if (!provider) return null;
  const address = pickRestoreAccount(await provider.request({ method: "eth_accounts" }));
  if (!address) return null;
  const chainId = await readChainId(provider);
  return { address, chainId, walletClient: clientFor(provider, chainId) };
}

export function onWalletChange(handler: () => void): () => void {
  const provider = getProvider();
  if (!provider || typeof (provider as { on?: unknown }).on !== "function") return () => {};
  const typed = provider as unknown as {
    on: (event: string, cb: () => void) => void;
    removeListener: (event: string, cb: () => void) => void;
  };
  typed.on("accountsChanged", handler);
  typed.on("chainChanged", handler);
  return () => {
    typed.removeListener("accountsChanged", handler);
    typed.removeListener("chainChanged", handler);
  };
}

async function switchToChain(walletClient: WalletClient, target: number, rpc: string, name: string): Promise<void> {
  try {
    await walletClient.switchChain({ id: target });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    const code = (error as { code?: number }).code;
    if (!msg.toLowerCase().includes("unrecognized chain") && code !== 4902 && !msg.toLowerCase().includes("4902")) throw error;
    await walletClient.addChain({
      chain: {
        id: target,
        name,
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      },
    });
    await walletClient.switchChain({ id: target });
  }
}

export async function switchToTestnet(walletClient: WalletClient): Promise<void> {
  await switchToChain(walletClient, CHAIN.monadTestnet.id, CHAIN.monadTestnet.rpc, CHAIN.monadTestnet.name);
}

export async function switchToMainnet(walletClient: WalletClient): Promise<void> {
  await switchToChain(walletClient, CHAIN.monad.id, CHAIN.monad.rpc, CHAIN.monad.name);
}

export const testnetReadClient = createPublicClient({
  chain: {
    id: CHAIN.monadTestnet.id,
    name: CHAIN.monadTestnet.name,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [CHAIN.monadTestnet.rpc] } },
  },
  // The public testnet RPC caps callers at 15 requests per second and answers
  // bursts with HTTP 429 / JSON-RPC -32011. The verifier walk fans out around
  // 54 reads at once, so every read through this client goes through the
  // throttled, retrying queue instead of hitting the cap and failing honest
  // checks.
  transport: http(CHAIN.monadTestnet.rpc, { fetchFn: rpcFetch() }),
});
