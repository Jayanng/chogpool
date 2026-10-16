// The mirror mint path: read a real mainnet Chog, ask its owner to sign the
// EIP-712 message, and mint the testnet mirror with the URI bound into that
// signature.
//
// The point of the whole flow is the last line. A token minted this way can be
// checked by anyone, forever, without trusting us: read realURIOf(tokenId): 
// NOT tokenURI(), which prepends a `test-chog:` display prefix to Test Drive
// tokens that was never part of the signed bytes, hash those bytes with
// keccak256, and compare with mirror.uriHashOf(). If they match, the stored
// metadata is the metadata the mainnet owner signed. Nothing about that check
// needs the frontend to be honest.

import { type Address, type Hash, type WalletClient, keccak256, stringToHex } from "viem";
import { DEPLOYED, IPFS, MAINNET } from "../generated/addresses.gen";
import { ipfsToGateway, readChog, type ChogRecord } from "./chog";
import { testnetReadClient } from "./wallet";

export const MAX_SUPPLY = 1969;

const mirrorAbi = [
  { type: "function", name: "mintWithSig", stateMutability: "nonpayable", inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "mainnetOwner", type: "address" },
      { name: "realURI", type: "string" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ], outputs: [] },
  { type: "function", name: "mintTestDrive", stateMutability: "nonpayable", inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "realURI", type: "string" },
    ], outputs: [] },
  { type: "function", name: "isUnclaimed", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "uriHashOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "realURIOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "isTestDrive", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "hasTestDrive", stateMutability: "view", inputs: [{ name: "who", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "who", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "remainingSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "hashMirrorMessage", stateMutability: "view", inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "mainnetOwner", type: "address" },
      { name: "minter", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "realURI", type: "string" },
    ], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "domainSeparator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
] as const;

const MIRROR_TYPES = {
  Mirror: [
    { name: "tokenId", type: "uint256" },
    { name: "mainnetOwner", type: "address" },
    { name: "minter", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "uriHash", type: "bytes32" },
  ],
} as const;

export type MirrorStatus =
  | "loading"
  | "unclaimed"
  | "already-minted"
  | "not-a-real-chog";

/** What the page shows once it has read a token from mainnet. */
export type MirrorLookup = {
  record: ChogRecord;
  status: MirrorStatus;
  /** Set once mirrored: who holds it, and whether it is a Test Drive. */
  mirrorOwner?: Address;
  testDrive?: boolean;
  /** The digest the contract recorded, for a minted token. */
  recordedHash?: Hash;
};

const mirror = () => DEPLOYED.mirror as Address;

/** Reads a real mainnet Chog and checks its mirror state in one pass. */
export async function lookupChog(tokenId: bigint): Promise<MirrorLookup> {
  // readChog caches with a short TTL and revalidates, so repeated
  // lookups of the same token do not hammer the RPC or the IPFS gateway.
  const record = await readChog(tokenId);
  const [unclaimed, recordedHash] = await Promise.all([
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "isUnclaimed", args: [tokenId] }),
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "uriHashOf", args: [tokenId] }),
  ]);

  if (unclaimed) return { record, status: "unclaimed" };

  // Minted: read who holds it and whether the provenance path was used.
  const [owner, testDrive] = await Promise.all([
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "ownerOf", args: [tokenId] }).catch(() => null),
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "isTestDrive", args: [tokenId] }).catch(() => false),
  ]);
  return {
    record,
    status: "already-minted",
    mirrorOwner: owner ?? undefined,
    testDrive,
    recordedHash,
  };
}

export async function readRemainingSupply(): Promise<bigint> {
  return testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "remainingSupply" });
}

export async function readNonce(who: Address): Promise<bigint> {
  return testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "nonces", args: [who] });
}

export async function readHasTestDrive(who: Address): Promise<boolean> {
  return testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "hasTestDrive", args: [who] });
}

/**
 * The digest the contract will check, read FROM the contract.
 *
 * Reading it rather than rebuilding it locally is deliberate: a wallet's
 * typed-data encoder and the contract's EIP-712 hasher must agree exactly, and
 * the only way to be sure of that before signing is to ask the contract what
 * it expects. The signature is then checked against this value.
 */
