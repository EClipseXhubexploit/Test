// ============================================
// LoadDrop - Cloudflare Worker
// Deploy di: https://workers.cloudflare.com
// ============================================
//
// CARA PAKE:
// 1. Paste worker ini di Cloudflare Workers
// 2. Di website LoadDrop, masukkan Worker URL lo
// 3. Script otomatis ke-protect
//
// Endpoint:
//   POST /upload          → upload script baru, return { id, url, loadstring }
//   GET  /script/:id      → serve script (executor) atau 403 (browser)
// ============================================

// KV Namespace: bind KV storage bernama SCRIPTS di dashboard Workers
// Settings → Variables → KV Namespace Bindings → name: SCRIPTS

const ALLOWED_UA = [
  "roblox", "httpget", "synapse", "krnl", "fluxus",
  "scriptware", "oxygen", "executor", "lua", "luau",
  "curl", "wget", "python-requests"
];

// ── HTML 403 ───────────────────────────────────────────────────────────────
const PAGE_403 = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>403 — Access Denied</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#080a0f;font-family:'Space Mono',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden}
  body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,59,92,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,59,92,0.04) 1px,transparent 1px);background-size:44px 44px;animation:gm 20s linear infinite}
  @keyframes gm{from{background-position:0 0}to{background-position:44px 44px}}
  .glow{position:fixed;width:500px;height:500px;background:radial-gradient(circle,rgba(255,59,92,0.08) 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none}
  .card{position:relative;z-index:1;text-align:center;padding:0 24px;display:flex;flex-direction:column;align-items:center;gap:20px}
  .lock{width:80px;height:80px;border:1px solid rgba(255,59,92,0.2);border-radius:20px;background:rgba(255,59,92,0.05);display:flex;align-items:center;justify-content:center;font-size:2rem;animation:lp 3s ease-in-out infinite;position:relative}
  .lock::before{content:'';position:absolute;inset:-1px;border-radius:20px;border:1px solid rgba(255,59,92,0.4);animation:lr 3s ease-in-out infinite}
  @keyframes lp{0%,100%{box-shadow:0 0 20px rgba(255,59,92,0.1)}50%{box-shadow:0 0 40px rgba(255,59,92,0.25)}}
  @keyframes lr{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.12);opacity:0}}
  .code{font-family:'Syne',sans-serif;font-size:clamp(5rem,20vw,10rem);font-weight:800;color:#111620;line-height:1;letter-spacing:-6px;user-select:none}
  .title{font-family:'Syne',sans-serif;font-size:clamp(1rem,3vw,1.3rem);font-weight:800;color:#ff3b5c;letter-spacing:4px;text-transform:uppercase}
  .div{width:40px;height:2px;background:rgba(255,59,92,0.3);border-radius:2px}
  .desc{font-size:0.75rem;color:#2d3748;line-height:2;max-width:300px}
  .desc strong{color:#4a5568;font-weight:400}
  body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);pointer-events:none;z-index:2}
</style>
</head>
<body>
<div class="glow"></div>
<div class="card">
  <div class="lock">🔒</div>
  <div class="code">403</div>
  <div class="title">Access Denied</div>
  <div class="div"></div>
  <p class="desc">Endpoint ini <strong>tidak dapat diakses</strong> melalui browser.<br>Gunakan executor untuk mengakses resource ini.</p>
</div>
</body>
</html>`;

// ── Helpers ────────────────────────────────────────────────────────────────
function genId(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function isBrowser(ua) {
  if (!ua || ua === '') return false;
  const lower = ua.toLowerCase();
  const browserKeywords = ['mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera', 'webkit'];
  const allowedKeywords = ALLOWED_UA;
  const isAllowed = allowedKeywords.some(k => lower.includes(k));
  const isBrow = browserKeywords.some(k => lower.includes(k));
  return isBrow && !isAllowed;
}

// ── Main ───────────────────────────────────────────────────────────────────
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // CORS headers untuk website upload bisa hit worker
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── POST /upload ─────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/upload') {
    try {
      const body = await request.json();
      const { content, name } = body;

      if (!content || content.trim() === '') {
        return new Response(JSON.stringify({ error: 'Content kosong' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const id = genId();
      const scriptName = name || `script_${id}.lua`;

      // Simpan ke KV
      await SCRIPTS.put(id, JSON.stringify({
        name: scriptName,
        content: content,
        createdAt: Date.now(),
      }));

      const rawUrl = `${url.origin}/script/${id}`;
      const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;

      return new Response(JSON.stringify({
        id,
        name: scriptName,
        url: rawUrl,
        loadstring,
        size: new TextEncoder().encode(content).length,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: 'Upload gagal: ' + e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── GET /script/:id ──────────────────────────────────────────────────────
  if (method === 'GET' && path.startsWith('/script/')) {
    const id = path.split('/')[2];
    if (!id) return new Response('Not Found', { status: 404 });

    const ua = request.headers.get('User-Agent') || '';

    // Browser → 403
    if (isBrowser(ua)) {
      return new Response(PAGE_403, {
        status: 403,
        headers: { 'Content-Type': 'text/html;charset=UTF-8', 'X-Robots-Tag': 'noindex' },
      });
    }

    // Executor → serve script
    const data = await SCRIPTS.get(id);
    if (!data) return new Response('Not Found', { status: 404 });

    const script = JSON.parse(data);
    return new Response(script.content, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain;charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response('Not Found', { status: 404 });
}
