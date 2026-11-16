// Yomi share links. The app uploads the finished picture card with a few words about it (POST /new) and gets a short
// code back; /<code> is the page chat apps read to draw a clickable card, /<code>.jpg is the picture.

const APP_PAGE = 'https://hmodymac8-droid.github.io/yomi/'
const DOWNLOAD = 'https://github.com/hmodymac8-droid/yomi/releases/latest'
const YEAR = 60 * 60 * 24 * 365
const MAX_IMG = 2 * 1024 * 1024
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clip = (s, n) => (typeof s === 'string' ? s : '').slice(0, n)

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(7))
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('')
}

// Keeps the free storage safe: a few links per person per hour, and a daily cap for everyone.
const PER_IP_HOUR = 12
const PER_DAY = 200
async function tooMany(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'x'
  const now = Date.now()
  const hk = `r:${ip}:${Math.floor(now / 3600000)}`
  const dk = `d:${Math.floor(now / 86400000)}`
  const [h, d] = await Promise.all([env.SHARES.get(hk), env.SHARES.get(dk)])
  if ((parseInt(h, 10) || 0) >= PER_IP_HOUR || (parseInt(d, 10) || 0) >= PER_DAY) return true
  await Promise.all([
    env.SHARES.put(hk, String((parseInt(h, 10) || 0) + 1), { expirationTtl: 7200 }),
    env.SHARES.put(dk, String((parseInt(d, 10) || 0) + 1), { expirationTtl: 172800 })
  ])
  return false
}

async function create(req, env) {
  if (req.headers.get('x-yomi') !== 'app') return new Response('forbidden', { status: 403 })
  let form
  try {
    form = await req.formData()
  } catch {
    return new Response('bad request', { status: 400 })
  }
  const img = form.get('img')
  if (String(form.get('meta') || '').length > 2000) return new Response('bad request', { status: 400 })
  let meta
  try {
    meta = JSON.parse(String(form.get('meta') || '{}'))
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!img || typeof img === 'string' || img.size === 0 || img.size > MAX_IMG || img.type !== 'image/jpeg') return new Response('bad image', { status: 400 })
  const head = new Uint8Array(await img.slice(0, 3).arrayBuffer())
  if (head[0] !== 0xff || head[1] !== 0xd8) return new Response('bad image', { status: 400 })
  if (await tooMany(req, env)) return new Response('slow down', { status: 429 })
  const clean = {
    t: clip(meta.t, 120) || 'a series',
    r: clip(meta.r, 60),
    n: Math.max(0, Math.min(99999, parseInt(meta.n, 10) || 0)),
    g: clip(meta.g, 120)
  }
  let id = newId()
  for (let i = 0; i < 5 && (await env.SHARES.get('m:' + id)); i++) id = newId()
  await env.SHARES.put('m:' + id, JSON.stringify(clean), { expirationTtl: YEAR })
  await env.SHARES.put('i:' + id, await img.arrayBuffer(), { expirationTtl: YEAR })
  return Response.json({ id, url: new URL('/' + id, req.url).href })
}

function page(origin, id, m) {
  const head = m.r ? `I'm on ${m.r}${m.n ? ` of ${m.n}` : ''}` : m.n ? `${m.n} chapters` : ''
  const desc = [head, m.g.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 3).join(' · ')].filter(Boolean).join(' · ') || 'Read it free on Yomi'
  const img = `${origin}/${id}.jpg`
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.t)} on Yomi</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Yomi · free manga reader for Windows">
<meta property="og:title" content="${esc(m.t)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + '/' + id)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#dcbc33">
<style>
:root{color-scheme:dark light;--bg:#16150f;--fg:#f4f1e4;--muted:#b9b4a0;--accent:#dcbc33}
@media(prefers-color-scheme:light){:root{--bg:#faf7ea;--fg:#26241a;--muted:#6b6652}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,"Segoe UI",sans-serif}
main{max-width:420px;width:100%;text-align:center}img{width:100%;height:auto;border-radius:16px}
p{color:var(--muted);margin:16px 0 20px}
a.btn{display:inline-block;padding:14px 26px;border-radius:12px;background:var(--accent);color:#26241a;font-weight:700;text-decoration:none}
small{display:block;margin-top:18px;color:var(--muted)}small a{color:inherit}
</style></head><body><main>
<img src="${esc(img)}" alt="${esc(m.t)}">
<p>Read it free on Yomi, all your manga sites in one ad-free reader.</p>
<a class="btn" href="${DOWNLOAD}">Download Yomi for Windows</a>
<small><a href="${APP_PAGE}">What is Yomi?</a></small>
</main></body></html>`
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/new') return create(req, env)
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 })
    const m = url.pathname.match(/^\/([a-z0-9]{7})(\.jpg)?$/)
    if (!m) return Response.redirect(APP_PAGE, 302)
    if (m[2]) {
      const buf = await env.SHARES.get('i:' + m[1], 'arrayBuffer')
      if (!buf) return new Response('not found', { status: 404 })
      return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } })
    }
    const meta = await env.SHARES.get('m:' + m[1], 'json')
    if (!meta) return Response.redirect(APP_PAGE, 302)
    return new Response(page(url.origin, m[1], meta), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
  }
}
