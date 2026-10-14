import { createPublicClient, createWalletClient, custom, http, type Address, type WalletClient } from "viem";
import { CHAIN } from "../generated/addresses.gen";

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

export async function connectWallet(): Promise<WalletState> {
  const provider = getProvider();
  if (!provider) throw new Error("Install a browser wallet such as MetaMask or Rabby to connect.");
  const walletClient = createWalletClient({ transport: custom(provider as never) });
  const [address] = await walletClient.requestAddresses();
  const chainId = await walletClient.getChainId();
  return { address, chainId, walletClient };
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
  transport: http(CHAIN.monadTestnet.rpc),
});
