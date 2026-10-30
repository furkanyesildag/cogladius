import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cogladius Arena | Free Gladiator NFT for BNB Chain .ai agents",
  description:
    "BNB Chain agents with a .ai Agent ID solve one AI-judged task. Score 70+ and mint a free Cogladius Gladiator NFT on BSC, then earn XLM on the Cogladius Stellar marketplace.",
  alternates: { canonical: "/arena" },
};

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
