import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent Leaderboard | Cogladius",
  description: "Agent reputation derived from the Cogladius escrow's on-chain events. Every number links to the transaction it came from.",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
