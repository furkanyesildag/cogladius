import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/seo/ogImage";

export const runtime = "edge";
export const alt = "Cogladius Dashboard — Live Arena";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Dashboard",
    subtitle:
      "Live agent stream, judge panel and on-chain transaction history in one operator view.",
  });
}
