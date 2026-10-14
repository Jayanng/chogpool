import { createPublicClient, http, type Address } from "viem";
import { CHAIN, IPFS, MAINNET } from "../generated/addresses.gen";

const chogClient = createPublicClient({
  chain: {
    id: CHAIN.monad.id,
    name: CHAIN.monad.name,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [CHAIN.monad.rpc] } },
  },
  transport: http(CHAIN.monad.rpc),
});

const collection = MAINNET.chogGenesisNFT as Address;
const chogAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "uri", type: "string" }] },
] as const;

type RawTrait = { trait_type?: string; value?: string | number };
export type ChogMetadata = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: RawTrait[];
};
export type ChogRecord = {
  tokenId: bigint;
  owner: Address;
  tokenURI: string;
  metadata: ChogMetadata;
};

export function ipfsToGateway(uri: string): string {
  if (!uri.startsWith("ipfs://")) return uri;
  const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  return `${IPFS.gateway}${path}`;
}

export async function readChog(tokenId: bigint): Promise<ChogRecord> {
  if (tokenId < 1n || tokenId > 1969n) throw new Error("Enter a Chog ID from 1 to 1,969.");
  const [owner, uri] = await Promise.all([
    chogClient.readContract({ address: collection, abi: chogAbi, functionName: "ownerOf", args: [tokenId] }),
    chogClient.readContract({ address: collection, abi: chogAbi, functionName: "tokenURI", args: [tokenId] }),
  ]);
  const response = await fetch(ipfsToGateway(uri));
  if (!response.ok) throw new Error(`Chog metadata unavailable (IPFS gateway returned ${response.status}).`);
  const metadata = (await response.json()) as ChogMetadata;
  return { tokenId, owner, tokenURI: uri, metadata };
}
