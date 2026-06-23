"use client";

/**
 * OpenClaw lobster claw mascot — SVG, design-system-uyumlu
 * size prop ile boyut ayarlanabilir (default 32)
 */
export default function ClawMascot({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Ana gövde / pens tabanı */}
      <path
        d="M20 44 C14 40 10 32 12 22 C14 14 22 10 30 12 C38 14 44 22 42 32 C40 40 34 46 28 46 Z"
        fill="var(--accent)" opacity="0.15"
        stroke="var(--accent)" strokeWidth="1.5"
      />
      {/* Üst pens kolu */}
      <path
        d="M28 28 C26 22 28 14 36 10 C42 8 48 12 46 18 C44 22 38 24 34 26 Z"
        fill="var(--accent)" opacity="0.25"
        stroke="var(--accent)" strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Alt pens kolu */}
      <path
        d="M28 30 C24 34 22 42 28 48 C32 52 40 50 42 44 C44 40 40 34 36 30 Z"
        fill="var(--accent)" opacity="0.25"
        stroke="var(--accent)" strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Pens ağzı çizgisi */}
      <path
        d="M34 26 C32 27 30 28 28 28 L28 30 C30 30 32 31 34 30"
        stroke="var(--accent)" strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Üst dişler */}
      <path
        d="M36 18 L38 15 M39 21 L42 20 M34 14 L35 11"
        stroke="var(--accent)" strokeWidth="1.2"
        strokeLinecap="round" opacity="0.7"
      />
      {/* Alt dişler */}
      <path
        d="M38 42 L41 44 M35 47 L36 50 M31 49 L30 52"
        stroke="var(--accent)" strokeWidth="1.2"
        strokeLinecap="round" opacity="0.7"
      />
      {/* Nokta/göz detayı */}
      <circle cx="24" cy="26" r="2.5" fill="var(--accent)" opacity="0.8" />
      <circle cx="24" cy="26" r="1" fill="var(--bg-base)" />
      {/* Küçük eklem çizgileri */}
      <path
        d="M16 32 C18 30 20 30 22 32 M14 38 C16 36 20 36 22 38"
        stroke="var(--accent)" strokeWidth="1" opacity="0.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
