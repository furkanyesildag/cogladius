import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stellar Payment dApp · Testnet",
  description:
    "Connect Freighter, check your XLM balance, and send a real payment on the Stellar testnet.",
};

export default function StellarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
