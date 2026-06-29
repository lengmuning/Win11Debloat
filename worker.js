const REPO = "Raphire/Win11Debloat";
const BRANCH = "master";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const ZIP_URL = `https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`;

const BOOTSTRAP_TEMPLATE = `# Win11Debloat bootstrap (served from Cloudflare Worker)
# Downloads the full repository to a temp dir and runs Win11Debloat.ps1 from there,
# because the script depends on sibling files (Config/, Scripts/, Regfiles/, Assets/).
# The zip is fetched via the same Worker origin so the entire chain stays on Cloudflare
# (avoids direct GitHub access being throttled/blocked on some networks).

$ErrorActionPreference = 'Stop'

# Force TLS 1.2+ on Windows PowerShell 5.x (PowerShell 7+ ignores this).
try {
    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$tmpRoot = Join-Path $env:TEMP ("Win11Debloat-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$zip = Join-Path $tmpRoot "src.zip"

Write-Host "Downloading Win11Debloat..." -ForegroundColor Cyan
try {
    $oldProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri "__ZIP_URL__" -OutFile $zip -UseBasicParsing
} finally {
    $ProgressPreference = $oldProgress
}

Write-Host "Extracting..." -ForegroundColor Cyan
Expand-Archive -Path $zip -DestinationPath $tmpRoot -Force

$srcDir = Get-ChildItem -Path $tmpRoot -Directory | Where-Object { $_.Name -like "Win11Debloat-*" } | Select-Object -First 1
if (-not $srcDir) { throw "Could not locate extracted Win11Debloat directory under $tmpRoot" }

$scriptPath = Join-Path $srcDir.FullName "Win11Debloat.ps1"
if (-not (Test-Path $scriptPath)) { throw "Win11Debloat.ps1 not found at $scriptPath" }

Write-Host "Launching Win11Debloat..." -ForegroundColor Green
& $scriptPath @args
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Default: serve the bootstrap that downloads the full repo and runs the real script.
    if (url.pathname === "/" || url.pathname === "/bootstrap.ps1") {
      const zipUrl = `${url.origin}/zip`;
      const body = BOOTSTRAP_TEMPLATE.replace("__ZIP_URL__", zipUrl);
      return new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    // /zip → proxy the GitHub source zip (so corporate networks that block codeload still work via your domain)
    if (url.pathname === "/zip") {
      return fetch(ZIP_URL, { cf: { cacheTtl: 600, cacheEverything: true } });
    }

    // Anything else → proxy to raw.githubusercontent.com under the same repo path.
    return proxyRaw(RAW_BASE + url.pathname, ctx);
  },
};

async function proxyRaw(upstreamUrl, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl, { method: "GET" });
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(upstreamUrl, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!upstream.ok) {
    return new Response(`Upstream ${upstream.status} for ${upstreamUrl}`, {
      status: upstream.status,
    });
  }

  const response = new Response(upstream.body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-upstream": upstreamUrl,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
