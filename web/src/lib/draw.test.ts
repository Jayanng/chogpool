// The mirror URI digest check, pinned to live chain data. ChogMirror hashes
// keccak256 over the UNPREFIXED uri at mint (ChogMirror.sol, both mint paths),
// while tokenURI() returns the "test-chog:"-labelled string for Test Drive
// tokens. Hashing the labelled bytes manufactures a mismatch against real
// chain data, so the check must hash exactly the bytes the contract hashed.
//
// Live values, read from the deployed v4 mirror for badge 1 token 1462:
//   tokenURI(1462)  = "test-chog:ipfs://bafybei.../1462.json"
//   uriHashOf(1462) = 0x76d3e062...edb8e7   (keccak of the UNPREFIXED uri)

import { describe, expect, it } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import { checkMirrorUriHash, mirrorHashUri, TEST_DRIVE_URI_PREFIX } from "./draw";

const TOKEN_1462_TOKEN_URI =
  "test-chog:ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json";
const TOKEN_1462_URI =
  "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json";
const TOKEN_1462_URI_HASH_OF: Hex =
  "0x76d3e0627169a69d8b8f2ddacbe3139e1df9f760df819fd053979e47aeddb8e7";
// The digest over the LABELLED bytes: the wrong value the page used to compute.
const LABELLED_BYTES_HASH: Hex =
  "0x1c5799cf7f8f3ef5381b6b21cf318a7be357526045130a4772b909570d03da8a";

describe("the mirror URI check hashes the bytes the contract hashed", () => {
  it("strips the Test Drive label before hashing", () => {
    expect(TEST_DRIVE_URI_PREFIX).toBe("test-chog:");
    expect(mirrorHashUri(TOKEN_1462_TOKEN_URI)).toBe(TOKEN_1462_URI);
    // A Verified Holder uri carries no label and passes through untouched.
    expect(mirrorHashUri(TOKEN_1462_URI)).toBe(TOKEN_1462_URI);
  });

  it("recomputes uriHashOf(1462) exactly, from the tokenURI() string", () => {
    const check = checkMirrorUriHash(TOKEN_1462_TOKEN_URI, TOKEN_1462_URI_HASH_OF);
    expect(check.computedHash).toBe(TOKEN_1462_URI_HASH_OF);
    expect(check.hashMatch).toBe(true);
  });

  it("keeps matching for an unprefixed Verified Holder uri", () => {
    const check = checkMirrorUriHash(TOKEN_1462_URI, TOKEN_1462_URI_HASH_OF);
    expect(check.computedHash).toBe(TOKEN_1462_URI_HASH_OF);
    expect(check.hashMatch).toBe(true);
  });

  it("never computes the labelled-bytes digest the old code produced", () => {
    // Pinned contrast: hashing the labelled bytes gives this wrong value.
    expect(keccak256(toBytes(TOKEN_1462_TOKEN_URI))).toBe(LABELLED_BYTES_HASH);
    const check = checkMirrorUriHash(TOKEN_1462_TOKEN_URI, TOKEN_1462_URI_HASH_OF);
    expect(check.computedHash).not.toBe(LABELLED_BYTES_HASH);
  });

  it("still reports a real mismatch and an absent binding honestly", () => {
    expect(checkMirrorUriHash(TOKEN_1462_TOKEN_URI, LABELLED_BYTES_HASH).hashMatch).toBe(false);
    expect(checkMirrorUriHash(TOKEN_1462_TOKEN_URI, null).hashMatch).toBeNull();
  });
});
