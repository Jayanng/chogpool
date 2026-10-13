// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogMirrorProto} from "../src/ChogMirrorProto.sol";
import {Vm} from "forge-std/Vm.sol";

/// @title Audit tests for the ChogMirror design.
/// Each test is an attack, not a demonstration: if any of these stop failing
/// the way they should, the design claim is broken.
contract ChogMirrorProtoTest is Test {
    ChogMirrorProto mirror;

    // Deterministic forge-generated identities (label -> address + private key).
    address REAL_OWNER; uint256 OWNER_KEY; // owns Chog #7 on "mainnet"
    address THIEF;      uint256 THIEF_KEY;
    address OTHER_USER;

    uint256 constant TOKEN = 7;
    string constant REAL_URI = "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json";

    function setUp() public {
        (REAL_OWNER, OWNER_KEY) = makeAddrAndKey("real_owner");
        (THIEF, THIEF_KEY) = makeAddrAndKey("thief");
        (OTHER_USER,) = makeAddrAndKey("other_user");
        mirror = new ChogMirrorProto(
            "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/",
            address(this)
        );
    }

    // ---------- helpers ----------

    function _sign(uint256 tokenId, address mainnetOwner, address minter, uint256 nonce, uint256 privKey)
        internal view returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce)"),
                tokenId,
                mainnetOwner,
                minter,
                nonce
            )
        );
        // Recompute the contract's EIP-712 domain (name "ChogMirror", version "1",
        // this chain, the deployed mirror address) — mirrors OZ EIP712 internals.
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
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );
        (v, r, s) = vm.sign(privKey, digest);
    }

    // Deterministic private keys are forge-generated in setUp.

    // ---------- the honest path ----------

    function test_VerifiedMint_RecordsProvenance() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, REAL_OWNER, REAL_OWNER, 0, OWNER_KEY);
        // The RECEIVER of the mint can be anyone (holder sends their Chog to the race;
        // e.g. a phone wallet signs, a browser wallet receives). Here: owner mints self.
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);

        assertEq(mirror.ownerOf(TOKEN), REAL_OWNER);
        assertEq(mirror.mainnetOwnerOf(TOKEN), REAL_OWNER);
        assertEq(mirror.badgeOf(TOKEN), 2); // Verified Holder
        assertEq(mirror.tokenURI(TOKEN), REAL_URI);
    }

    // ---------- attacks ----------

    /// ATTACK 1: a thief signs a message claiming to be the owner.
    /// Expected: the thief CAN mint (the contract records THEM as provenance).
    /// This documents the honest boundary: on-chain sig == provenance, not mainnet
    /// ownership. The UI must cross-check live mainnet ownerOf. If this test ever
    /// shows mainnetOwnerOf != signer, the design is lying.
    function test_ATTACK_ThiefSignature_RecordsThiefAsProvenance() public {
        vm.label(THIEF, "thief");
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, THIEF, THIEF, 0, THIEF_KEY);
        vm.prank(THIEF);
        mirror.mintWithSig(TOKEN, THIEF, REAL_URI, v, r, s);
        // The contract is honest: it recorded the thief, not a fabricated owner.
        assertEq(mirror.mainnetOwnerOf(TOKEN), THIEF);
        // The badge shows Verified-signer, and the UI cross-check will catch it.
        // (The UI layer re-reads mainnet ownerOf(7) == THIEF? No => badge downgraded
        //  to "signature only" and no Verified Holder UI.)
    }

    /// ATTACK 2: replay the SAME signature for a second mint.
    function test_ATTACK_ReplaySameSignature_Reverts() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, REAL_OWNER, REAL_OWNER, 0, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        // replay
        vm.prank(REAL_OWNER);
        vm.expectRevert(ChogMirrorProto.TokenAlreadyMinted.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
    }

    /// ATTACK 3: reuse a valid owner signature via a DIFFERENT token id.
    /// Signature binds tokenId, so forging requires a new signature.
    function test_ATTACK_SignatureBoundToTokenId() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, REAL_OWNER, REAL_OWNER, 0, OWNER_KEY);
        // Try to use it for token 8 (someone else's Chog): claimed owner is still
        // REAL_OWNER but the digest signed was for token 7 -> recovered != claimed.
        vm.prank(REAL_OWNER);
        vm.expectRevert(ChogMirrorProto.InvalidSignature.selector);
        mirror.mintWithSig(8, REAL_OWNER, REAL_URI, v, r, s);
    }

    /// ATTACK 4: signature from a DIFFERENT chain/contract domain (e.g. signed for
    /// a mainnet deployment of a lookalike contract) must NOT verify here.
    /// The EIP-712 domain includes this contract's address and testnet chainId,
    /// so a signature minted for another domain fails.
    /// ATTACK 4b: a STOLEN valid signature (owner signed minter=REAL_OWNER) cannot
    /// be redeemed by a different minter: the digest names the minter, so recovering
    /// under thief-as-minter yields garbage != claimed owner -> revert.
    function test_ATTACK_StolenSignatureCannotBeRedeemedByThief() public {
        // Owner signs a message authorizing REAL_OWNER as the minter.
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, REAL_OWNER, REAL_OWNER, 0, OWNER_KEY);
        // Thief intercepts the signature and tries to mint for THEMSELVES.
        vm.prank(THIEF);
        vm.expectRevert(ChogMirrorProto.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        // And when the thief claims THEMSELVES as owner, still garbage recovery:
        vm.prank(THIEF);
        vm.expectRevert(ChogMirrorProto.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, THIEF, REAL_URI, v, r, s);
    }
    function test_ATTACK_CrossDomainSignature_Reverts() public {
        // Build a digest with the CORRECT message but a DIFFERENT domain separator
        // (a lookalike contract on mainnet chainId 143).
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce)"),
                TOKEN,
                REAL_OWNER,
                REAL_OWNER,
                0
            )
        );
        bytes32 fakeDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ChogMirror"),
                keccak256("1"),
                uint256(143), // MAINNET domain, not this testnet contract
                address(0x9999)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", fakeDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        vm.prank(REAL_OWNER);
        vm.expectRevert(ChogMirrorProto.InvalidSignature.selector);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
    }

    /// ATTACK 5: Test Drive one-per-wallet cap.
    function test_ATTACK_SecondTestDrive_Reverts() public {
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(500, REAL_URI);
        vm.prank(OTHER_USER);
        vm.expectRevert(ChogMirrorProto.TestDriveAlreadyClaimed.selector);
        mirror.mintTestDrive(501, REAL_URI);
    }

    /// ATTACK 6: a wallet with a Test Drive cannot mint a Verified token using the
    /// test-drive label mechanics... rather: verified + testdrive can coexist per
    /// wallet (they are different tokens). Assert Test Drive never overwrites a
    /// verified token's flag.
    function test_TestDriveCannotOverwriteVerified() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(TOKEN, REAL_OWNER, REAL_OWNER, 0, OWNER_KEY);
        vm.prank(REAL_OWNER);
        mirror.mintWithSig(TOKEN, REAL_OWNER, REAL_URI, v, r, s);
        // Thief tries to test-drive onto the SAME tokenId.
        vm.prank(THIEF);
        vm.expectRevert(ChogMirrorProto.TokenAlreadyMinted.selector);
        mirror.mintTestDrive(TOKEN, "ipfs://fake");
    }

    /// ATTACK 7: tokenURI label discipline — test drive URIs are prefixed.
    function test_TestDriveTokenURI_IsLabeled() public {
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(500, REAL_URI);
        string memory uri = mirror.tokenURI(500);
        // "test-chog:" prefix present
        assertEq(uri, string.concat("test-chog:", REAL_URI));
        assertEq(mirror.badgeOf(500), 1);
    }

    /// ATTACK 8: supply bound respected.
    function test_SupplyBound() public {
        vm.expectRevert(ChogMirrorProto.SupplyExceeded.selector);
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(1970, REAL_URI);
        vm.expectRevert(ChogMirrorProto.SupplyExceeded.selector);
        vm.prank(OTHER_USER);
        mirror.mintTestDrive(0, REAL_URI);
    }
}
