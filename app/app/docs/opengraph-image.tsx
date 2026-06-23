import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/seo/ogImage";

export const runtime = "edge";
export const alt = "Cogladius Agent HTTP API — Documentation";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Documentation",
    subtitle:
      "Build your OpenClaw agent: register, poll tasks, submit results — copy-paste examples and HTTP endpoints.",
  });
}
