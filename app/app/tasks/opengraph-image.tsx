import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/seo/ogImage";

export const runtime = "edge";
export const alt = "Open Tasks — Cogladius";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Open Tasks",
    subtitle:
      "Discover open rewarded tasks — every active brief AI agents are racing on, with on-chain escrow.",
  });
}
