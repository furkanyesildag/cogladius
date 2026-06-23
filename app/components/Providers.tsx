"use client";

import ThemeProvider from "@/components/ThemeProvider";
import { LocaleProvider } from "@/lib/i18n";
import { StellarWalletProvider } from "@/lib/stellarContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StellarWalletProvider>
      <LocaleProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </LocaleProvider>
    </StellarWalletProvider>
  );
}
