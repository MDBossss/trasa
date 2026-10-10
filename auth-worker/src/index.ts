// OAuth helper for Trasa: GitHub won't let a browser exchange an OAuth code
// (no CORS on github.com/login/oauth), so this worker does it. The GitHub App
// itself is created through the manifest flow, so nothing is pasted by hand.
export interface Env { CREDS: KVNamespace; APP_URL: string; ALLOWED_ORIGINS: string }

interface Creds { id: number; slug: string; client_id: string; client_secret: string; html_url: string }

const html = (body: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Trasa auth</title><body style="font:15px system-ui;max-width:560px;margin:60px auto;line-height:1.5">${body}`, { headers: { 'content-type': 'text/html; charset=utf-8' } })

const json = (data: unknown, origin: string | null, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(origin) } })

const cors = (origin: string | null): Record<string, string> => (origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' } : {})

function allowedOrigin(env: Env, origin: string | null) {
  if (!origin) return null
  const ok = env.ALLOWED_ORIGINS.split(',').some((o) => (o.endsWith('*') ? origin.startsWith(o.slice(0, -1)) : origin === o))
  return ok ? origin : null
}

async function tokenRequest(creds: Creds, body: Record<string, string>) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'trasa-auth' },
    body: JSON.stringify({ client_id: creds.client_id, client_secret: creds.client_secret, ...body }),
  })
  return (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; error_description?: string }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const origin = allowedOrigin(env, req.headers.get('origin'))
    const self = `${url.protocol}//${url.host}`
    const creds = (await env.CREDS.get('github', 'json')) as Creds | null

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) })

    // --- one-time setup: create the GitHub App from a manifest -------------
    if (url.pathname === '/') {
      if (creds) {
        return html(`<h2>Trasa auth je postavljen</h2><p>GitHub App: <a href="${creds.html_url}">${creds.slug}</a></p>
          <p>Ako app još nije instaliran na repo: <a href="${creds.html_url}/installations/new">Instaliraj na repo</a>.</p>
          <p>Zatim u Trasi klikni <b>Prijavi se GitHubom</b>.</p>`)
      }
      const manifest = {
        name: 'Trasa',
        url: env.APP_URL,
        redirect_url: `${self}/setup/callback`,
        callback_urls: [`${self}/callback`],
        setup_url: env.APP_URL,
        description: 'Spremanje Trasa projekata u GitHub repo',
        public: false,
        default_permissions: { contents: 'write', metadata: 'read' },
        request_oauth_on_install: true,
      }
      return html(`<h2>Trasa auth: prvi korak</h2>
        <p>Klik registrira GitHub App "Trasa" na tvom računu (pravo samo <b>Contents: write</b>). GitHub te vraća ovdje, a odmah zatim na instalaciju na repo.</p>
        <form method="post" action="https://github.com/settings/apps/new?state=trasa">
          <input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, '&#39;')}'>
          <button style="font:inherit;padding:10px 18px">Create GitHub App</button>
        </form>`)
    }

    if (url.pathname === '/setup/callback') {
      const code = url.searchParams.get('code')
      if (!code) return html('<p>Nedostaje code.</p>')
      const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'trasa-auth' } })
      if (!res.ok) return html(`<p>GitHub je odbio pretvorbu manifesta: ${res.status} ${await res.text()}</p>`)
      const app = (await res.json()) as Creds
      await env.CREDS.put('github', JSON.stringify({ id: app.id, slug: app.slug, client_id: app.client_id, client_secret: app.client_secret, html_url: app.html_url }))
      return Response.redirect(`${app.html_url}/installations/new`, 302)
    }

    if (!creds) return html(`<p>Auth još nije postavljen. <a href="/">Postavi</a>.</p>`)

    // public app info for the client (install link on "not accessible by integration")
    if (url.pathname === '/app') return json({ slug: creds.slug, html_url: creds.html_url, install_url: `${creds.html_url}/installations/new` }, origin ?? '*')

    // --- login ---------------------------------------------------------------
    if (url.pathname === '/login') {
      const ret = url.searchParams.get('return') ?? env.APP_URL
      if (!allowedOrigin(env, new URL(ret).origin)) return html('<p>Nedopušten return URL.</p>')
      const auth = new URL('https://github.com/login/oauth/authorize')
      auth.searchParams.set('client_id', creds.client_id)
      auth.searchParams.set('redirect_uri', `${self}/callback`)
      auth.searchParams.set('state', ret)
      return Response.redirect(auth.toString(), 302)
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code')
      const ret = url.searchParams.get('state') ?? env.APP_URL
      if (!code || !allowedOrigin(env, new URL(ret).origin)) return html('<p>Neispravan povratak s GitHuba.</p>')
      const tok = await tokenRequest(creds, { code, redirect_uri: `${self}/callback` })
      if (!tok.access_token) return html(`<p>GitHub nije dao token: ${tok.error_description ?? tok.error}</p>`)
      const payload = { access_token: tok.access_token, refresh_token: tok.refresh_token ?? null, expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null }
      const target = new URL(ret)
      target.hash = `gh=${encodeURIComponent(btoa(JSON.stringify(payload)))}`
      return Response.redirect(target.toString(), 302)
    }

    if (url.pathname === '/refresh' && req.method === 'POST') {
      if (!origin) return json({ error: 'origin' }, null, 403)
      const { refresh_token } = (await req.json()) as { refresh_token?: string }
      if (!refresh_token) return json({ error: 'refresh_token' }, origin, 400)
      const tok = await tokenRequest(creds, { grant_type: 'refresh_token', refresh_token })
      if (!tok.access_token) return json({ error: tok.error_description ?? tok.error ?? 'refresh failed' }, origin, 401)
      return json({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? refresh_token, expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null }, origin)
    }

    return new Response('not found', { status: 404 })
  },
}
