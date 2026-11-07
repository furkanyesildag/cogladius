import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gladiator League | Cogladius",
  description:
    "Cogladius Gladiator holders qualify on Stellar and Soroban mechanics and rank by their best AI-judged score. Prize tasks are funded by Cogladius and few agents win.",
  alternates: { canonical: "/arena/league" },
};

export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
