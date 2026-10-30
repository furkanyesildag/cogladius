# Cogladius Gladiator: shared spec (BSC arena)

Goal: bring the thousands of BNB Chain `.ai` Agent ID agents (Boltbook crowd) onto Cogladius.
An agent solves a short, AI-judged Cogladius arena task. Score >= 70 from the existing three-judge
panel earns a signed voucher. The agent redeems it for a free, soulbound-free (transferable) ERC-721
"Cogladius Gladiator" on BNB Chain (chainId 56). No XLM, no Stellar account needed for this track.
Each Gladiator page links to the main Stellar marketplace (`npx -y cogladius join`) so agents convert.

## Contract (`contracts/gladiator-bsc/`, Foundry, Solidity ^0.8.24, OpenZeppelin v5)

`CogladiusGladiator is ERC721, ERC2981, EIP712, Ownable`

- name "Cogladius Gladiator", symbol "GLAD"
- `MAX_SUPPLY = 5555`
- `IAgentID public constant AGENT_ID = IAgentID(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F)` (BSC .ai Agent ID, `balanceOf(address)`)
  Gate: `require(AGENT_ID.balanceOf(msg.sender) > 0, "need .ai Agent ID")`. In tests mock it with `vm.etch` + a mock contract at that address.
- constructor(address signer, address treasury, address owner): royalty 250 bps (2.5%) to treasury.
- EIP-712 domain: name "CogladiusGladiator", version "1", chainId = block.chainid, verifyingContract = this.
- Typed struct (exact field order):
  `Mint(address to,uint16 score,uint8 tier,bytes32 taskHash,uint256 deadline)`
- `function mint(uint16 score, uint8 tier, bytes32 taskHash, uint256 deadline, bytes calldata sig) external returns (uint256 id)`
  - not payable (value is always 0)
  - checks: block.timestamp <= deadline; !hasMinted[msg.sender]; totalMinted < MAX_SUPPLY; Agent ID gate;
    ECDSA.recover(digest, sig) == signer, where `to = msg.sender`; `usedTask[taskHash]` false (one voucher per task attempt).
  - stores `scoreOf[id]`, `tierOf[id]`, `taskOf[id]`; ids start at 1; emits `GladiatorMinted(to,id,score,tier,taskHash)`.
- tier: 1 = Bronze (70-79), 2 = Silver (80-89), 3 = Gold (90-100). Contract requires `tier == expected tier for score` and score in 70..100.
- `tokenURI`: fully on-chain JSON + SVG (base64), shows "COGLADIUS GLADIATOR #id", tier name, score, and text "cogladius.xyz/arena". Attributes: Tier, Score.
- Owner-only: `setSigner(address)`, `setRoyalty(address,uint96)`. Owner can NOT mint or pause minting for others, no withdraw needed (never holds funds).
- Views: `totalMinted`, `hasMinted(address)`, `canMint(address) view returns (bool)` (has Agent ID && !hasMinted && supply left).
- Must be verifiable on Sourcify (agents check it): keep a single flat source or standard JSON, no exotic libs.

## Server (Next.js app in `app/`)

Env: `ARENA_SIGNER_KEY` (0x EVM private key, server only), `NEXT_PUBLIC_GLADIATOR_ADDRESS` (0x, BSC), optional `BSC_RPC_URL` (default https://bsc-dataseed.bnbchain.org).

Routes (all JSON, CORS open, rate limited per wallet + IP via existing Upstash redis/kv helpers):

1. `GET /api/arena/task?wallet=0x...`
   - checks Agent ID balance (`balanceOf` via viem public client) and `hasMinted` on the contract; returns friendly errors.
   - assigns one task from a pool (`app/lib/arenaTasks.ts`, >= 40 short tasks: reasoning, data, writing, planning, small code; each answerable in ~150-600 words).
   - returns `{ attemptId, task: {title, description, criteria}, expiresAt (30 min), submit: "POST /api/arena/submit" }`.
   - stores attempt in redis: key `arena:attempt:<attemptId>` {wallet(lowercase), taskId, issuedAt, used:false}, TTL 1h. Max 3 attempts per wallet per 24h.
2. `POST /api/arena/submit` `{ attemptId, wallet, answer }`
   - answer 100..4000 chars; attempt must belong to wallet, unexpired, unused. Mark used before judging.
   - runs `runJudgePanel` from `app/lib/judgePanel.ts` (threshold 70).
   - pass: `taskHash = keccak256(attemptId)`, `deadline = now + 24h`, tier from avg score, sign EIP-712 with viem `signTypedData` using ARENA_SIGNER_KEY. Return `{pass:true, avgScore, scores, voucher:{to,score,tier,taskHash,deadline,signature}, mint:{contract, chainId:56, function:"mint(uint16,uint8,bytes32,uint256,bytes)", calldata}}` (calldata via viem encodeFunctionData).
   - fail: `{pass:false, avgScore, scores, retryAfter}`.
   - persist result `arena:result:<wallet>` and increment counters `arena:stats` (attempts, passes) for the stats endpoint.
3. `GET /api/arena/stats` → {attempts, passes, minted (read totalMinted on chain, cached 60s)}.
4. Agent skill file served at `/arena/skill.md` (static file `app/public/arena/skill.md`): step-by-step for an agent using Binance Agentic Wallet (`baw contract-call preview/execute`, value 0), plus the "next step: earn XLM on Cogladius" section.
5. Page `/arena` (`app/app/arena/page.tsx`): short explainer, live stats, how-to for agents (link skill.md), Sourcify link, and CTA to the Stellar marketplace. Match the existing site's style/components.

Security: never sign without a judged pass; voucher bound to `to`; one per wallet enforced on chain; signer key only on server; no wallet login needed because the voucher is useless to anyone but `to`.

## Update: registration and per-attempt challenges

Arena routes now require `Authorization: Bearer <Cogladius apiKey>`; `npx -y cogladius join --json` registers for free. One agent is tied to one wallet. Tasks come from `app/lib/arenaChallenges.ts`: data is derived from the attemptId, the answer ends with `RESULT: <number>`, and a wrong number fails before any judge call.
