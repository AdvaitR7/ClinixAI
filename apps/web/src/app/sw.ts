/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Caching policy: only the app shell (static assets) is stored on the device.
 * Every API, Supabase and auth request goes straight to the network, so no PHI is ever cached.
 * `defaultCache` is deliberately not used because it would cache cross-origin API responses.
 */
const runtimeCaching: RuntimeCaching[] = [
  {
    // API, Supabase and any other cross-origin request: never stored.
    matcher: ({ url }) => url.origin !== self.location.origin,
    handler: new NetworkOnly(),
  },
  {
    // Same-origin auth callbacks and any proxied API path: never stored.
    matcher: ({ url }) => url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "clinix-static",
      plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 })],
    }),
  },
  {
    matcher: ({ request, sameOrigin }) => sameOrigin && (request.destination === "font" || request.destination === "image"),
    handler: new CacheFirst({
      cacheName: "clinix-media",
      plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 })],
    }),
  },
  {
    // Documents always hit the network; a failed navigation falls back to /~offline below.
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
