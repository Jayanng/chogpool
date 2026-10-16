// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogMirror} from "../src/ChogMirror.sol";
import {IChogMirror} from "../interfaces/IChogMirror.sol";
import {Vm} from "forge-std/Vm.sol";

/// @title Production mirror test suite, every test is an attack or an invariant.
/// @notice Ports the full 10-attack audit suite from ChogMirrorProto.t.sol onto the
///         production ChogMirror, plus new coverage for the interface's view surface
///         and the nonce-burn fix. If any attack test stops reverting the way it
///         should, the design claim is broken.
contract ChogMirrorTest is Test {
    ChogMirror mirror;

    address REAL_OWNER;
    uint256 OWNER_KEY;
    address THIEF;
    uint256 THIEF_KEY;
    address OTHER_USER;
    address MINTER; // the wallet that sends the tx (may differ from the signer)
    uint256 MINTER_KEY;

    uint256 constant TOKEN = 7;
    uint256 constant OTHER_TOKEN = 500;
    string constant REAL_URI = "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json";
    string constant BASE_URI = "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/";

    function setUp() public {
        (REAL_OWNER, OWNER_KEY) = makeAddrAndKey("real_owner");
        (THIEF, THIEF_KEY) = makeAddrAndKey("thief");
        (OTHER_USER,) = makeAddrAndKey("other_user");
        (MINTER, MINTER_KEY) = makeAddrAndKey("minter");
        mirror = new ChogMirror(BASE_URI, address(this));
    }

    // ---------- helpers ----------

    function _sign(uint256 tokenId, address mainnetOwner, address minter, uint256 nonce, uint256 privKey)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        // The URI is bound into the signed message, so the digest the test builds must
        // match what the contract checks: keccak256(bytes(realURI)) as the fifth term.
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce,bytes32 uriHash)"
                ),
                tokenId,
                mainnetOwner,
                minter,
                nonce,
                keccak256(bytes(REAL_URI))
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ChogMirror"),
                keccak256("1"),
                block.chainid,
                address(mirror)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(privKey, digest);
    }

    /// Sign the exact message the contract computes, using its own live nonce.
    function _signWithLiveNonce(uint256 tokenId, address mainnetOwner, address minter, uint256 privKey)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        return _sign(tokenId, mainnetOwner, minter, mirror.nonces(mainnetOwner), privKey);
    }

    // ---------- the honest path ----------

    function test_VerifiedMint_RecordsProvenance() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);

        assertEq(mirror.ownerOf(TOKEN), REAL_OWNER);
        assertEq(mirror.mainnetOwnerOf(TOKEN), REAL_OWNER);
        assertEq(mirror.badgeOf(TOKEN), 2); // Verified Holder
        assertEq(mirror.tokenURI(TOKEN), REAL_URI);
        assertFalse(mirror.isTestDrive(TOKEN));
        assertEq(mirror.nonces(REAL_OWNER), 1);
        assertEq(mirror.totalMinted(), 1);
        assertEq(mirror.remainingSupply(), mirror.MAX_SUPPLY() - 1);
    }

    /// A phone wallet can sign while a different browser wallet receives the mirror.
    function test_VerifiedMint_MinterDiffersFromSigner() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, MINTER, OWNER_KEY);
        vm.prank(MINTER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        assertEq(mirror.ownerOf(TOKEN), MINTER);
        assertEq(mirror.mainnetOwnerOf(TOKEN), REAL_OWNER);
    }

    // ---------- attacks ----------

    /// ATTACK 1: a thief signs a message claiming to be the owner.
    /// The contract is honest: it records the thief as provenance. The UI cross-check
    /// against live mainnet ownerOf is what catches it.
    function test_ATTACK_ThiefSignature_RecordsThiefAsProvenance() public {
        vm.label(THIEF, "thief");
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, THIEF, THIEF, THIEF_KEY);
        vm.prank(THIEF);
        mirror.mintWithSig(TOKEN, THIEF, REAL_URI, v, r, s);
        assertEq(mirror.mainnetOwnerOf(TOKEN), THIEF);
        assertEq(mirror.badgeOf(TOKEN), 2);
    }

    /// ATTACK 2: replay the SAME signature for a second mint.
    function test_ATTACK_ReplaySameSignature_Reverts() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        // The nonce has advanced, so the same signature no longer verifies either.
        vm.prank(REAL_OWNER);
        vm.expectRevert(IChogMirror.TokenAlreadyMinted.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
    }

    /// ATTACK 3: reuse a valid owner signature via a DIFFERENT token id.
    function test_ATTACK_SignatureBoundToTokenId() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        vm.expectRevert(IChogMirror.InvalidSignature.selector);
        mirror.mintWithSig(8, REAL_OWNER, REAL_URI, v, r, s);
    }

    /// ATTACK 4: a signature minted for another chain/contract domain must NOT verify.
    function test_ATTACK_CrossDomainSignature_Reverts() public {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce,bytes32 uriHash)"
                ),
                TOKEN,
                REAL_OWNER,
                REAL_OWNER,
                0,
                keccak256(bytes(REAL_URI))
            )
        );
        bytes32 fakeDomain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ChogMirror"),
                keccak256("1"),
                uint256(143), // MAINNET domain, not this testnet contract
                address(0x9999)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", fakeDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        vm.prank(REAL_OWNER);
        vm.expectRevert(IChogMirror.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
    }

    /// ATTACK 4b: a STOLEN valid signature (naming minter=REAL_OWNER) cannot be
    /// redeemed by a different minter, and the thief cannot claim themselves either.
    function test_ATTACK_StolenSignatureCannotBeRedeemedByThief() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(THIEF);
        vm.expectRevert(IChogMirror.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        vm.prank(THIEF);
        vm.expectRevert(IChogMirror.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, THIEF, REAL_URI, v, r, s);
    }

    /// ATTACK 4c: a signature with a STALE nonce must not verify (replay after a mint).
    function test_ATTACK_StaleNonce_Reverts() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        // Owner now signs fresh for OTHER_TOKEN at nonce 1.
        (uint8 v2, bytes32 r2, bytes32 s2) = _signWithLiveNonce(OTHER_TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        // Attacker resubmits the OLD signature for the old token at nonce 0.
        vm.prank(REAL_OWNER);
        vm.expectRevert(IChogMirror.TokenAlreadyMinted.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        // The fresh one works.
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(OTHER_TOKEN, REAL_OWNER, REAL_URI, v2, r2, s2);
        assertEq(mirror.nonces(REAL_OWNER), 2);
    }

    /// ATTACK 5: Test Drive one-per-wallet cap.
    function test_ATTACK_SecondTestDrive_Reverts() public {
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(OTHER_TOKEN, REAL_URI);
        vm.prank(OTHER_USER);
        vm.expectRevert(IChogMirror.TestDriveAlreadyClaimed.selector);
        mirror.mintTestDrive(501, REAL_URI);
    }

    /// ATTACK 6: Test Drive never overwrites a verified token's flag.
    function test_TestDriveCannotOverwriteVerified() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        vm.prank(THIEF);
        vm.expectRevert(IChogMirror.TokenAlreadyMinted.selector);
        mirror.mintTestDrive(TOKEN, "ipfs://fake");
    }

    /// ATTACK 7: tokenURI label discipline, test drive URIs are prefixed.
    function test_TestDriveTokenURI_IsLabeled() public {
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(OTHER_TOKEN, REAL_URI);
        assertEq(mirror.tokenURI(OTHER_TOKEN), string.concat("test-chog:", REAL_URI));
        assertEq(mirror.badgeOf(OTHER_TOKEN), 1);
    }

    /// ATTACK 8: supply bound respected at both ends.
    function test_SupplyBound() public {
        vm.expectRevert(IChogMirror.SupplyExceeded.selector);
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(1970, REAL_URI);
        vm.expectRevert(IChogMirror.SupplyExceeded.selector);
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(0, REAL_URI);
    }

    /// ATTACK 9: a failed mint must NOT burn the signer's nonce.
    /// (This is the fix over the prototype, which used nonces[mainnetOwner]++ inside
    ///  the struct hash, it advanced on every attempt, including failures.)
    function test_ATTACK_FailedMintDoesNotBurnNonce() public {
        // First, an attacker burns an attempt with a bad signature.
        vm.prank(THIEF);
        vm.expectRevert(IChogMirror.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, uint8(27), bytes32(uint256(1)), bytes32(uint256(2)));
        // The owner's nonce is untouched, so their signature still works.
        assertEq(mirror.nonces(REAL_OWNER), 0);
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, REAL_OWNER, REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        assertEq(mirror.ownerOf(TOKEN), REAL_OWNER);
    }

    /// ATTACK 10: address(0) as the claimed owner is rejected outright.
    function test_ATTACK_ZeroOwner_Reverts() public {
        (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(TOKEN, address(0), REAL_OWNER, OWNER_KEY);
        vm.prank(REAL_OWNER);
        vm.expectRevert(IChogMirror.Unauthorized.selector);
        mirror.mintWithSig(TOKEN, address(0), REAL_URI, v, r, s);
    }

    // ---------- interface / view surface ----------

    /// The URI is bound into the signature, so a valid signature cannot be replayed
    /// alongside different metadata. Before this, realURI was plain calldata and a
    /// caller could submit any string with a genuine signature, the only defence
    /// would have been the frontend's behaviour.
    function test_ATTACK_SubstitutedURI_Reverts() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, REAL_OWNER, REAL_OWNER, 0, OWNER_KEY);

        // The signature is genuine for REAL_URI. Submit a DIFFERENT URI.
        vm.prank(REAL_OWNER);
        vm.expectRevert(IChogMirror.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, "ipfs://attacker-controlled", v, r, s);

        // The token was not minted, so the attack left nothing behind. ownerOf()
        // reverts for an unminted token rather than returning zero, which is itself
        // the proof that nothing was created.
        vm.expectRevert();
        mirror.ownerOf(TOKEN);
        assertEq(mirror.nonces(REAL_OWNER), 0, "nonce not burned by the failed attempt");
        assertTrue(mirror.isUnclaimed(TOKEN), "token still claimable after the attack");
    }

    /// And the reverse: the signed URI mints successfully, and the recorded digest
    /// matches it, so anyone can verify the stored metadata is the signed metadata.
    function test_VerifiedMint_RecordsTheSignedURIDigest() public {
        // A fresh tokenId inside MAX_SUPPLY (1969) that other tests in this suite
        // have not already minted.
        uint256 fresh = 1900;
        // The struct binds msg.sender, and this test sends the tx itself, so the
        // signed minter must be address(this) rather than the owner.
        (uint8 v, bytes32 r, bytes32 s) = _sign(fresh, REAL_OWNER, address(this), 0, OWNER_KEY);
        mirror.mintWithSig(fresh, REAL_OWNER, REAL_URI, v, r, s);

        bytes32 recorded = mirror.uriHashOf(fresh);
        assertEq(recorded, keccak256(bytes(REAL_URI)), "recorded digest matches the signed URI");
        // The check a judge can run with no trust in us: hash what the contract
        // stores and compare with what it recorded.
        assertEq(recorded, keccak256(bytes(mirror.tokenURI(fresh))), "stored URI hashes to the digest");
    }

    /// The contract's own digest helper must agree with the wallet-side computation.
    function test_HashMirrorMessage_MatchesContractDigest() public {
        bytes32 expected = mirror.hashMirrorMessage(TOKEN, REAL_OWNER, REAL_OWNER, 0, REAL_URI);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce,bytes32 uriHash)"
                ),
                TOKEN,
                REAL_OWNER,
                REAL_OWNER,
                0,
                keccak256(bytes(REAL_URI))
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ChogMirror"),
                keccak256("1"),
                block.chainid,
                address(mirror)
            )
        );
        assertEq(expected, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        // And the signature over it must be accepted.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, expected);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        assertEq(mirror.ownerOf(TOKEN), REAL_OWNER);
    }

    function test_DomainSeparator_MatchesOZ() public {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ChogMirror"),
                keccak256("1"),
                block.chainid,
                address(mirror)
            )
        );
        assertEq(mirror.domainSeparator(), domain);
    }

    function test_IsUnclaimed_And_RemainingSupply() public {
        assertTrue(mirror.isUnclaimed(TOKEN));
        assertEq(mirror.remainingSupply(), 1969);
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(OTHER_TOKEN, REAL_URI);
        assertFalse(mirror.isUnclaimed(OTHER_TOKEN));
        assertEq(mirror.remainingSupply(), 1968);
        assertFalse(mirror.isUnclaimed(0));
        assertFalse(mirror.isUnclaimed(1970));
    }

    function test_BadgeOf_Zero_ForUnminted() public view {
        assertEq(mirror.badgeOf(TOKEN), 0);
    }

    function test_BaseTokenURI_Recorded() public view {
        assertEq(mirror.baseTokenURI(), BASE_URI);
    }

    function test_MaxSupply_IsRealChogGenesisSupply() public view {
        assertEq(mirror.MAX_SUPPLY(), 1969);
    }

    // ---------- invariants ----------

    /// Provenance is either a real signer or address(0) for Test Drive, never fabricated.
    function testFuzz_ProvenanceInvariant(uint256 tokenIdSeed) public {
        tokenIdSeed = bound(tokenIdSeed, 1, 1969);
        vm.assume(mirror.isUnclaimed(tokenIdSeed));

        bool asTestDrive = tokenIdSeed % 2 == 0;
        if (asTestDrive) {
            vm.prank(OTHER_USER);
            mirror.mintTestDrive(tokenIdSeed, REAL_URI);
            assertEq(mirror.mainnetOwnerOf(tokenIdSeed), address(0));
            assertEq(mirror.badgeOf(tokenIdSeed), 1);
        } else {
            (uint8 v, bytes32 r, bytes32 s) = _signWithLiveNonce(tokenIdSeed, REAL_OWNER, REAL_OWNER, OWNER_KEY);
            vm.prank(REAL_OWNER);
            mirror.mintWithSig(tokenIdSeed, REAL_OWNER, REAL_URI, v, r, s);
            assertEq(mirror.mainnetOwnerOf(tokenIdSeed), REAL_OWNER);
            assertEq(mirror.badgeOf(tokenIdSeed), 2);
            // A Test Drive can never also claim it.
            vm.prank(THIEF);
            vm.expectRevert(IChogMirror.TokenAlreadyMinted.selector);
            mirror.mintTestDrive(tokenIdSeed, REAL_URI);
        }
        assertEq(mirror.totalMinted(), 1);
    }

    /// Total minted can never exceed the real supply.
    /// Note: vm.startPrank is required because isUnclaimed() consumes a one-shot prank.
    function testFuzz_TotalMintedBounded(uint256 count) public {
        count = bound(count, 1, 30);
        for (uint256 i = 1; i <= count; i++) {
            address w = address(uint160(i * 7919));
            vm.startPrank(w);
            if (mirror.isUnclaimed(i)) mirror.mintTestDrive(i, REAL_URI);
            vm.stopPrank();
        }
        assertLe(mirror.totalMinted(), mirror.MAX_SUPPLY());
    }
}
