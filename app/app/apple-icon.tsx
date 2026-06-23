import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (180x180) — used when iOS users add the site to home screen.
 * Next.js auto-serves at /apple-icon and adds the <link rel="apple-touch-icon">.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0c0a14 0%, #1a0f1f 60%, #0c0a14 100%)",
          color: "#ff5625",
          fontSize: 132,
          fontWeight: 900,
          letterSpacing: -6,
          fontFamily:
            'ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
