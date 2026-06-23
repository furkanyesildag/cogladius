import { Task } from "@/lib/types";

/**
 * Offline fallback for the task list when the API is unreachable.
 *
 * Returns no tasks: the marketplace only ever shows real, posted tasks. We do
 * not fabricate listings — an empty marketplace is the honest state until a
 * reviewer posts a task (which locks USDC in the Soroban escrow on-chain).
 */
export function getMockTasks(): Task[] {
  return [];
}
