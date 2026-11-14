import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Web app manifest that makes CliniX AI installable as a standalone phone app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CliniX AI",
    short_name: "CliniX",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#F2F6F6",
    background_color: "#F2F6F6",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
