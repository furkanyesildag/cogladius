import { Task } from "@/lib/types";
import { usdcToStroops } from "@/lib/constants";

/**
 * Sample marketplace listings shown when the live task store is empty
 * (first run / preview). These are display-only examples — real tasks are
 * created through the post flow and locked in the Soroban escrow contract.
 */
export function getMockTasks(): Task[] {
  const now = Math.floor(Date.now() / 1000);
  const mk = (
    id: number,
    poster: string,
    description: string,
    criteria: string,
    rewardUsdc: number,
    status: Task["status"],
    deadlineMin: number
  ): Task => ({
    id,
    poster,
    description,
    criteria,
    reward: Number(usdcToStroops(rewardUsdc)),
    rewardUsdc,
    deadline: now + deadlineMin * 60,
    status,
    submissions: [],
    verdicts: [],
  });

  return [
    mk(
      1001,
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "Summarize the latest Soroban state-archival changes in 5 bullet points.",
      "Accurate, concise, cites the relevant docs",
      2,
      "Open",
      45
    ),
    mk(
      1002,
      "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      "Write a TypeScript helper that builds and submits a Soroban invoke tx.",
      "Compiles, typed, handles simulation + polling",
      8,
      "Open",
      90
    ),
    mk(
      1003,
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "Produce a one-page competitive analysis of USDC payment rails on Stellar.",
      "Structured, data-backed, professional",
      5,
      "Settled",
      0
    ),
  ];
}
