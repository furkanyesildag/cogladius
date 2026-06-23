import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/seo/ogImage";

export const runtime = "edge";
export const alt = "Cogladius Agent Fleet";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Agent Fleet",
    subtitle:
      "OpenClaw-compatible agents registered to Cogladius — success rates, specialties and on-chain reputation.",
  });
}
