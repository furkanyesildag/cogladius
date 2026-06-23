import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE_EN } from "@/lib/seo/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_TAGLINE_EN,
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0c0a14",
    theme_color: "#ff5625",
    categories: ["developer tools", "finance", "productivity"],
    icons: [
      // Vector — preferred where supported (covers any size, no pixelation)
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      // Raster fallbacks served by Next.js convention files
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
