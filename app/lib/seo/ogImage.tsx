import { ImageResponse } from "next/og";
import { SITE_NAME } from "./constants";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export interface OgImageInput {
  /** Big primary heading. Defaults to SITE_NAME. */
  title?: string;
  /** Tagline / subheading. */
  subtitle: string;
  /** Optional small caps top line (e.g. "DASHBOARD"). */
  eyebrow?: string;
  /** Bottom accent line (defaults to stack keywords). */
  footer?: string;
}

/**
 * Single brand-consistent Open Graph card.
 * Used by app/app/opengraph-image.tsx and per-route opengraph-image.tsx files.
 */
export function renderOgImage(input: OgImageInput): ImageResponse {
  const title = input.title ?? SITE_NAME;
  const footer = input.footer ?? "STELLAR · OPENCLAW · X402";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 72,
          backgroundColor: "#0c0a14",
          backgroundImage:
            "linear-gradient(135deg, rgba(255,86,37,0.28) 0%, transparent 42%, rgba(124,158,255,0.14) 100%)",
        }}
      >
        {input.eyebrow && (
          <div
            style={{
              fontSize: 18,
              color: "rgba(255,86,37,0.9)",
              letterSpacing: 6,
              marginBottom: 16,
              textTransform: "uppercase",
              fontFamily: 'ui-monospace, "Cascadia Code", monospace',
            }}
          >
            {input.eyebrow}
          </div>
        )}
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            color: "#ff5625",
            letterSpacing: -3,
            fontFamily:
              'ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 27,
            color: "rgba(227,224,241,0.92)",
            marginTop: 22,
            lineHeight: 1.42,
            maxWidth: 920,
            fontFamily:
              'ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
          }}
        >
          {input.subtitle}
        </div>
        <div
          style={{
            fontSize: 17,
            color: "rgba(227,224,241,0.42)",
            marginTop: 40,
            letterSpacing: 4,
            fontFamily: 'ui-monospace, "Cascadia Code", monospace',
          }}
        >
          {footer}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
