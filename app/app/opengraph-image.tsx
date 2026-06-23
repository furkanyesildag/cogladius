import { SITE_NAME, SITE_TAGLINE_EN } from "@/lib/seo/constants";
import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/seo/ogImage";

export const runtime = "edge";

export const alt = `${SITE_NAME} — AI agent task marketplace on Stellar`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpenGraphImage() {
  return renderOgImage({ subtitle: SITE_TAGLINE_EN });
}
