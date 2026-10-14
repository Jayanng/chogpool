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

// SWR-style cache keyed by tokenId (plan Phase 2 item 4): a cached record is
// served instantly while a background revalidation refreshes it, so owners
// that changed hands update without a second explicit lookup. In-flight reads
// are deduplicated. TTL keeps the revalidation window small and honest.
const CACHE_TTL_MS = 60_000;
type CacheEntry = { record: ChogRecord; at: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ChogRecord>>();

async function fetchChog(tokenId: bigint): Promise<ChogRecord> {
  const [owner, uri] = await Promise.all([
    chogClient.readContract({ address: collection, abi: chogAbi, functionName: "ownerOf", args: [tokenId] }),
    chogClient.readContract({ address: collection, abi: chogAbi, functionName: "tokenURI", args: [tokenId] }),
  ]);
  const response = await fetch(ipfsToGateway(uri));
  if (!response.ok) throw new Error(`Chog metadata unavailable (IPFS gateway returned ${response.status}).`);
  const metadata = (await response.json()) as ChogMetadata;
  return { tokenId, owner, tokenURI: uri, metadata };
}

function refresh(tokenId: bigint, key: string): Promise<ChogRecord> {
  const pending = fetchChog(tokenId)
    .then((record) => {
      cache.set(key, { record, at: Date.now() });
      return record;
    })
    .catch((error) => {
      inFlight.delete(key);
      throw error;
    });
  inFlight.set(key, pending);
  return pending;
}

export function readChog(tokenId: bigint): Promise<ChogRecord> {
  if (tokenId < 1n || tokenId > 1969n) return Promise.reject(new Error("Enter a Chog ID from 1 to 1,969."));
  const key = tokenId.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.record);
  const pending = inFlight.get(key);
  if (pending) return pending;
  if (hit) {
    // stale-while-revalidate: return the cached record now, refresh in background
    void refresh(tokenId, key).catch(() => {});
    return Promise.resolve(hit.record);
  }
  return refresh(tokenId, key);
}
