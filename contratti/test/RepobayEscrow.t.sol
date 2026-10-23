// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RepobayEscrow} from "../src/RepobayEscrow.sol";

// Foundry cheatcodes without forge-std (nothing to download): the Vm lives at a fixed address.
interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function deal(address, uint256) external;
    function expectRevert(bytes4) external;
    function assume(bool) external pure;
}

contract Token {   // a plain ERC-20; `quiet` makes it return nothing from transfer/transferFrom, like USDT on Ethereum
    bool public quiet;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    constructor(bool quiet_) { quiet = quiet_; }
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function block_(address who, bool b) external { blocked[who] = b; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }

    function transfer(address to, uint256 a) external returns (bool) {
        require(!blocked[to], "blocked");
        balanceOf[msg.sender] -= a; balanceOf[to] += a;
        if (quiet) assembly { return(0, 0) }
        return true;
    }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a;
        if (quiet) assembly { return(0, 0) }
        return true;
    }
}

contract Refuser {   // a payee that cannot receive the native coin
    receive() external payable { revert("no"); }
}

contract Reenterer {   // a payee that tries to call back into the escrow while being paid
    RepobayEscrow e; bytes32 key; address[] p; uint256[] a;
    function arm(RepobayEscrow e_, bytes32 key_, address[] memory p_, uint256[] memory a_) external { e = e_; key = key_; p = p_; a = a_; }
    receive() external payable { e.release(key, p, a); }
}

