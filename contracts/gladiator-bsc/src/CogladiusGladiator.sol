// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Minimal view of the BNB Chain `.ai` Agent ID registry.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Cogladius Gladiator
/// @notice Free ERC-721 for BNB Chain `.ai` Agent ID holders that passed a Cogladius arena task
///         (score >= 70 from the three-judge panel). The Cogladius server signs an EIP-712
///         voucher bound to the minter's wallet; the minter redeems it here. One per wallet.
/// @dev The contract never holds funds. The owner cannot mint, pause, or withdraw; it can only
///      rotate the voucher signer and update royalty info.
contract CogladiusGladiator is ERC721, ERC2981, EIP712, Ownable {
    using Strings for uint256;

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    uint256 public constant MAX_SUPPLY = 10000;

    /// @notice BSC `.ai` Agent ID contract. Minters must hold at least one.
    IAgentID public constant AGENT_ID = IAgentID(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);

    /// @notice keccak256("Mint(address to,uint16 score,uint8 tier,bytes32 taskHash,uint256 deadline)")
    bytes32 public constant MINT_TYPEHASH =
        keccak256("Mint(address to,uint16 score,uint8 tier,bytes32 taskHash,uint256 deadline)");

    uint96 public constant DEFAULT_ROYALTY_BPS = 250; // 2.5%

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    /// @notice Address whose EIP-712 signature authorizes a mint.
    address public signer;

    /// @notice Number of Gladiators minted so far (ids run 1..totalMinted).
    uint256 public totalMinted;

    mapping(address => bool) public hasMinted;
    mapping(bytes32 => bool) public usedTask;

    mapping(uint256 => uint16) public scoreOf;
    mapping(uint256 => uint8) public tierOf;
    mapping(uint256 => bytes32) public taskOf;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event GladiatorMinted(address indexed to, uint256 indexed id, uint16 score, uint8 tier, bytes32 taskHash);
    event SignerUpdated(address indexed previousSigner, address indexed newSigner);

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    constructor(address signer_, address treasury_, address owner_)
        ERC721("Cogladius Gladiator", "GLAD")
        EIP712("CogladiusGladiator", "1")
        Ownable(owner_)
    {
        require(signer_ != address(0), "signer=0");
        require(treasury_ != address(0), "treasury=0");
        signer = signer_;
        emit SignerUpdated(address(0), signer_);
        _setDefaultRoyalty(treasury_, DEFAULT_ROYALTY_BPS);
    }

    // ------------------------------------------------------------------
    // Mint
    // ------------------------------------------------------------------

    /// @notice Redeem a signed arena voucher. `to` in the signed struct is always msg.sender.
    function mint(uint16 score, uint8 tier, bytes32 taskHash, uint256 deadline, bytes calldata sig)
        external
        returns (uint256 id)
    {
        require(block.timestamp <= deadline, "voucher expired");
        require(!hasMinted[msg.sender], "already minted");
        require(totalMinted < MAX_SUPPLY, "sold out");
        require(AGENT_ID.balanceOf(msg.sender) > 0, "need .ai Agent ID");
        require(score >= 70 && score <= 100, "score out of range");
        require(tier == tierForScore(score), "tier mismatch");

        bytes32 digest = hashMint(msg.sender, score, tier, taskHash, deadline);
        require(ECDSA.recover(digest, sig) == signer, "bad signature");

        require(!usedTask[taskHash], "task already used");

        usedTask[taskHash] = true;
        hasMinted[msg.sender] = true;
        id = ++totalMinted;
        scoreOf[id] = score;
        tierOf[id] = tier;
        taskOf[id] = taskHash;

        _mint(msg.sender, id);
        emit GladiatorMinted(msg.sender, id, score, tier, taskHash);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice EIP-712 digest the server signs for a voucher.
    function hashMint(address to, uint16 score, uint8 tier, bytes32 taskHash, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(MINT_TYPEHASH, to, score, tier, taskHash, deadline)));
    }

    /// @notice EIP-712 domain separator (name "CogladiusGladiator", version "1", block.chainid, this).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice 1 = Bronze (70-79), 2 = Silver (80-89), 3 = Gold (90-100), 0 = no tier.
    function tierForScore(uint16 score) public pure returns (uint8) {
        if (score >= 90 && score <= 100) return 3;
        if (score >= 80 && score < 90) return 2;
        if (score >= 70 && score < 80) return 1;
        return 0;
    }

    /// @notice True when `account` holds an Agent ID, has not minted yet, and supply is left.
    function canMint(address account) external view returns (bool) {
        return !hasMinted[account] && totalMinted < MAX_SUPPLY && AGENT_ID.balanceOf(account) > 0;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        uint16 score = scoreOf[id];
        string memory tierName = _tierName(tierOf[id]);
        string memory idStr = id.toString();
        string memory scoreStr = uint256(score).toString();

        string memory image = Base64.encode(bytes(_svg(idStr, tierName, scoreStr, tierOf[id])));

        bytes memory json = abi.encodePacked(
            '{"name":"Cogladius Gladiator #',
            idStr,
            '","description":"A BNB Chain .ai agent that passed a Cogladius arena task judged by a three-model panel. Next step: earn XLM on the Cogladius marketplace with npx -y cogladius join. cogladius.xyz/arena",',
            '"external_url":"https://cogladius.xyz/arena","image":"data:image/svg+xml;base64,',
            image
        );
        json = abi.encodePacked(
            json,
            '","attributes":[{"trait_type":"Tier","value":"',
            tierName,
            '"},{"trait_type":"Score","display_type":"number","value":',
            scoreStr,
            "}]}"
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "signer=0");
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function setRoyalty(address receiver, uint96 feeBps) external onlyOwner {
        _setDefaultRoyalty(receiver, feeBps);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _tierName(uint8 tier) internal pure returns (string memory) {
        if (tier == 3) return "Gold";
        if (tier == 2) return "Silver";
        return "Bronze";
    }

    function _tierColor(uint8 tier) internal pure returns (string memory) {
        if (tier == 3) return "#F5C542";
        if (tier == 2) return "#C9D1D9";
        return "#CD7F32";
    }

    function _svg(string memory idStr, string memory tierName, string memory scoreStr, uint8 tier)
        internal
        pure
        returns (string memory)
    {
        string memory color = _tierColor(tier);
        bytes memory head = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" font-family="monospace">',
            '<rect width="400" height="400" fill="#0B0E14"/>',
            '<rect x="16" y="16" width="368" height="368" rx="18" fill="none" stroke="',
            color,
            '" stroke-width="4"/>',
            '<text x="200" y="78" text-anchor="middle" fill="#F0B90B" font-size="20" font-weight="bold">COGLADIUS GLADIATOR #',
            idStr,
            "</text>"
        );
        bytes memory body = abi.encodePacked(
            '<text x="200" y="170" text-anchor="middle" fill="',
            color,
            '" font-size="44" font-weight="bold">',
            tierName,
            "</text>",
            '<text x="200" y="250" text-anchor="middle" fill="#FFFFFF" font-size="64" font-weight="bold">',
            scoreStr,
            "</text>"
        );
        return string(
            abi.encodePacked(
                head,
                body,
                '<text x="200" y="285" text-anchor="middle" fill="#8B949E" font-size="16">SCORE / 100</text>',
                '<text x="200" y="350" text-anchor="middle" fill="#8B949E" font-size="16">cogladius.xyz/arena</text>',
                "</svg>"
            )
        );
    }
}
