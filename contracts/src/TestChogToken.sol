// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITestChogToken} from "../interfaces/ITestChogToken.sol";

/// @title TestChogToken: "Test CHOG", the play-money token for the fun layers.
/// @notice Production implementation of the FROZEN ITestChogToken interface.
///
/// This token exists for cheering tips, draft rerolls and side prizes. It is
/// explicitly labelled "Test CHOG" in name AND symbol so it can
/// never be mistaken for the real mainnet $CHOG at `0x3500...7777`. The frontend
/// shows it next to the user's real balance with both labels visible.
///
/// The faucet is capped at `claimAmount` per address per `claimCooldown` so a
/// single wallet cannot farm an unbounded supply, which is what keeps the side
/// prizes meaningful.
contract TestChogToken is ITestChogToken, ERC20, Ownable {
    /// @inheritdoc ITestChogToken
    uint256 public claimAmount;

    /// @inheritdoc ITestChogToken
    uint64 public claimCooldown;

    /// @dev account => timestamp of their last successful claim.
    mapping(address => uint256) private _lastClaimAt;

    /// @notice The label the UI must show everywhere this token appears.
    string public constant override testLabel = "Test CHOG";

    /// @dev Declared here rather than in the frozen ITestChogToken, because adding an
    ///      error to a frozen interface needs both owners' approval.
    error ZeroAmount();

    event ClaimAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event ClaimCooldownUpdated(uint64 oldCooldown, uint64 newCooldown);

    constructor(address owner_, uint256 claimAmount_, uint64 claimCooldown_) ERC20("Test CHOG", "Test CHOG") Ownable(owner_) {
        if (claimAmount_ == 0) revert ZeroAmount();
        claimAmount = claimAmount_;
        claimCooldown = claimCooldown_;
        emit ClaimAmountUpdated(0, claimAmount_);
        emit ClaimCooldownUpdated(0, claimCooldown_);
    }

    /// @inheritdoc ITestChogToken
    /// @dev The single source of truth for "when can this address claim again".
    ///      `claim()` uses the same helper, so the UI's countdown and the contract's
    ///      guard can never disagree, which is what happens when the cooldown is
    ///      changed between a claim and the next attempt.
    function nextClaimAt(address account) public view returns (uint64) {
        uint256 last = _lastClaimAt[account];
        if (last == 0) return 0;
        uint256 next = last + claimCooldown;
        if (next <= block.timestamp) return 0;
        return uint64(next);
    }

    /// @inheritdoc ITestChogToken
    function claim() external {
        uint64 next = nextClaimAt(msg.sender);
        if (next != 0) revert CooldownActive(next);

        _lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, claimAmount);

        emit Claimed(msg.sender, claimAmount, uint64(block.timestamp + claimCooldown));
    }

    // ---------------- admin ----------------

    function setClaimAmount(uint256 newAmount) external onlyOwner {
        if (newAmount == 0) revert ZeroAmount();
        emit ClaimAmountUpdated(claimAmount, newAmount);
        claimAmount = newAmount;
    }

    function setClaimCooldown(uint64 newCooldown) external onlyOwner {
        emit ClaimCooldownUpdated(claimCooldown, newCooldown);
        claimCooldown = newCooldown;
    }

    /// @notice Burn from an account. Lets the side-prize sinks retire tokens.
    function burnFrom(address account, uint256 amount) external onlyOwner {
        _burn(account, amount);
    }
}
