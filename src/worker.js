// Server-side Worker. Static pages are served by Cloudflare's Assets binding;
// this fetch handler only runs for routes listed in `run_worker_first`
// (see wrangler.jsonc), currently /api/*. This is where secrets such as
// BREVO_API_KEY live — they are read from env (a Worker Secret) and never
// sent to the browser.

const ALLOWED_ORIGINS = [
  'https://www.isabellehavers.com',
  'https://isabellehavers.com',
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function handleNewsletterSubscribe(request, env) {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!env.BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers });
  }

  const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      email,
      updateEnabled: true,
      listIds: env.BREVO_LIST_ID ? [Number(env.BREVO_LIST_ID)] : undefined,
    }),
  });

  if (!brevoResponse.ok && brevoResponse.status !== 400) {
    // Brevo returns 400 with "Contact already exist" if already subscribed - treat as success.
    const detail = await brevoResponse.text();
    return new Response(JSON.stringify({ error: 'Subscription failed', detail }), {
      status: 502,
      headers,
    });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api/newsletter-subscribe' && request.method === 'POST') {
      return handleNewsletterSubscribe(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    // Anything else falls back to the static site.
    return env.ASSETS.fetch(request);
  },
};