contract RepobayEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 constant HOLD = 14 days;
    uint64 constant WINDOW = 60 days;

    RepobayEscrow e;
    Token usdc; Token usdt;
    address arbiter = address(0xA1);
    address buyer = address(0xB1);
    address builder = address(0xC1);
    address installer = address(0xC2);
    address platform = address(0xC3);
    address[] payees; uint256[] amounts;
    bytes32 constant ID = keccak256("ordine:prova");
    bytes32 KEY;
    uint64 deadline;

    function setUp() public {
        e = new RepobayEscrow(arbiter, HOLD, WINDOW);
        usdc = new Token(false); usdt = new Token(true);
        payees.push(builder); payees.push(installer); payees.push(platform);
        setAmounts(600e6, 390e6, 10e6);
        KEY = e.keyOf(buyer, ID);
        deadline = uint64(block.timestamp + 30 minutes);
        vm.deal(buyer, 100 ether);
        usdc.mint(buyer, 1_000_000e6); usdt.mint(buyer, 1_000_000e6);
        vm.startPrank(buyer); usdc.approve(address(e), type(uint256).max); usdt.approve(address(e), type(uint256).max); vm.stopPrank();
    }

    function setAmounts(uint256 a0, uint256 a1, uint256 a2) internal { delete amounts; amounts.push(a0); amounts.push(a1); amounts.push(a2); }
    function total() internal view returns (uint256 s) { for (uint256 i; i < amounts.length; i++) s += amounts[i]; }
    function state(bytes32 key) internal view returns (uint8 s) { (,,,,, s,,) = e.orders(key); }
    function depositToken(Token tk) internal { vm.prank(buyer); e.deposit(ID, address(tk), total(), deadline, payees, amounts); }
    function depositNative() internal { vm.prank(buyer); e.deposit{value: total()}(ID, address(0), total(), deadline, payees, amounts); }

    // ---------------------------------------------------------------- deployment

    function test_constructorRefusesAbsurdPeriods() public {
        vm.expectRevert(RepobayEscrow.BadAmount.selector); new RepobayEscrow(address(0), HOLD, WINDOW);
        vm.expectRevert(RepobayEscrow.BadAmount.selector); new RepobayEscrow(arbiter, 0, WINDOW);
        vm.expectRevert(RepobayEscrow.BadAmount.selector); new RepobayEscrow(arbiter, 1_209_600_000, WINDOW);   // 14 days written in milliseconds
        vm.expectRevert(RepobayEscrow.BadAmount.selector); new RepobayEscrow(arbiter, HOLD, 366 days);
    }

    // ---------------------------------------------------------------- deposit

    function test_depositTokenLocksTotalAndSplit() public {
        vm.prank(buyer);
        bytes32 key = e.deposit(ID, address(usdc), total(), deadline, payees, amounts);
        assert(key == KEY && key == keccak256(abi.encode(buyer, ID)));
        (address payer, address token, uint256 tot, uint64 unlockAt,, uint8 st, bytes32 split,) = e.orders(KEY);
        assert(payer == buyer && token == address(usdc) && tot == total() && st == e.HELD());
        assert(unlockAt == uint64(block.timestamp) + HOLD);
        assert(split == keccak256(abi.encode(payees, amounts)));
        assert(usdc.balanceOf(address(e)) == total());
    }

    function test_depositQuietTokenWorks() public { depositToken(usdt); assert(usdt.balanceOf(address(e)) == total()); }

    function test_depositNativeNeedsExactValue() public {
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadAmount.selector);
        e.deposit{value: total() - 1}(ID, address(0), total(), deadline, payees, amounts);
        depositNative(); assert(address(e).balance == total());
    }

    function test_depositRejectsBadSplits() public {
        uint256[] memory wrong = amounts; wrong[0] += 1;
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadSplit.selector); e.deposit(ID, address(usdc), total(), deadline, payees, wrong);
        address[] memory zero = payees; zero[1] = address(0);
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadSplit.selector); e.deposit(ID, address(usdc), total(), deadline, zero, amounts);
        depositToken(usdc);
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.AlreadyExists.selector); e.deposit(ID, address(usdc), total(), deadline, payees, amounts);
    }

    function test_depositTokenRefusesValue() public {
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadAmount.selector);
        e.deposit{value: 1}(ID, address(usdc), total(), deadline, payees, amounts);
    }

    function test_depositRefusesAddressWithoutCode() public {
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.TransferFailed.selector);
        e.deposit(ID, address(0xBEEF), total(), deadline, payees, amounts);
    }

    /// The shop's price has a deadline: a late payment is refused by the contract instead of being stuck in it.
    function test_depositAfterDeadlineIsRefused() public {
        vm.warp(uint256(deadline) + 1);
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.TooLate.selector);
        e.deposit(ID, address(usdc), total(), deadline, payees, amounts);
        assert(usdc.balanceOf(address(e)) == 0);
    }

    /// Front-running: someone copies the id from the buyer's pending transaction and deposits first, with a split of
    /// their own. Orders are filed per payer, so the buyer's deposit still goes through, untouched.
    function test_copiedIdCannotBlockTheBuyer() public {
        address attacker = address(0xBAD);
        address[] memory theirs = new address[](1); theirs[0] = attacker;
        uint256[] memory one = new uint256[](1); one[0] = 1;
        vm.deal(attacker, 1 ether);
        vm.prank(attacker); bytes32 squatted = e.deposit{value: 1}(ID, address(0), 1, deadline, theirs, one);
        assert(squatted != KEY);
        depositToken(usdc);
        assert(state(KEY) == e.HELD() && usdc.balanceOf(address(e)) == total());
        (address payer,,,,,,,) = e.orders(KEY);
        assert(payer == buyer);
    }

    // ---------------------------------------------------------------- confirm / release

    function test_confirmPaysEveryoneOnlyByPayer() public {
        depositToken(usdc);
        vm.prank(builder); vm.expectRevert(RepobayEscrow.NotPayer.selector); e.confirm(KEY, payees, amounts);
        uint256[] memory wrong = amounts; wrong[0] -= 1; wrong[1] += 1;
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadSplit.selector); e.confirm(KEY, payees, wrong);
        vm.prank(buyer); e.confirm(KEY, payees, amounts);
        assert(usdc.balanceOf(builder) == 600e6 && usdc.balanceOf(installer) == 390e6 && usdc.balanceOf(platform) == 10e6);
        assert(usdc.balanceOf(address(e)) == 0 && state(KEY) == e.CONFIRMED());
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadState.selector); e.confirm(KEY, payees, amounts);
    }

    function test_releaseOnlyAfterHoldByAnyone() public {
        depositNative();
        vm.prank(address(0xDEAD)); vm.expectRevert(RepobayEscrow.TooEarly.selector); e.release(KEY, payees, amounts);
        vm.warp(block.timestamp + HOLD);
        vm.prank(address(0xDEAD)); e.release(KEY, payees, amounts);
        assert(builder.balance == 600e6 && installer.balance == 390e6 && platform.balance == 10e6 && state(KEY) == e.RELEASED());
    }

    function test_disputedOrderCannotBeReleasedOrConfirmed() public {
        depositToken(usdc);
        vm.prank(buyer); e.dispute(KEY);
        vm.warp(block.timestamp + HOLD);
        vm.expectRevert(RepobayEscrow.BadState.selector); e.release(KEY, payees, amounts);
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadState.selector); e.confirm(KEY, payees, amounts);
    }

    // ---------------------------------------------------------------- dispute / resolve / refund

    function test_disputeByPayerOrArbiterWhileHeld() public {
        depositToken(usdc);
        vm.prank(builder); vm.expectRevert(RepobayEscrow.NotPayer.selector); e.dispute(KEY);
        vm.prank(arbiter); e.dispute(KEY);
        (,,,, uint64 disputedAt, uint8 st,,) = e.orders(KEY);
        assert(st == e.DISPUTED() && disputedAt == uint64(block.timestamp));
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadState.selector); e.dispute(KEY);
    }

    function test_resolveSplitsAndRefundsRemainder() public {
        depositToken(usdc);
        vm.prank(buyer); e.dispute(KEY);
        uint256[] memory payouts = new uint256[](3);
        payouts[0] = 600e6; payouts[1] = 0; payouts[2] = 10e6;   // the installer never came: their share goes back
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.NotArbiter.selector); e.resolve(KEY, payees, amounts, payouts);
        uint256[] memory tooMuch = new uint256[](3);   // a fresh array: memory-to-memory assignment would alias `payouts`
        tooMuch[0] = 600e6 + 1; tooMuch[1] = 0; tooMuch[2] = 10e6;
        vm.prank(arbiter); vm.expectRevert(RepobayEscrow.BadSplit.selector); e.resolve(KEY, payees, amounts, tooMuch);
        uint256[] memory fewer = new uint256[](2);
        vm.prank(arbiter); vm.expectRevert(RepobayEscrow.BadSplit.selector); e.resolve(KEY, payees, amounts, fewer);
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(arbiter); e.resolve(KEY, payees, amounts, payouts);
        assert(usdc.balanceOf(builder) == 600e6 && usdc.balanceOf(installer) == 0 && usdc.balanceOf(platform) == 10e6);
        assert(usdc.balanceOf(buyer) == before + 390e6);
        (,,,,,,, uint256 refunded) = e.orders(KEY);
        assert(refunded == 390e6 && state(KEY) == e.RESOLVED());
    }

    /// The arbiter decides only with the split fixed at deposit: it cannot add itself or anyone else as a payee.
    function test_resolveCannotRedirectToNewPayees() public {
        depositToken(usdc);
        vm.prank(arbiter); e.dispute(KEY);
        address[] memory other = new address[](3); other[0] = arbiter; other[1] = installer; other[2] = platform;
        vm.prank(arbiter); vm.expectRevert(RepobayEscrow.BadSplit.selector); e.resolve(KEY, other, amounts, amounts);
    }

    function test_refundAfterSilentWindow() public {
        depositNative();
        vm.prank(buyer); e.dispute(KEY);
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.TooEarly.selector); e.refund(KEY);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(builder); vm.expectRevert(RepobayEscrow.NotPayer.selector); e.refund(KEY);
        uint256 before = buyer.balance;
        vm.prank(buyer); e.refund(KEY);
        assert(buyer.balance == before + total() && state(KEY) == e.REFUNDED());
    }

    function test_refundNeedsDispute() public {
        depositNative();
        vm.warp(block.timestamp + WINDOW + HOLD);
        vm.prank(buyer); vm.expectRevert(RepobayEscrow.BadState.selector); e.refund(KEY);
    }

    // ---------------------------------------------------------------- failed pushes, reentrancy, arbiter handover

    function test_refusingPayeeDoesNotBlockOthers() public {
        Refuser r = new Refuser();
        payees[1] = address(r);
        depositNative();
        vm.prank(buyer); e.confirm(KEY, payees, amounts);
        assert(builder.balance == 600e6 && platform.balance == 10e6);
        assert(e.owed(address(r), address(0)) == 390e6 && address(e).balance == 390e6);
        vm.prank(address(r)); vm.expectRevert(RepobayEscrow.TransferFailed.selector); e.withdraw(address(0));   // still refusing
    }

    function test_blockedTokenPayeeCanWithdrawLater() public {
        usdc.block_(installer, true);
        depositToken(usdc);
        vm.warp(block.timestamp + HOLD); e.release(KEY, payees, amounts);
        assert(usdc.balanceOf(installer) == 0 && e.owed(installer, address(usdc)) == 390e6);
        usdc.block_(installer, false);
        vm.prank(installer); e.withdraw(address(usdc));
        assert(usdc.balanceOf(installer) == 390e6 && e.owed(installer, address(usdc)) == 0);
        vm.prank(installer); vm.expectRevert(RepobayEscrow.BadAmount.selector); e.withdraw(address(usdc));
    }

    function test_reentrantPayeeIsParkedNotPaidTwice() public {
        Reenterer r = new Reenterer();
        payees[0] = address(r);
        r.arm(e, KEY, payees, amounts);
        depositNative();
        vm.warp(block.timestamp + HOLD);
        e.release(KEY, payees, amounts);
        // the callback reverted (Reentrancy), so the push failed and the amount is parked; nothing was paid twice
        assert(e.owed(address(r), address(0)) == 600e6 && address(r).balance == 0);
        assert(installer.balance == 390e6 && platform.balance == 10e6 && address(e).balance == 600e6);
    }

    function test_arbiterHandoverIsTwoStep() public {
        address next = address(0xA2);
        vm.prank(next); vm.expectRevert(RepobayEscrow.NotArbiter.selector); e.proposeArbiter(next);
        vm.prank(arbiter); e.proposeArbiter(next);
        assert(e.arbiter() == arbiter);
        vm.prank(address(0xA3)); vm.expectRevert(RepobayEscrow.NotArbiter.selector); e.acceptArbiter();
        vm.prank(next); e.acceptArbiter();
        assert(e.arbiter() == next && e.pendingArbiter() == address(0));
    }

    // ---------------------------------------------------------------- invariants under fuzzing

    /// Whatever the split and the decision, every unit deposited ends up with the payer or the payees, nobody gets
    /// more than their agreed share, and the contract keeps nothing.
    function testFuzz_resolveConserves(uint96 a0, uint96 a1, uint96 a2, uint96 p0, uint96 p1, uint96 p2) public {
        vm.assume(a0 > 0 && a1 > 0 && a2 > 0);
        setAmounts(a0, a1, a2);
        uint256[] memory payouts = new uint256[](3);
        payouts[0] = p0 % (uint256(a0) + 1); payouts[1] = p1 % (uint256(a1) + 1); payouts[2] = p2 % (uint256(a2) + 1);
        usdc.mint(buyer, total());
        uint256 start = usdc.balanceOf(buyer);
        depositToken(usdc);
        vm.prank(arbiter); e.dispute(KEY);
        vm.prank(arbiter); e.resolve(KEY, payees, amounts, payouts);
        assert(usdc.balanceOf(builder) == payouts[0] && usdc.balanceOf(installer) == payouts[1] && usdc.balanceOf(platform) == payouts[2]);
        assert(usdc.balanceOf(buyer) == start - payouts[0] - payouts[1] - payouts[2]);
        assert(usdc.balanceOf(address(e)) == 0);
    }

    function testFuzz_releaseConserves(uint96 a0, uint96 a1, uint96 a2, uint32 wait) public {
        vm.assume(a0 > 0 && a1 > 0 && a2 > 0);
        setAmounts(a0, a1, a2);
        vm.deal(buyer, total());
        depositNative();
        vm.warp(block.timestamp + HOLD + wait);
        e.release(KEY, payees, amounts);
        assert(builder.balance == a0 && installer.balance == a1 && platform.balance == a2 && address(e).balance == 0);
    }

    /// Before the hold ends and without a dispute, nobody but the payer can move a HELD payment: not a stranger,
    /// not a payee, not the arbiter.
    function testFuzz_nobodyElseMovesHeldFunds(address who) public {
        vm.assume(who != buyer && who != address(vm));   // the fuzzer samples constants from the bytecode, the Vm address among them
        depositToken(usdc);
        vm.prank(who); vm.expectRevert(RepobayEscrow.NotPayer.selector); e.confirm(KEY, payees, amounts);
        vm.prank(who); vm.expectRevert(RepobayEscrow.TooEarly.selector); e.release(KEY, payees, amounts);
        vm.prank(who); vm.expectRevert(RepobayEscrow.NotPayer.selector); e.refund(KEY);
        vm.prank(arbiter); vm.expectRevert(RepobayEscrow.BadState.selector); e.resolve(KEY, payees, amounts, amounts);   // not disputed
        assert(usdc.balanceOf(address(e)) == total());
    }
}
