import { createPublicClient, createWalletClient, custom, http, type Address, type WalletClient } from "viem";
import { CHAIN } from "../generated/addresses.gen";

export type WalletState = {
  address: Address;
  chainId: number;
  walletClient: WalletClient;
};

export async function connectWallet(): Promise<WalletState> {
  const provider = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!provider) throw new Error("Install a browser wallet such as MetaMask or Rabby to connect.");
  const walletClient = createWalletClient({ transport: custom(provider as never) });
  const [address] = await walletClient.requestAddresses();
  const chainId = await walletClient.getChainId();
  return { address, chainId, walletClient };
}

export async function switchToTestnet(walletClient: WalletClient): Promise<void> {
  const target = CHAIN.monadTestnet.id;
  try {
    await walletClient.switchChain({ id: target });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (!msg.toLowerCase().includes("unrecognized chain") && !msg.toLowerCase().includes("4902")) throw error;
    await walletClient.addChain({
      chain: {
        id: target,
        name: "Monad Testnet",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [CHAIN.monadTestnet.rpc] } },
      },
    });
    await walletClient.switchChain({ id: target });
  }
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
