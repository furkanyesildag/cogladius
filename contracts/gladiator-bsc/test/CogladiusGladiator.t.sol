// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2, stdStorage, StdStorage} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {CogladiusGladiator} from "../src/CogladiusGladiator.sol";

/// @dev Stand-in for the BSC `.ai` Agent ID contract, etched at its real address.
contract MockAgentID {
    mapping(address => uint256) public balanceOf;

    function setBalance(address who, uint256 bal) external {
        balanceOf[who] = bal;
    }
}

contract CogladiusGladiatorTest is Test {
    using stdStorage for StdStorage;

    address constant AGENT_ID_ADDR = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    CogladiusGladiator nft;
    MockAgentID agentId;

    uint256 signerKey = 0xA11CE;
    address signer;
    address treasury = makeAddr("treasury");
    address owner = makeAddr("owner");

    uint256 aliceKey = 0xB0B;
    address alice;
    address bob = makeAddr("bob");
    address noId = makeAddr("noId");

    function setUp() public {
        signer = vm.addr(signerKey);
        alice = vm.addr(aliceKey);

        vm.etch(AGENT_ID_ADDR, type(MockAgentID).runtimeCode);
        agentId = MockAgentID(AGENT_ID_ADDR);
        agentId.setBalance(alice, 1);
        agentId.setBalance(bob, 2);

        nft = new CogladiusGladiator(signer, treasury, owner);
        vm.warp(1_750_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _sign(uint256 key, address to, uint16 score, uint8 tier, bytes32 taskHash, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = nft.hashMint(to, score, tier, taskHash, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _voucher(address to, uint16 score, uint8 tier, bytes32 taskHash)
        internal
        view
        returns (uint256 deadline, bytes memory sig)
    {
        deadline = block.timestamp + 1 days;
        sig = _sign(signerKey, to, score, tier, taskHash, deadline);
    }

    // ------------------------------------------------------------------ metadata / config

    function test_Metadata() public view {
        assertEq(nft.name(), "Cogladius Gladiator");
        assertEq(nft.symbol(), "GLAD");
        assertEq(nft.MAX_SUPPLY(), 5555);
        assertEq(address(nft.AGENT_ID()), AGENT_ID_ADDR);
        assertEq(nft.signer(), signer);
        assertEq(nft.owner(), owner);
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC2981).interfaceId));
    }

    function test_RoyaltyInfoIs2_5Percent() public view {
        (address receiver, uint256 amount) = nft.royaltyInfo(1, 1 ether);
        assertEq(receiver, treasury);
        assertEq(amount, 0.025 ether);
        (, uint256 amount2) = nft.royaltyInfo(1, 10_000);
        assertEq(amount2, 250);
    }

    // ------------------------------------------------------------------ happy path

    function test_HappyMint() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 deadline, bytes memory sig) = _voucher(alice, 85, 2, taskHash);

        assertTrue(nft.canMint(alice));

        vm.expectEmit(true, true, false, true, address(nft));
        emit CogladiusGladiator.GladiatorMinted(alice, 1, 85, 2, taskHash);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        uint256 id = nft.mint(85, 2, taskHash, deadline, sig);
        uint256 gasUsed = gasBefore - gasleft();
        console2.log("mint() gas (in-call, warm prank):", gasUsed);

        assertEq(id, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.balanceOf(alice), 1);
        assertEq(nft.totalMinted(), 1);
        assertTrue(nft.hasMinted(alice));
        assertTrue(nft.usedTask(taskHash));
        assertEq(nft.scoreOf(1), 85);
        assertEq(nft.tierOf(1), 2);
        assertEq(nft.taskOf(1), taskHash);
        assertFalse(nft.canMint(alice));
    }

    function test_IdsIncrement() public {
        (uint256 d1, bytes memory s1) = _voucher(alice, 70, 1, keccak256("a"));
        vm.prank(alice);
        assertEq(nft.mint(70, 1, keccak256("a"), d1, s1), 1);

        (uint256 d2, bytes memory s2) = _voucher(bob, 100, 3, keccak256("b"));
        vm.prank(bob);
        assertEq(nft.mint(100, 3, keccak256("b"), d2, s2), 2);
        assertEq(nft.totalMinted(), 2);
    }

    function test_DeadlineInclusive() public {
        uint256 deadline = block.timestamp;
        bytes memory sig = _sign(signerKey, alice, 90, 3, keccak256("t"), deadline);
        vm.prank(alice);
        nft.mint(90, 3, keccak256("t"), deadline, sig);
    }

    // ------------------------------------------------------------------ reverts

    function test_RevertWrongSigner() public {
        bytes32 taskHash = keccak256("attempt-1");
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _sign(0xBAD, alice, 85, 2, taskHash, deadline);
        vm.prank(alice);
        vm.expectRevert("bad signature");
        nft.mint(85, 2, taskHash, deadline, sig);
    }

    function test_RevertSignatureForDifferentTo() public {
        bytes32 taskHash = keccak256("attempt-1");
        // Voucher issued to bob, alice tries to redeem it.
        (uint256 deadline, bytes memory sig) = _voucher(bob, 85, 2, taskHash);
        vm.prank(alice);
        vm.expectRevert("bad signature");
        nft.mint(85, 2, taskHash, deadline, sig);
    }

    function test_RevertExpiredDeadline() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 deadline, bytes memory sig) = _voucher(alice, 85, 2, taskHash);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert("voucher expired");
        nft.mint(85, 2, taskHash, deadline, sig);
    }

    function test_RevertSecondMintSameWallet() public {
        (uint256 d1, bytes memory s1) = _voucher(alice, 85, 2, keccak256("attempt-1"));
        vm.prank(alice);
        nft.mint(85, 2, keccak256("attempt-1"), d1, s1);

        (uint256 d2, bytes memory s2) = _voucher(alice, 95, 3, keccak256("attempt-2"));
        vm.prank(alice);
        vm.expectRevert("already minted");
        nft.mint(95, 3, keccak256("attempt-2"), d2, s2);
    }

    function test_RevertReusedTaskHash() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 d1, bytes memory s1) = _voucher(alice, 85, 2, taskHash);
        vm.prank(alice);
        nft.mint(85, 2, taskHash, d1, s1);

        // A valid signature for bob, but over the same taskHash.
        (uint256 d2, bytes memory s2) = _voucher(bob, 85, 2, taskHash);
        vm.prank(bob);
        vm.expectRevert("task already used");
        nft.mint(85, 2, taskHash, d2, s2);
    }

    function test_RevertNoAgentID() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 deadline, bytes memory sig) = _voucher(noId, 85, 2, taskHash);
        assertFalse(nft.canMint(noId));
        vm.prank(noId);
        vm.expectRevert("need .ai Agent ID");
        nft.mint(85, 2, taskHash, deadline, sig);
    }

    function test_RevertTierScoreMismatch() public {
        bytes32 taskHash = keccak256("attempt-1");
        // score 85 is Silver (2), claiming Gold (3) even with a valid signature.
        (uint256 deadline, bytes memory sig) = _voucher(alice, 85, 3, taskHash);
        vm.prank(alice);
        vm.expectRevert("tier mismatch");
        nft.mint(85, 3, taskHash, deadline, sig);
    }

    function test_RevertTierBoundaries() public view {
        assertEq(nft.tierForScore(69), 0);
        assertEq(nft.tierForScore(70), 1);
        assertEq(nft.tierForScore(79), 1);
        assertEq(nft.tierForScore(80), 2);
        assertEq(nft.tierForScore(89), 2);
        assertEq(nft.tierForScore(90), 3);
        assertEq(nft.tierForScore(100), 3);
        assertEq(nft.tierForScore(101), 0);
    }

    function test_RevertScoreBelow70() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 deadline, bytes memory sig) = _voucher(alice, 69, 1, taskHash);
        vm.prank(alice);
        vm.expectRevert("score out of range");
        nft.mint(69, 1, taskHash, deadline, sig);
    }

    function test_RevertScoreAbove100() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 deadline, bytes memory sig) = _voucher(alice, 101, 3, taskHash);
        vm.prank(alice);
        vm.expectRevert("score out of range");
        nft.mint(101, 3, taskHash, deadline, sig);
    }

    function test_RevertTamperedScore() public {
        bytes32 taskHash = keccak256("attempt-1");
        (uint256 deadline, bytes memory sig) = _voucher(alice, 85, 2, taskHash);
        vm.prank(alice);
        vm.expectRevert("bad signature");
        nft.mint(88, 2, taskHash, deadline, sig);
    }

    function test_RevertSoldOut() public {
        stdstore.target(address(nft)).sig("totalMinted()").checked_write(nft.MAX_SUPPLY());
        assertFalse(nft.canMint(alice));
        (uint256 deadline, bytes memory sig) = _voucher(alice, 85, 2, keccak256("attempt-1"));
        vm.prank(alice);
        vm.expectRevert("sold out");
        nft.mint(85, 2, keccak256("attempt-1"), deadline, sig);
    }

    // ------------------------------------------------------------------ owner

    function test_OwnerSetSignerAndRoyalty() public {
        uint256 newKey = 0xC0FFEE;
        vm.prank(owner);
        nft.setSigner(vm.addr(newKey));
        assertEq(nft.signer(), vm.addr(newKey));

        // Old signer's vouchers no longer work, new signer's do.
        (uint256 d, bytes memory oldSig) = _voucher(alice, 75, 1, keccak256("x"));
        vm.prank(alice);
        vm.expectRevert("bad signature");
        nft.mint(75, 1, keccak256("x"), d, oldSig);

        bytes memory newSig = _sign(newKey, alice, 75, 1, keccak256("x"), d);
        vm.prank(alice);
        nft.mint(75, 1, keccak256("x"), d, newSig);

        vm.prank(owner);
        nft.setRoyalty(bob, 500);
        (address r, uint256 a) = nft.royaltyInfo(1, 10_000);
        assertEq(r, bob);
        assertEq(a, 500);
    }

    function test_RevertNonOwnerAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.setSigner(alice);
        vm.prank(alice);
        vm.expectRevert();
        nft.setRoyalty(alice, 1000);
    }

    // ------------------------------------------------------------------ tokenURI

    function test_TokenURIContainsScore() public {
        (uint256 deadline, bytes memory sig) = _voucher(alice, 93, 3, keccak256("attempt-1"));
        vm.prank(alice);
        nft.mint(93, 3, keccak256("attempt-1"), deadline, sig);

        string memory uri = nft.tokenURI(1);
        string memory prefix = "data:application/json;base64,";
        assertTrue(_startsWith(uri, prefix));

        string memory json = string(_b64decode(_slice(bytes(uri), bytes(prefix).length)));
        console2.log(json);
        assertTrue(_contains(json, '"name":"Cogladius Gladiator #1"'));
        assertTrue(_contains(json, '{"trait_type":"Score","display_type":"number","value":93}'));
        assertTrue(_contains(json, '{"trait_type":"Tier","value":"Gold"}'));

        // Decode the embedded SVG too.
        string memory imgPrefix = '"image":"data:image/svg+xml;base64,';
        uint256 start = _indexOf(json, imgPrefix) + bytes(imgPrefix).length;
        uint256 end = start;
        while (bytes(json)[end] != '"') end++;
        string memory svg = string(_b64decode(_sliceRange(bytes(json), start, end)));
        assertTrue(_contains(svg, "COGLADIUS GLADIATOR #1"));
        assertTrue(_contains(svg, "Gold"));
        assertTrue(_contains(svg, ">93<"));
        assertTrue(_contains(svg, "cogladius.xyz/arena"));
    }

    function test_RevertTokenURINonexistent() public {
        vm.expectRevert();
        nft.tokenURI(1);
    }

    // ------------------------------------------------------------------ server digest reproduction

    /// @dev Pins the exact digest the server must produce with viem `signTypedData` on BSC.
    ///      Inputs: chainId 56, verifyingContract 0x1111111111111111111111111111111111111111,
    ///      to 0x2222222222222222222222222222222222222222, score 85, tier 2,
    ///      taskHash keccak256("attempt-123"), deadline 1767225600.
    function test_ServerDigestReproduction() public {
        vm.chainId(56);
        address verifying = 0x1111111111111111111111111111111111111111;
        deployCodeTo("CogladiusGladiator.sol:CogladiusGladiator", abi.encode(signer, treasury, owner), verifying);
        CogladiusGladiator c = CogladiusGladiator(verifying);

        address to = 0x2222222222222222222222222222222222222222;
        uint16 score = 85;
        uint8 tier = 2;
        bytes32 taskHash = keccak256(bytes("attempt-123"));
        uint256 deadline = 1767225600;

        // Independent computation (no contract code involved).
        bytes32 typeHash = keccak256("Mint(address to,uint16 score,uint8 tier,bytes32 taskHash,uint256 deadline)");
        bytes32 domainTypeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 domainSep = keccak256(
            abi.encode(domainTypeHash, keccak256("CogladiusGladiator"), keccak256("1"), uint256(56), verifying)
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, to, score, tier, taskHash, deadline));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        console2.log("MINT_TYPEHASH");
        console2.logBytes32(typeHash);
        console2.log("taskHash = keccak256('attempt-123')");
        console2.logBytes32(taskHash);
        console2.log("domainSeparator (chainId 56, 0x1111...1111)");
        console2.logBytes32(domainSep);
        console2.log("digest");
        console2.logBytes32(expected);

        assertEq(c.MINT_TYPEHASH(), typeHash);
        assertEq(c.domainSeparator(), domainSep);
        assertEq(c.hashMint(to, score, tier, taskHash, deadline), expected);

        // Hard-coded known values (also reproduced with `cast` / viem, see README).
        assertEq(typeHash, KNOWN_TYPEHASH);
        assertEq(domainSep, KNOWN_DOMAIN_SEPARATOR);
        assertEq(expected, KNOWN_DIGEST);

        _checkDomain(c, verifying);

        // A signature produced by viem (the server's library) is accepted on chain.
        assertEq(vm.addr(signerKey), 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7);
        agentId.setBalance(to, 1);
        vm.prank(to);
        uint256 id = c.mint(score, tier, taskHash, deadline, VIEM_SIG);
        assertEq(c.ownerOf(id), to);
    }

    /// @dev ERC-5267 domain matches what the server hardcodes.
    function _checkDomain(CogladiusGladiator c, address verifying) internal view {
        (, string memory name, string memory version, uint256 chainId, address vc,,) = c.eip712Domain();
        assertEq(name, "CogladiusGladiator");
        assertEq(version, "1");
        assertEq(chainId, 56);
        assertEq(vc, verifying);
    }

    bytes32 constant KNOWN_TYPEHASH = 0xdb230c5a8523f90f5ddd1e76f65f758233b70184acdbb42b47339b7a117e2d4f;
    bytes32 constant KNOWN_DOMAIN_SEPARATOR = 0x3ccdee7feef73f6c9eafafd8fb043df14f20fc262310733af9c605dda3b68b55;
    /// @dev Equal to viem `hashTypedData(...)` on the typed data in README.md.
    bytes32 constant KNOWN_DIGEST = 0xb63b2300f2e0a905fc57766589bc51bca4ac9349511d38b073b7acd9a4e695a6;
    /// @dev viem `privateKeyToAccount(0x...a11ce).signTypedData(...)` on the same typed data.
    bytes constant VIEM_SIG =
        hex"1c25569353fb1cb851ad55b6457fae68f84b17353c3d5cb368acaf4103ca722e0bea335108f880647cef766a5b5787da5b9be0d2ba244506625e399fbd9206da1c";

    // ------------------------------------------------------------------ string utils

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (b.length > a.length) return false;
        for (uint256 i; i < b.length; i++) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _indexOf(string memory s, string memory n) internal pure returns (uint256) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(n);
        if (b.length > a.length) return type(uint256).max;
        for (uint256 i; i <= a.length - b.length; i++) {
            bool ok = true;
            for (uint256 j; j < b.length; j++) {
                if (a[i + j] != b[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return i;
        }
        return type(uint256).max;
    }

    function _contains(string memory s, string memory n) internal pure returns (bool) {
        return _indexOf(s, n) != type(uint256).max;
    }

    function _slice(bytes memory a, uint256 start) internal pure returns (bytes memory) {
        return _sliceRange(a, start, a.length);
    }

    function _sliceRange(bytes memory a, uint256 start, uint256 end) internal pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i; i < out.length; i++) {
            out[i] = a[start + i];
        }
    }

    function _b64val(bytes1 c) internal pure returns (uint8) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        revert("bad b64");
    }

    function _b64decode(bytes memory data) internal pure returns (bytes memory) {
        require(data.length % 4 == 0, "b64 len");
        uint256 pad;
        if (data.length > 0 && data[data.length - 1] == "=") pad++;
        if (data.length > 1 && data[data.length - 2] == "=") pad++;
        bytes memory out = new bytes((data.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < data.length; i += 4) {
            uint256 n = (uint256(_b64val(data[i])) << 18) | (uint256(_b64val(data[i + 1])) << 12);
            if (data[i + 2] != "=") n |= uint256(_b64val(data[i + 2])) << 6;
            if (data[i + 3] != "=") n |= uint256(_b64val(data[i + 3]));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
        return out;
    }
}