export async function readContractDigest(tokenId: bigint, mainnetOwner: Address, minter: Address, nonce: bigint, realURI: string): Promise<Hash> {
  return testnetReadClient.readContract({
    address: mirror(),
    abi: mirrorAbi,
    functionName: "hashMirrorMessage",
    args: [tokenId, mainnetOwner, minter, nonce, realURI],
  });
}

export type MirrorSignature = { v: number; r: Hash; s: Hash };

/**
 * Ask the wallet to sign the mirror message. The URI is hashed into the struct,
 * so this signature is only valid for exactly this metadata, which is what
 * makes the stored URI verifiable later.
 *
 * `digest` is the value the contract says it will check (read from
 * hashMirrorMessage). The signature is produced over the same struct, so the
 * two must agree; passing the contract's digest in keeps that honest rather
 * than assuming our encoder matches.
 */
export async function signMirrorMessage(
  walletClient: WalletClient,
  account: Address,
  args: { tokenId: bigint; mainnetOwner: Address; minter: Address; nonce: bigint; realURI: string; digest: Hash },
): Promise<MirrorSignature> {
  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: "ChogMirror",
      version: "1",
      chainId: 10143,
      verifyingContract: mirror(),
    },
    types: MIRROR_TYPES,
    primaryType: "Mirror",
    message: {
      tokenId: args.tokenId,
      mainnetOwner: args.mainnetOwner,
      minter: args.minter,
      nonce: args.nonce,
      // The hashed URI is what the wallet signs. Hashing it here, client-side,
      // matches the contract's keccak256(bytes(realURI)).
      uriHash: keccak256(stringToHex(args.realURI)),
    },
  });

  const r = `0x${signature.slice(2, 66)}` as Hash;
  const s = `0x${signature.slice(66, 130)}` as Hash;
  const v = parseInt(signature.slice(130, 132), 16);
  return { v, r, s };
}

// ---------------- verification, the point of all of it ----------------

export type VerificationResult = {
  /** The real metadata URI recorded at mint, with no display prefix. */
  realURI: string;
  /** What tokenURI() returns, which carries a prefix for Test Drive tokens. */
  displayedURI: string;
  /** keccak256 of the stored URI's bytes. */
  computedHash: Hash;
  /** What the contract recorded at mint. */
  recordedHash: Hash;
  /** Whether the stored URI hashes to the recorded digest. */
  uriMatches: boolean;
  /** Whether this token was minted through the signed (attested) path. */
  attested: boolean;
  testDrive: boolean;
};

/**
 * The check anyone can run with no trust in us: read what the contract stores,
 * hash it, compare with the digest the contract recorded.
 *
 * It hashes `realURIOf()`, NOT `tokenURI()`. tokenURI() prepends a display
 * prefix to Test Drive tokens, and that prefix was never part of the signed
 * bytes, so hashing it would report a false negative for exactly the tokens
 * that carry no signature. Hashing the real URI makes the check mean the same
 * thing for both paths.
 */
export async function verifyMirrorToken(tokenId: bigint): Promise<VerificationResult> {
  const [realURI, displayedURI, recordedHash, testDrive] = await Promise.all([
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "realURIOf", args: [tokenId] }),
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "tokenURI", args: [tokenId] }),
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "uriHashOf", args: [tokenId] }),
    testnetReadClient.readContract({ address: mirror(), abi: mirrorAbi, functionName: "isTestDrive", args: [tokenId] }).catch(() => false),
  ]);
  const computedHash = keccak256(stringToHex(realURI));
  return {
    realURI,
    displayedURI,
    computedHash,
    recordedHash,
    uriMatches: computedHash.toLowerCase() === recordedHash.toLowerCase(),
    // A Test Drive token records a hash too, but nobody signed it, so a hash
    // match proves only that the stored bytes hash to the recorded value.
    attested: !testDrive && computedHash.toLowerCase() === recordedHash.toLowerCase(),
    testDrive,
  };
}

/** Gateway URL for a stored IPFS URI, for showing the real metadata. */
export function mirrorMetadataUrl(storedURI: string): string {
  return ipfsToGateway(storedURI);
}

export { MAINNET, IPFS };
