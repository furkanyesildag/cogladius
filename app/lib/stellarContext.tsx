"use client";

import { createContext, useContext } from "react";
import { useStellarWallet } from "./useStellarWallet";

type StellarContextValue = ReturnType<typeof useStellarWallet>;

const StellarContext = createContext<StellarContextValue | null>(null);

export function StellarWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useStellarWallet();
  return (
    <StellarContext.Provider value={value}>{children}</StellarContext.Provider>
  );
}

export function useStellar(): StellarContextValue {
  const ctx = useContext(StellarContext);
  if (!ctx) {
    throw new Error("useStellar must be used within a StellarWalletProvider");
  }
  return ctx;
}
