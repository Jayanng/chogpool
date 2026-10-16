# Mirror verification — recorded live result

**What this is:** the check documented in `TESTING.md` §5, executed against the
live deployed stack and recorded here verbatim. This file is evidence, not
source — it quotes the real addresses and hashes the check produced, which is
the only thing that makes it a record of anything rather than a claim. It is
allowlisted in `infra/check-addresses.mjs` for that reason, on the same footing
as `docs/GATE1-LOG.md` and `docs/GATE2-LOG.md`.

**Stack:** v5 (Monad testnet, chainId 10143). Read the addresses from
`infra/deployments.json`; the mirror is the `mirror` key.

## The property

For a minted token, `keccak256(bytes(realURIOf(id)))` must equal
`uriHashOf(id)`. `realURIOf()` returns the prefix-free URI that was hashed at
mint; `tokenURI()` must NOT be used for this, because it prepends
`test-chog:` to Test Drive tokens and that prefix was never part of the signed
bytes.

## The run

Test Drive mint of token 1462, tx
`0x0c0e615420db2aecc147d0d7da2d22270057668d6b269414ea93c320324c7f40`
(status 1, gas 300646, from racer1).

```
realURIOf(1462) : ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json
keccak256(bytes) : 0x76d3e0627169a69d8b8f2ddacbe3139e1df9f760df819fd053979e47aeddb8e7
uriHashOf(1462)  : 0x76d3e0627169a69d8b8f2ddacbe3139e1df9f760df819fd053979e47aeddb8e7   MATCH

tokenURI(1462)   : test-chog:ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json
keccak(tokenURI) : 0x1c5799cf7f8f3ef5381b6b21cf318a7be357526045130a4772b909570d03da8a   does NOT match
```

The second line is the bug that motivated the fix, reproduced on chain: hashing
`tokenURI()` gives a false negative for exactly the tokens that carry no
signature.

## Provenance of the minted token

```
isTestDrive(1462): true
badgeOf(1462)    : 1
ownerOf(1462)    : racer1 (0xc0aB480032730f9f1071D9A5d2627e8DA23FD4B2)
totalMinted      : 1
```

`isTestDrive` true means nobody signed anything, so the hash match above proves
only that the stored bytes hash to the recorded value. It is not an attestation
of mainnet ownership, and the token says so on chain.

## Reproduce

```bash
MIRROR=<mirror address from infra/deployments.json>
RPC=https://testnet-rpc.monad.xyz

cast call $MIRROR 'realURIOf(uint256)(string)' 1462 --rpc-url $RPC
cast call $MIRROR 'uriHashOf(uint256)(bytes32)' 1462 --rpc-url $RPC
cast keccak "$(cast call $MIRROR 'realURIOf(uint256)(string)' 1462 --rpc-url $RPC | tr -d '\"')"
```
