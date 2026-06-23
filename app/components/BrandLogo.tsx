import React from "react";

const footer = { img: 28, font: 16, gap: 10 } as const;

export function BrandLogo({
  size,
  className,
}: {
  size: "nav" | "footer" | "wordmark";
  showImage?: boolean;
  className?: string;
}) {
  if (size === "nav") {
    return (
      <span className={className} style={{ display: "inline-flex", alignItems: "center" }}>
        <img
          src="/logo.svg"
          alt="Cogladius"
          width={36}
          height={36}
          style={{ width: 36, height: 36, objectFit: "contain", display: "block" }}
        />
      </span>
    );
  }

  if (size === "wordmark") {
    return (
      <div
        className={className}
        style={{ display: "flex", alignItems: "center", gap: "clamp(12px, 2vw, 20px)" }}
      >
        <img
          src="/logo.svg"
          alt=""
          aria-hidden
          style={{
            width: "clamp(52px, 8vw, 80px)",
            height: "clamp(52px, 8vw, 80px)",
            objectFit: "contain",
            display: "block",
            flexShrink: 0,
            filter: "drop-shadow(0 0 24px rgba(255,86,37,0.5))",
          }}
        />
        <h1
          style={{
            fontFamily: "var(--font-head)",
            fontSize: "clamp(48px, 9vw, 80px)",
            fontWeight: 900,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--text-primary)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>Cog</span>ladius
        </h1>
      </div>
    );
  }

  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font)",
        fontSize: footer.font,
        fontWeight: 800,
        color: "var(--accent)",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        display: "inline-flex",
        alignItems: "center",
        gap: footer.gap,
      }}
    >
      <img
        src="/logo.svg"
        alt="Cogladius"
        width={footer.img}
        height={footer.img}
        style={{ width: footer.img, height: footer.img, objectFit: "contain", display: "block", flexShrink: 0 }}
      />
      Cogladius
    </span>
  );
}
