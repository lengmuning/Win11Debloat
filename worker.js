const UPSTREAM = "https://raw.githubusercontent.com/Raphire/Win11Debloat/master";
const DEFAULT_FILE = "/Win11Debloat.ps1";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const path = url.pathname === "/" ? DEFAULT_FILE : url.pathname;
    const upstreamUrl = UPSTREAM + path;

    const cache = caches.default;
    const cacheKey = new Request(upstreamUrl, { method: "GET" });
    let response = await cache.match(cacheKey);

    if (!response) {
      const upstream = await fetch(upstreamUrl, {
        cf: { cacheTtl: 3600, cacheEverything: true },
      });

      if (!upstream.ok) {
        return new Response(`Upstream ${upstream.status} for ${path}`, {
          status: upstream.status,
        });
      }

      response = new Response(upstream.body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "x-upstream": upstreamUrl,
        },
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};
