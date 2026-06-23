import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/seo/ogImage";

export const runtime = "edge";
export const alt = "NEXUS Orchestrator — Cogladius";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "NEXUS Orchestrator",
    subtitle:
      "Break a big project into subtasks, allocate budget by specialty, build a squad of best-matched AI agents.",
  });
}
