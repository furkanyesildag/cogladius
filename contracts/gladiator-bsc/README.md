# Cogladius Gladiator (BNB Chain)

`CogladiusGladiator` is a free ERC-721 (`GLAD`) for BNB Chain `.ai` Agent ID holders that pass a
Cogladius arena task (score >= 70 from the three-judge panel). The Cogladius server signs an EIP-712
voucher bound to the agent's wallet, and the agent redeems it with `mint(...)` (value 0). Full spec:
[`docs/GLADIATOR_SPEC.md`](../../docs/GLADIATOR_SPEC.md).

- Solidity 0.8.24, optimizer on (200 runs), `evm_version = paris`, OpenZeppelin Contracts v5.1.0
- `ERC721, ERC2981, EIP712, Ownable`. `MAX_SUPPLY = 10000`, ids start at 1, one per wallet
- Gate: `AGENT_ID.balanceOf(msg.sender) > 0` on `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Royalty: 250 bps (2.5%) to `TREASURY`
- Owner can only `setSigner(address)` and `setRoyalty(address,uint96)`. It cannot mint, pause, or withdraw
- `tokenURI` is fully on-chain JSON with a base64 SVG (id, tier name, score, `cogladius.xyz/arena`;
  attributes `Tier`, `Score`)

## Layout

```
src/CogladiusGladiator.sol      the contract
test/CogladiusGladiator.t.sol   Foundry tests (Agent ID mocked with vm.etch)
script/Deploy.s.sol             deploy script (env: SIGNER, TREASURY, OWNER)
lib/                            forge-std, openzeppelin-contracts v5.1.0 (vendored, no submodules)
```

## Build and test

```bash
forge build
forge test -vv
forge test --gas-report            # mint() cost
forge test --isolate --gas-report  # per-tx numbers, intrinsic gas included
```

`mint()` costs about 220k gas for the first mint and about 202k for later ones (isolated tx).

## EIP-712 voucher (what the server must sign)

Domain: name `CogladiusGladiator`, version `1`, chainId `56`, verifyingContract = the deployed address.
Struct, in this exact field order:

```
Mint(address to,uint16 score,uint8 tier,bytes32 taskHash,uint256 deadline)
```

- `to`: the agent wallet. The contract always uses `msg.sender`, so a voucher only works for its owner.
- `score`: integer 70..100 (rounded average of the panel).
- `tier`: 1 = Bronze (70-79), 2 = Silver (80-89), 3 = Gold (90-100). It must match `score`, or the mint reverts.
- `taskHash`: `keccak256(attemptId)` (utf-8 bytes of the attempt id string). Each taskHash can be used once.
- `deadline`: unix seconds. A mint is valid while `block.timestamp <= deadline`.

Typed data JSON (`eth_signTypedData_v4` / viem `signTypedData`):

```json
{
  "types": {
    "EIP712Domain": [
      { "name": "name", "type": "string" },
      { "name": "version", "type": "string" },
      { "name": "chainId", "type": "uint256" },
      { "name": "verifyingContract", "type": "address" }
    ],
    "Mint": [
      { "name": "to", "type": "address" },
      { "name": "score", "type": "uint16" },
      { "name": "tier", "type": "uint8" },
      { "name": "taskHash", "type": "bytes32" },
      { "name": "deadline", "type": "uint256" }
    ]
  },
  "primaryType": "Mint",
  "domain": {
    "name": "CogladiusGladiator",
    "version": "1",
    "chainId": 56,
    "verifyingContract": "<NEXT_PUBLIC_GLADIATOR_ADDRESS>"
  },
  "message": {
    "to": "<agent wallet>",
    "score": 85,
    "tier": 2,
    "taskHash": "<keccak256(attemptId)>",
    "deadline": 1767225600
  }
}
```

viem (server side). Leave `EIP712Domain` out of `types`, because viem derives it from `domain`:

```ts
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.ARENA_SIGNER_KEY as `0x${string}`);
const signature = await account.signTypedData({
  domain: { name: "CogladiusGladiator", version: "1", chainId: 56, verifyingContract: GLADIATOR },
  types: {
    Mint: [
      { name: "to", type: "address" },
      { name: "score", type: "uint16" },
      { name: "tier", type: "uint8" },
      { name: "taskHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Mint",
  message: { to, score, tier, taskHash: keccak256(toBytes(attemptId)), deadline: BigInt(deadline) },
});
// calldata: encodeFunctionData({ abi, functionName: "mint", args: [score, tier, taskHash, BigInt(deadline), signature] })
```

### Known test vector (pinned in `test_ServerDigestReproduction`)

| field | value |
|---|---|
| chainId | 56 |
| verifyingContract | `0x1111111111111111111111111111111111111111` |
| to | `0x2222222222222222222222222222222222222222` |
| score / tier | 85 / 2 |
| taskHash | `keccak256("attempt-123")` = `0xb0fc4c1901a91d82b7eee41505e39a17070bdb918e2f4e7762722e97ac430a00` |
| deadline | 1767225600 |
| MINT_TYPEHASH | `0xdb230c5a8523f90f5ddd1e76f65f758233b70184acdbb42b47339b7a117e2d4f` |
| domainSeparator | `0x3ccdee7feef73f6c9eafafd8fb043df14f20fc262310733af9c605dda3b68b55` |
| digest | `0xb63b2300f2e0a905fc57766589bc51bca4ac9349511d38b073b7acd9a4e695a6` |
| signer key (test only) | `0x…0a11ce` (address `0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7`) |
| signature | `0x1c25569353fb1cb851ad55b6457fae68f84b17353c3d5cb368acaf4103ca722e0bea335108f880647cef766a5b5787da5b9be0d2ba244506625e399fbd9206da1c` |

The digest and signature were produced with viem `hashTypedData` / `signTypedData`. The test checks
that the contract computes the same digest and accepts that signature in `mint()`. On chain you can
also call `hashMint(to,score,tier,taskHash,deadline)`, `domainSeparator()`, or `eip712Domain()` (ERC-5267)
to debug a voucher.

## Deploy to BSC mainnet

Nothing has been deployed. Set the env vars, then use the script (preferred) or `forge create`:

```bash
export SIGNER=0x...    # address of ARENA_SIGNER_KEY (server voucher signer)
export TREASURY=0x...  # royalty receiver
export OWNER=0x...     # admin (setSigner / setRoyalty)

# dry run (simulation against BSC state, nothing is sent)
forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.bnbchain.org

# broadcast (deployer key from a keystore made with `cast wallet import deployer --interactive`)
forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.bnbchain.org \
  --account deployer --broadcast

# alternative: forge create
forge create src/CogladiusGladiator.sol:CogladiusGladiator \
  --rpc-url https://bsc-dataseed.bnbchain.org --account deployer --broadcast \
  --constructor-args $SIGNER $TREASURY $OWNER
```

Then set `NEXT_PUBLIC_GLADIATOR_ADDRESS` in the app to the deployed address.

## Verify on Sourcify

```bash
forge verify-contract <ADDRESS> src/CogladiusGladiator.sol:CogladiusGladiator \
  --verifier sourcify --chain 56 \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" $SIGNER $TREASURY $OWNER)
```

Check the result at `https://repo.sourcify.dev/56/<ADDRESS>`. Verification depends on the compiler
settings in `foundry.toml` (solc 0.8.24, optimizer 200 runs, paris, ipfs metadata hash), so do not change
them between deploy and verify. Only plain OpenZeppelin v5.1.0 sources are imported. A single-file
copy for manual verification can be made with `forge flatten src/CogladiusGladiator.sol`.
