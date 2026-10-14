// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IChogMirror — frozen contract between contracts/ and web/ (2026-10-14).
/// @notice FROZEN INTERFACE. Changing anything in this file requires BOTH owners
///         to approve (docs/WORKING-AGREEMENT.md: "the interfaces folder is law").
///
/// This interface is the audited shape from contracts/src/ChogMirrorProto.sol
/// (audit 2026-10-14, 10 adversarial tests all passing). The EIP-712 message shape
/// MUST NOT be weakened: it binds (tokenId, mainnetOwner, minter, nonce) under a
/// domain containing this contract and the testnet chainId.
///
/// ⚠️ CONTRADICTION RESOLVED HERE: PLAN.md Phase 1 item 1 and the audited prototype
/// specify EIP-712, but PLAN.md's Phase 4 build prompt asked for EIP-191 over
/// keccak("CHOGPOOL-MIRROR:" + tokenId). That EIP-191 shape does NOT bind tokenId or
/// minter, which re-opens cross-token replay and stolen-signature redemption. The
/// EIP-712 shape below is the one that is implemented and audited, so EIP-712 is
/// what we build. Any EIP-191 wording in PLAN.md Phase 4 is superseded by this file.
interface IChogMirror {
    // ---------- events ----------

    /// @param mainnetOwner the address that signed the ownership proof (provenance).
    ///                     address(0) for Test Drive mints (no provenance claimed).
    /// @param realURI      the REAL mainnet IPFS URI, stored verbatim at mint.
    event MirrorMinted(address indexed mainnetOwner, uint256 indexed tokenId, string realURI, bool testDrive);

    // ---------- errors ----------

    error Unauthorized();
    error InvalidSignature();
    error TokenAlreadyMinted();
    error SupplyExceeded();
    error TestDriveAlreadyClaimed();
    error TestDriveForbiddenForVerifiedToken();

    // ---------- verified holder path ----------

    /// @notice Mint a Verified mirror of a REAL Chog the signer owns on mainnet.
    /// @dev The signed EIP-712 message is:
    ///        Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce)
    ///      under domain (name "ChogMirror", version "1", this chain, this contract).
    ///      The contract requires recovered == mainnetOwner.
    /// @param tokenId      real Chog Genesis tokenId (1..MAX_SUPPLY)
    /// @param mainnetOwner the claimed mainnet owner; MUST equal the recovered signer
    /// @param realURI      the token's real mainnet IPFS URI (resolved off-chain)
    /// @param v,r,s        EIP-712 signature by the MAINNET owner
    function mintWithSig(
        uint256 tokenId,
        address mainnetOwner,
        string calldata realURI,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    // ---------- test drive path ----------

    /// @notice Anyone can claim ONE Test Drive Chog (clearly labeled, testnet only).
    /// @param tokenId an unclaimed real tokenId (1..MAX_SUPPLY) — real metadata, no proof
    /// @param realURI the token's real mainnet IPFS URI
    function mintTestDrive(uint256 tokenId, string calldata realURI) external;

    // ---------- views ----------

    /// @notice Real Chog Genesis supply cap (1,969, verified on mainnet 2026-10-14).
    function MAX_SUPPLY() external view returns (uint256);

    /// @notice Who signed the ownership proof for tokenId; address(0) if unminted or Test Drive.
    function mainnetOwnerOf(uint256 tokenId) external view returns (address);

    /// @notice tokenId => true if minted via Test Drive (no ownership proof).
    function isTestDrive(uint256 tokenId) external view returns (bool);

    /// @notice One Test Drive per wallet: has this address already claimed one?
    function hasTestDrive(address account) external view returns (bool);

    /// @notice Signature nonce for a signer. The UI MUST read this and use it in the
    ///         message it asks the wallet to sign, or the signature will not verify.
    function nonces(address account) external view returns (uint256);

    function totalMinted() external view returns (uint256);

    /// @notice REAL mainnet URI for verified tokens; "test-chog:"-prefixed for Test Drive.
    function tokenURI(uint256 tokenId) external view returns (string memory);

    /// @notice Badge source for the UI: 2 = Verified Holder, 1 = Test Drive, 0 = none.
    /// @dev PROVENANCE ONLY. The UI must also cross-check live mainnet
    ///      ownerOf(tokenId) == mainnetOwnerOf[tokenId] before showing "Verified Holder";
    ///      the contract cannot see mainnet state. See docs/RULES.md label discipline.
    function badgeOf(uint256 tokenId) external view returns (uint8);
}
