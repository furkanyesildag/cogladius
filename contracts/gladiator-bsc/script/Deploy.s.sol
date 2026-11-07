// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CogladiusGladiator} from "../src/CogladiusGladiator.sol";

/// @notice Deploys CogladiusGladiator.
/// Env: SIGNER (voucher signer address = address of ARENA_SIGNER_KEY), TREASURY (royalty receiver), OWNER.
/// The deployer key is passed on the CLI (--account / --private-key / --ledger), never via env here.
contract Deploy is Script {
    function run() external returns (CogladiusGladiator nft) {
        address signer = vm.envAddress("SIGNER");
        address treasury = vm.envAddress("TREASURY");
        address owner = vm.envAddress("OWNER");

        console2.log("chainId ", block.chainid);
        console2.log("signer  ", signer);
        console2.log("treasury", treasury);
        console2.log("owner   ", owner);

        vm.startBroadcast();
        nft = new CogladiusGladiator(signer, treasury, owner);
        vm.stopBroadcast();

        console2.log("CogladiusGladiator deployed at", address(nft));
    }
}
