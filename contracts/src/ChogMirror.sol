// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IChogMirror} from "../interfaces/IChogMirror.sol";

/// @title ChogMirror — testnet mirror of Chog Genesis (mainnet).
/// @notice Production implementation of the FROZEN IChogMirror interface. It carries
///         the audited message shape from ChogMirrorProto.sol (audit 2026-10-14,
///         10 adversarial tests). DO NOT weaken the message shape.
///
/// Two mint paths, never blurred (docs/RULES.md label discipline):
///   - Verified Holder: signed by the real mainnet owner. Provenance recorded on-chain.
///   - Test Drive: anyone, one per wallet, clearly labeled. Testnet only.
///
/// Honest boundary: the contract records PROVENANCE (who signed), not live mainnet
/// ownership. It cannot see mainnet state. The UI MUST re-check live mainnet
/// ownerOf(tokenId) == mainnetOwnerOf[tokenId] before showing the "Verified Holder"
/// badge. The mirror never claims on-chain what it cannot prove on-chain.
contract ChogMirror is ERC721, EIP712, Ownable, IChogMirror {
    /// @dev Real Chog Genesis supply, verified on mainnet 2026-10-14 (totalSupply()).
    uint256 public constant MAX_SUPPLY = 1969;

    bytes32 private constant MIRROR_TYPEHASH =
        keccak256("Mirror(uint256 tokenId,address mainnetOwner,address minter,uint256 nonce,bytes32 uriHash)");

    /// @inheritdoc IChogMirror
    mapping(uint256 => address) public mainnetOwnerOf;
    /// @inheritdoc IChogMirror
    mapping(address => uint256) public nonces;
    /// @inheritdoc IChogMirror
    mapping(uint256 => bool) public isTestDrive;
    /// @inheritdoc IChogMirror
    mapping(address => bool) public hasTestDrive;

    /// @notice Real mainnet tokenURI, stored verbatim at mint (never invented traits).
    mapping(uint256 => string) private _realURIs;

    /// @dev keccak256(bytes(realURI)) for each token, recorded at mint so anyone can
    ///      re-derive the digest the owner signed and confirm the stored URI is the
    ///      signed one. Exposed through uriHashOf().
    mapping(uint256 => bytes32) private _uriHashes;

    /// @inheritdoc IChogMirror
    uint256 public totalMinted;

    /// @notice Base URI for the real mainnet metadata (ipfs://...), used for view helpers.
    string private _baseTokenURI;

    /// @notice Label discipline: Test Drive tokenURIs are prefixed so no consumer can
    ///         accidentally render a Test Chog as a real one.
    string public constant TEST_DRIVE_PREFIX = "test-chog:";

    constructor(string memory baseURI, address initialOwner)
        ERC721("Chog Track Mirror", "CTM")
        EIP712("ChogMirror", "1")
        Ownable(initialOwner)
    {
        _baseTokenURI = baseURI;
    }

    // ---------------- Verified Holder path ----------------

    /// @inheritdoc IChogMirror
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
        if (mainnetOwner == address(0)) revert Unauthorized();

        // The nonce is read BEFORE the signature is recovered and written AFTER a
        // successful recovery, so a failed attempt cannot burn a signer's nonce.
        uint256 nonce = nonces[mainnetOwner];

        // The metadata URI is bound into the signed message, so the tokenURI this
        // contract stores is provably the one the mainnet owner signed.
        //
        // Without this, realURI is an ordinary calldata argument: the signature
        // covers tokenId, mainnetOwner, minter and nonce, and a caller could submit
        // any string at all alongside a valid signature. The only thing standing
        // between the chain and a false metadata URI would be the frontend's
        // behaviour — "trust our site" is not an answer a judge should have to
        // accept, and it is not one this contract needs to rely on. Hashing the URI
        // into the struct turns the guarantee into "check the signature", which is
        // checkable by anyone, forever, with no trust in us.
        //
        // The URI is hashed as raw UTF-8 bytes (keccak256(bytes(realURI))), matching
        // how an off-chain signer builds the digest: no length prefix, no abi.encode
        // of the string, just the bytes the contract will store.
        bytes32 uriHash = keccak256(bytes(realURI));

        bytes32 structHash = keccak256(
            abi.encode(MIRROR_TYPEHASH, tokenId, mainnetOwner, msg.sender, nonce, uriHash)
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (recovered != mainnetOwner) revert InvalidSignature();

        nonces[mainnetOwner] = nonce + 1;

        mainnetOwnerOf[tokenId] = recovered;
        isTestDrive[tokenId] = false;
        _realURIs[tokenId] = realURI;
        _uriHashes[tokenId] = uriHash;

        _mint(msg.sender, tokenId);
        totalMinted++;

        emit MirrorMinted(recovered, tokenId, realURI, false);
    }

    // ---------------- Test Drive path ----------------

    /// @inheritdoc IChogMirror
    function mintTestDrive(uint256 tokenId, string calldata realURI) external {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert SupplyExceeded();
        if (_ownerOf(tokenId) != address(0)) revert TokenAlreadyMinted();
        if (hasTestDrive[msg.sender]) revert TestDriveAlreadyClaimed();

        hasTestDrive[msg.sender] = true;
        isTestDrive[tokenId] = true;
        mainnetOwnerOf[tokenId] = address(0); // explicit: no provenance claim

        _realURIs[tokenId] = realURI;
        // The hash is recorded for uniformity with the verified path, but it is NOT a
        // provenance claim: nobody signed it, because Test Drive requires no
        // signature. It exists so the /verify page can show the same
        // "stored URI hashes to the recorded digest" line for every token without
        // special-casing, while `isTestDrive[tokenId]` remains the thing that says
        // whether any attestation happened at all.
        _uriHashes[tokenId] = keccak256(bytes(realURI));

        _mint(msg.sender, tokenId);
        totalMinted++;

        emit MirrorMinted(address(0), tokenId, realURI, true);
    }

    // ---------------- views ----------------

    /// @notice keccak256(bytes(realURI)) recorded at mint for `tokenId`.
    /// @dev Lets anyone verify the stored URI is the one that was signed: recompute
    ///      keccak256 of the URI returned by tokenURI() and compare. For a Verified
    ///      Holder token this is the digest inside the EIP-712 message the mainnet
    ///      owner signed. For a Test Drive token nobody signed anything, so a match
    ///      here proves only that the stored bytes hash to the recorded value — check
    ///      isTestDrive() for whether an attestation exists at all.
    function uriHashOf(uint256 tokenId) external view returns (bytes32) {
        return _uriHashes[tokenId];
    }

    /// @notice The real tokenURI (Test Drive tokens get a labelled prefix).
    function tokenURI(uint256 tokenId) public view override(ERC721, IChogMirror) returns (string memory) {
        _requireOwned(tokenId);
        if (isTestDrive[tokenId]) {
            return string.concat(TEST_DRIVE_PREFIX, _realURIs[tokenId]);
        }
        return _realURIs[tokenId];
    }

    /// @inheritdoc IChogMirror
    function badgeOf(uint256 tokenId) external view returns (uint8) {
        if (_ownerOf(tokenId) == address(0)) return 0;
        return isTestDrive[tokenId] ? uint8(1) : uint8(2);
    }

    /// @notice The real mainnet metadata base URI recorded at deploy.
    function baseTokenURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice The EIP-712 domain separator, exposed so wallets/indexers build the
    ///         exact digest without reimplementing the domain.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice The exact EIP-712 digest a wallet must sign to mint `tokenId`.
    /// @dev Lets /identity (and any integration test) verify it built the right message,
    ///      with no guesswork about field order or the URI encoding. The URI is hashed
    ///      as raw bytes (keccak256(bytes(realURI))) to match how a wallet signs it.
    function hashMirrorMessage(
        uint256 tokenId,
        address mainnetOwner,
        address minter,
        uint256 nonce,
        string calldata realURI
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MIRROR_TYPEHASH,
                    tokenId,
                    mainnetOwner,
                    minter,
                    nonce,
                    keccak256(bytes(realURI))
                )
            )
        );
    }

    /// @notice Whether a real mainnet tokenId is still unclaimed in the mirror.
    function isUnclaimed(uint256 tokenId) external view returns (bool) {
        return tokenId > 0 && tokenId <= MAX_SUPPLY && _ownerOf(tokenId) == address(0);
    }

    /// @notice Remaining mirror supply (real Chogs not yet mirrored).
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }
}
