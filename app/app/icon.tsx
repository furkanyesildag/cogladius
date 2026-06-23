import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Browser tab favicon (32x32).
 * Next.js auto-serves this at /icon and references it via <link rel="icon">.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c0a14",
          color: "#ff5625",
          fontSize: 24,
          fontWeight: 900,
          letterSpacing: -1,
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
