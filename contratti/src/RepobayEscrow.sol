// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RepobayEscrow
/// @notice The buyer's payment waits here until the installation is confirmed, then it is split among the
///         people who earned it. The platform is only an arbiter: it can freeze a payment and decide a dispute,
///         but money can only ever go back to the buyer or forward to the payees agreed at deposit time.
///
/// Life of an order. The shop picks an `id` per order; the contract files it under `key = keyOf(payer, id)`,
/// so nobody can take an id first by copying it from a pending transaction (each payer has their own ids):
///   deposit  → HELD       the buyer locks the whole amount and the split (payees + amounts), before `deadline`
///   confirm  → CONFIRMED  the buyer says «installed and working»: everyone is paid at once
///   release  → RELEASED   `hold` seconds passed without a dispute: anyone may trigger the same payout
///   dispute  → DISPUTED   the buyer (or the arbiter, on the buyer's behalf) freezes the payout while HELD
///   resolve  → RESOLVED   the arbiter decides: each payee gets at most their share, the rest returns to the buyer
///   refund   → REFUNDED   the arbiter stayed silent for `window` seconds after the dispute: the buyer takes it all back
///
/// There is no owner, no upgrade, no sweep. Payouts are pushed; if a payee cannot receive (a reverting
/// contract, a blacklisted address) their amount waits in `owed` and they `withdraw` it later, so one payee
/// can never block the others. Never send coins or tokens to this address directly: only `deposit` counts.
contract RepobayEscrow {
    uint8 public constant HELD = 1;
    uint8 public constant DISPUTED = 2;
    uint8 public constant CONFIRMED = 3;
    uint8 public constant RELEASED = 4;
    uint8 public constant RESOLVED = 5;
    uint8 public constant REFUNDED = 6;
    /// @notice upper bound for `hold` and `window`: a typo at deployment (milliseconds for seconds) cannot lock funds for decades
    uint64 public constant MAX_PERIOD = 365 days;

    struct Order {
        address payer;      // who deposited: the only one who can confirm, dispute or take a late refund
        address token;      // ERC-20 address, or address(0) for the chain's native coin
        uint256 total;      // what was deposited (= sum of the amounts in the split)
        uint64 unlockAt;    // from here on anyone can release a HELD order
        uint64 disputedAt;  // when the payout was frozen (0 if never)
        uint8 state;        // one of the constants above (0 = unknown key)
        bytes32 split;      // keccak256(abi.encode(payees, amounts)): the split is fixed at deposit, passed again at payout
        uint256 refunded;   // what went back to the payer (RESOLVED, REFUNDED)
    }

    /// @notice seconds a payment stays locked before silence counts as acceptance
    uint64 public immutable hold;
    /// @notice seconds the arbiter has to resolve a dispute before the payer may refund themselves
    uint64 public immutable window;
    address public arbiter;
    address public pendingArbiter;
    /// @notice keyOf(payer, id) → order
    mapping(bytes32 => Order) public orders;
    /// @notice payee → token → amount a failed push left here, withdrawable any time
    mapping(address => mapping(address => uint256)) public owed;
    uint256 private _entered;

    event Deposited(bytes32 indexed key, bytes32 indexed id, address indexed payer, address token, uint256 total, bytes32 split, uint64 unlockAt);
    event Confirmed(bytes32 indexed key);
    event Released(bytes32 indexed key, address by);
    event Disputed(bytes32 indexed key, address by);
    event Resolved(bytes32 indexed key, uint256 refund, uint256[] payouts);
    event Refunded(bytes32 indexed key, uint256 amount);
    event Paid(bytes32 indexed key, address indexed to, uint256 amount);
    event Owed(address indexed to, address token, uint256 amount);
    event Withdrawn(address indexed to, address token, uint256 amount);
    event ArbiterProposed(address arbiter);
    event ArbiterChanged(address arbiter);

    error NotArbiter();
    error NotPayer();
    error BadState();
    error BadSplit();
    error BadAmount();
    error AlreadyExists();
    error TooEarly();
    error TooLate();
    error Reentrancy();
    error TransferFailed();

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    constructor(address arbiter_, uint64 hold_, uint64 window_) {
        if (arbiter_ == address(0) || hold_ == 0 || window_ == 0 || hold_ > MAX_PERIOD || window_ > MAX_PERIOD) revert BadAmount();
        arbiter = arbiter_;
        hold = hold_;
        window = window_;
    }

    /// @notice where the order `id` paid by `payer` is filed
    function keyOf(address payer, bytes32 id) public pure returns (bytes32) {
        return keccak256(abi.encode(payer, id));
    }

    // ---------------------------------------------------------------- the buyer

    /// @notice Lock `total` (native: send it as msg.value; token: approve first) with its split. `deadline` is when the
    ///         shop's price stops being valid: a payment that arrives later is refused here, instead of being stuck.
    function deposit(bytes32 id, address token, uint256 total, uint64 deadline, address[] calldata payees, uint256[] calldata amounts)
        external
        payable
        nonReentrant
        returns (bytes32 key)
    {
        if (block.timestamp > deadline) revert TooLate();
        key = keyOf(msg.sender, id);
        Order storage o = orders[key];
        if (o.state != 0) revert AlreadyExists();
        o.split = _split(payees, amounts, total);
        _collect(token, total);
        o.payer = msg.sender;
        o.token = token;
        o.total = total;
        o.unlockAt = uint64(block.timestamp) + hold;
        o.state = HELD;
        emit Deposited(key, id, msg.sender, token, total, o.split, o.unlockAt);
    }

    /// @notice «Installed and working»: pay everyone now.
    function confirm(bytes32 key, address[] calldata payees, uint256[] calldata amounts) external nonReentrant {
        Order storage o = orders[key];
        if (msg.sender != o.payer) revert NotPayer();
        if (o.state != HELD) revert BadState();
        _check(o, payees, amounts);
        o.state = CONFIRMED;
        emit Confirmed(key);
        _payAll(key, o.token, payees, amounts);
    }

    /// @notice Freeze the payout. The payer may do it as long as the money is still here; the arbiter too,
    ///         when the buyer reports a problem through the shop instead of their wallet.
    function dispute(bytes32 key) external {
        Order storage o = orders[key];
        if (o.state != HELD) revert BadState();
        if (msg.sender != o.payer && msg.sender != arbiter) revert NotPayer();
        o.state = DISPUTED;
        o.disputedAt = uint64(block.timestamp);
        emit Disputed(key, msg.sender);
    }

    /// @notice A dispute nobody resolved within `window`: the payer takes everything back.
    function refund(bytes32 key) external nonReentrant {
        Order storage o = orders[key];
        if (msg.sender != o.payer) revert NotPayer();
        if (o.state != DISPUTED) revert BadState();
        if (block.timestamp < uint256(o.disputedAt) + window) revert TooEarly();
        o.state = REFUNDED;
        o.refunded = o.total;
        emit Refunded(key, o.total);
        _pay(key, o.token, o.payer, o.total);
    }

    // ---------------------------------------------------------------- anyone

    /// @notice `hold` passed in silence: pay everyone. Callable by anyone (payees, the shop, the buyer).
    function release(bytes32 key, address[] calldata payees, uint256[] calldata amounts) external nonReentrant {
        Order storage o = orders[key];
        if (o.state != HELD) revert BadState();
        if (block.timestamp < o.unlockAt) revert TooEarly();
        _check(o, payees, amounts);
        o.state = RELEASED;
        emit Released(key, msg.sender);
        _payAll(key, o.token, payees, amounts);
    }

    /// @notice Take what a failed push left for you.
    function withdraw(address token) external nonReentrant {
        uint256 amount = owed[msg.sender][token];
        if (amount == 0) revert BadAmount();
        owed[msg.sender][token] = 0;
        bool ok;
        if (token == address(0)) {
            (ok,) = msg.sender.call{value: amount}("");
        } else {
            ok = _transfer(token, msg.sender, amount);
        }
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, token, amount);
    }

    // ---------------------------------------------------------------- the arbiter

    /// @notice Decide a dispute: `payouts[i]` (≤ `amounts[i]`) goes to `payees[i]`, the remainder back to the payer.
    function resolve(bytes32 key, address[] calldata payees, uint256[] calldata amounts, uint256[] calldata payouts)
        external
        onlyArbiter
        nonReentrant
    {
        Order storage o = orders[key];
        if (o.state != DISPUTED) revert BadState();
        _check(o, payees, amounts);
        if (payouts.length != amounts.length) revert BadSplit();
        uint256 paid;
        for (uint256 i; i < payouts.length; i++) {
            if (payouts[i] > amounts[i]) revert BadSplit();
            paid += payouts[i];
        }
        uint256 back = o.total - paid;
        o.state = RESOLVED;
        o.refunded = back;
        emit Resolved(key, back, payouts);
        for (uint256 i; i < payouts.length; i++) {
            if (payouts[i] > 0) _pay(key, o.token, payees[i], payouts[i]);
        }
        if (back > 0) _pay(key, o.token, o.payer, back);
    }

    /// @notice Hand the arbiter role to a new wallet, in two steps so a typo cannot lose it.
    function proposeArbiter(address next) external onlyArbiter {
        pendingArbiter = next;
        emit ArbiterProposed(next);
    }

    function acceptArbiter() external {
        if (msg.sender != pendingArbiter || msg.sender == address(0)) revert NotArbiter();
        arbiter = msg.sender;
        pendingArbiter = address(0);
        emit ArbiterChanged(msg.sender);
    }

    // ---------------------------------------------------------------- internals

    function _split(address[] calldata payees, uint256[] calldata amounts, uint256 total) internal pure returns (bytes32) {
        uint256 n = payees.length;
        if (n == 0 || n > 16 || n != amounts.length || total == 0) revert BadSplit();
        uint256 sum;
        for (uint256 i; i < n; i++) {
            if (payees[i] == address(0) || amounts[i] == 0) revert BadSplit();
            sum += amounts[i];
        }
        if (sum != total) revert BadSplit();
        return keccak256(abi.encode(payees, amounts));
    }

    function _check(Order storage o, address[] calldata payees, uint256[] calldata amounts) internal view {
        if (keccak256(abi.encode(payees, amounts)) != o.split) revert BadSplit();
    }

    /// @dev take the deposit: the exact native value, or exactly `total` tokens (fee-on-transfer tokens are refused)
    function _collect(address token, uint256 total) internal {
        if (token == address(0)) {
            if (msg.value != total) revert BadAmount();
        } else {
            if (msg.value != 0) revert BadAmount();
            uint256 before = _balance(token);
            _transferFrom(token, msg.sender, total);
            if (_balance(token) - before != total) revert BadAmount();
        }
    }

    function _payAll(bytes32 key, address token, address[] calldata payees, uint256[] calldata amounts) internal {
        for (uint256 i; i < payees.length; i++) {
            _pay(key, token, payees[i], amounts[i]);
        }
    }

    /// @dev push the money; if the receiver refuses, park it in `owed` instead of failing the whole payout
    function _pay(bytes32 key, address token, address to, uint256 amount) internal {
        bool ok;
        if (token == address(0)) {
            // no return data is copied back: a payee cannot make the payout expensive by answering with a huge blob
            assembly ("memory-safe") {
                ok := call(100000, to, amount, 0, 0, 0, 0)
            }
        } else {
            ok = _transfer(token, to, amount);
        }
        if (ok) {
            emit Paid(key, to, amount);
        } else {
            owed[to][token] += amount;
            emit Owed(to, token, amount);
        }
    }

    /// @dev ERC-20 transfer tolerant of tokens that return nothing (USDT); false instead of revert
    function _transfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        return _succeeded(token, ok, data);
    }

    function _transferFrom(address token, address from, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, address(this), amount));
        if (!_succeeded(token, ok, data)) revert TransferFailed();
    }

    /// @dev a token call worked if it did not revert and either returned exactly `true`, or returned nothing from an
    ///      address that has code (an address without code «succeeds» at everything without moving anything)
    function _succeeded(address token, bool ok, bytes memory data) internal view returns (bool) {
        if (!ok) return false;
        if (data.length == 0) return token.code.length > 0;
        return data.length >= 32 && abi.decode(data, (uint256)) == 1;
    }

    function _balance(address token) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || data.length < 32) revert TransferFailed();
        return abi.decode(data, (uint256));
    }
}
