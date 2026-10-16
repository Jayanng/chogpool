// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ChogMirror, testnet mirror of Chog Genesis (mainnet) with verified
///        holder minting and Test Drive mode.
/// @notice AUDIT PROTOTYPE for the IChogMirror spec. The production
///         version lives in ChogMirror; this validates the design claims:
///         1) EIP-712 signature from the real mainnet owner mints a Verified mirror
///         2) mintTestDrive: one per wallet, on-chain flag, labeled
///         3) replay protection (chainId + contract address + nonce in the domain/seed)
/// @dev Security notes for the production implementation are inline and in the test file.
contract ChogMirrorProto is ERC721, EIP712, Ownable {
    // --- constants ---
    uint256 public constant MAX_SUPPLY = 1969; // real Chog Genesis supply (verified)

    // --- verified-holder state ---
    /// @dev mainnetOwnerOf[tokenId] = the address that signed the ownership proof.
    ///      Written ONLY on successful mintWithSig. The UI reads this to show
    ///      "Verified Holder", it is the on-chain provenance record.
    mapping(uint256 => address) public mainnetOwnerOf;
    /// @dev signature nonces per signer: each signed message can mint exactly once.
    mapping(address => uint256) public nonces;
    /// @dev tokenId => true if minted via Test Drive (no ownership proof).
    mapping(uint256 => bool) public isTestDrive;
    /// @dev one Test Drive per wallet.
    mapping(address => bool) public hasTestDrive;
    /// @dev real mainnet tokenURI, stored at mint (fetched off-chain via viem).
    mapping(uint256 => string) private _realURIs;

    uint256 public totalMinted;
    string private _baseTokenURI; // ipfs://bafybeid.../ (verified base URI)

    bytes32 private constant MIRROR_TYPEHASH =
        keccak256("Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce)");

    event MirrorMinted(address indexed mainnetOwner, uint256 indexed tokenId, string realURI, bool testDrive);

    error Unauthorized();
    error InvalidSignature();
    error TokenAlreadyMinted();
    error SupplyExceeded();
    error TestDriveAlreadyClaimed();
    error TestDriveForbiddenForVerifiedToken();

    constructor(string memory baseURI, address initialOwner)
        ERC721("Chog Track Mirror", "CTM")
        EIP712("ChogMirror", "1")
        Ownable(initialOwner)
    {
        _baseTokenURI = baseURI;
    }

    // ---------------- Verified Holder path ----------------

    /// @notice Mint a Verified mirror of a REAL Chog the signer owns on mainnet.
    /// @param tokenId        real Chog Genesis tokenId (1..1969)
    /// @param mainnetOwner   the claimed mainnet owner: MUST equal the recovered signer
    /// @param realURI        the token's real mainnet IPFS URI (resolved off-chain; stored verbatim)
    /// @param v,r,s          EIP-712 signature of the Mirror message by the MAINNET owner.
    ///
    /// SECURITY MODEL (audit-verified 2026-10-14, fixes the unbound-recovered-signer bug):
    /// - The signed message binds (tokenId, mainnetOwner, minter, nonce) under an
    ///   EIP-712 domain that includes THIS contract's address and THIS chain (testnet 10143).
    /// - `require(recovered == mainnetOwner)`: a signature recovered under the WRONG
    ///   digest (wrong token, wrong domain, wrong minter) yields a garbage address
    ///   that will NOT match the claimed owner → InvalidSignature. This closes:
    ///     * cross-token replay (sig for #7 used at #8)
    ///     * cross-domain replay (sig made for a mainnet lookalike contract)
    ///     * garbage-provenance mints (mainnetOwnerOf only ever records a real signer)
    /// - The message names `minter` (the wallet that sends the tx and receives the
    ///   mirror): a phone wallet can sign while the browser wallet mints, and a
    ///   stolen signature naming minter=X cannot be redeemed by anyone but X.
    /// - Cross-chain soundness (honest boundary): the contract CANNOT verify the
    ///   signer still owns the Chog on mainnet at mint time; it records provenance
    ///   (who signed). The UI MUST re-check live mainnet ownerOf(tokenId) == mainnetOwnerOf[tokenId]
    ///   before showing the "Verified Holder" badge (off-chain read, free). The mirror
    ///   never claims on-chain what it cannot prove on-chain.
    /// - Replay: nonce (per mainnetOwner) + tokenId uniqueness; each valid message mints once.
    function mintWithSig(
        uint256 tokenId,
        address mainnetOwner,
        string calldata realURI,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert SupplyExceeded();
        if (_ownerOf(tokenId) != address(0)) revert TokenAlreadyMinted();

        bytes32 structHash = keccak256(
            abi.encode(MIRROR_TYPEHASH, tokenId, mainnetOwner, msg.sender, nonces[mainnetOwner]++)
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (recovered != mainnetOwner) revert InvalidSignature();

        mainnetOwnerOf[tokenId] = recovered;
        isTestDrive[tokenId] = false;

        _realURIs[tokenId] = realURI;
        _mint(msg.sender, tokenId);
        totalMinted++;

        emit MirrorMinted(recovered, tokenId, realURI, false);
    }

    // ---------------- Test Drive path ----------------

    /// @notice Anyone can claim ONE Test Drive Chog (clearly labeled, testnet-only).
    /// @param tokenId an unclaimed real tokenId (1..1969), real metadata, no proof.
    /// @param realURI the token's real mainnet IPFS URI.
    function mintTestDrive(uint256 tokenId, string calldata realURI) external {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert SupplyExceeded();
        if (_ownerOf(tokenId) != address(0)) revert TokenAlreadyMinted();
        if (hasTestDrive[msg.sender]) revert TestDriveAlreadyClaimed();

        hasTestDrive[msg.sender] = true;
        isTestDrive[tokenId] = true;
        mainnetOwnerOf[tokenId] = address(0); // explicit: no provenance claim

        _realURIs[tokenId] = realURI;
        _mint(msg.sender, tokenId);
        totalMinted++;

        emit MirrorMinted(address(0), tokenId, realURI, true);
    }

    // ---------------- views ----------------

    /// @notice tokenURI returns the REAL mainnet URI for verified tokens, and a
    ///         "Test Chog"-prefixed URI for Test Drive tokens (label discipline).
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (isTestDrive[tokenId]) {
            return string.concat("test-chog:", _realURIs[tokenId]);
        }
        return _realURIs[tokenId];
    }

    /// @notice Badge source for the UI: 2 = Verified Holder, 1 = Test Drive, 0 = none.
    function badgeOf(uint256 tokenId) external view returns (uint8) {
        if (_ownerOf(tokenId) == address(0)) return 0;
        return isTestDrive[tokenId] ? uint8(1) : uint8(2);
    }

    function _hashMirror(uint256 tokenId, address mainnetOwner, uint256 nonce)
        internal view returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(MIRROR_TYPEHASH, tokenId, mainnetOwner, nonce))
        );
    }
}
