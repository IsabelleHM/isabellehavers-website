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

// ---------------------------------------------------------------------------
// Club Easy — Telegram-Zugang via CopeCart
// ---------------------------------------------------------------------------
//
// Zwei neue Routen:
//   POST /api/copecart-webhook  -> empfängt CopeCart IPN Events
//   POST /api/telegram-webhook  -> empfängt Telegram Bot Updates (chat_member)
//
// Benötigte Secrets (bereits als Cloudflare Secrets hinterlegt):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, COPECART_SECRET
//
// Benötigtes KV-Binding (bereits in wrangler.jsonc verknüpft):
//   CLUB_EASY_KV
//
// Gespeicherte Keys in KV:
//   invite:<invite_link_url>   -> { email }                (temporär, bis jemand beitritt)
//   member:<telegram_user_id>  -> email                    (dauerhaft, für Removal)
//   email:<email>              -> telegram_user_id          (Reverse-Lookup für Removal)

async function handleCopecartWebhook(request, env) {
  const rawBody = await request.text();

  const signatureHeader = request.headers.get('X-Copecart-Signature');
  const valid = await verifyCopecartSignature(rawBody, signatureHeader, env.COPECART_SECRET);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (env.COPECART_PRODUCT_ID && data.product_id !== env.COPECART_PRODUCT_ID) {
    return new Response('OK');
  }

  const email = data.buyer_email;
  const eventType = data.event_type;

  try {
    switch (eventType) {
      case 'payment.made':
        await grantAccess(email, env);
        break;
      case 'payment.refunded':
      case 'payment.charged_back':
        await revokeAccess(email, env);
        break;
      case 'payment.recurring.cancelled':
        // Zugang bleibt bis Periodenende, keine Aktion nötig hier
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Fehler bei der Verarbeitung:', err);
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK');
}

async function grantAccess(email, env) {
  const inviteLink = await createOneTimeInviteLink(env);

  await env.CLUB_EASY_KV.put(
    `invite:${inviteLink}`,
    JSON.stringify({ email }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  );

  await setTelegramLinkAttribute(email, inviteLink, env);
}

async function revokeAccess(email, env) {
  const userId = await env.CLUB_EASY_KV.get(`email:${email}`);
  if (!userId) return;

  await removeChannelMember(userId, env);

  await env.CLUB_EASY_KV.delete(`email:${email}`);
  await env.CLUB_EASY_KV.delete(`member:${userId}`);
}

async function handleTelegramWebhook(request, env) {
  const update = await request.json();

  const chatMemberUpdate = update.chat_member;
  if (!chatMemberUpdate) {
    return new Response('OK');
  }

  const newStatus = chatMemberUpdate.new_chat_member?.status;
  const isJoining = newStatus === 'member';
  const usedInviteLink = chatMemberUpdate.invite_link?.invite_link;

  if (isJoining && usedInviteLink) {
    const raw = await env.CLUB_EASY_KV.get(`invite:${usedInviteLink}`);
    if (raw) {
      const { email } = JSON.parse(raw);
      const userId = String(chatMemberUpdate.new_chat_member.user.id);

      await env.CLUB_EASY_KV.put(`member:${userId}`, email);
      await env.CLUB_EASY_KV.put(`email:${email}`, userId);
      await env.CLUB_EASY_KV.delete(`invite:${usedInviteLink}`);
    }
  }

  return new Response('OK');
}

async function createOneTimeInviteLink(env) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/createChatInviteLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
      }),
    }
  );

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram createChatInviteLink fehlgeschlagen: ${JSON.stringify(data)}`);
  }

  return data.result.invite_link;
}

async function removeChannelMember(userId, env) {
  const banRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/banChatMember`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, user_id: userId }),
    }
  );
  const banData = await banRes.json();
  if (!banData.ok) {
    throw new Error(`Telegram banChatMember fehlgeschlagen: ${JSON.stringify(banData)}`);
  }

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/unbanChatMember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, user_id: userId, only_if_banned: true }),
  });
}

async function verifyCopecartSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const generatedSignature = base64Encode(signatureBuffer);

  return generatedSignature === signatureHeader;
}

function base64Encode(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function setTelegramLinkAttribute(email, inviteLink, env) {
  // Trägt den Invite-Link als Kontakt-Attribut bei Brevo ein.
  // Die bestehende Willkommens-/Bestätigungsmail-Automation zieht sich den
  // Wert dann selbst über {{ contact.TELEGRAM_LINK }} - keine eigene Mail
  // von hier aus nötig.
  const res = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      attributes: { TELEGRAM_LINK: inviteLink },
    }),
  });

  // Brevo gibt bei PUT auf einen noch nicht existierenden Kontakt einen
  // Fehler zurück (Kontakt entsteht ja erst, wenn die Käuferin das Formular
  // auf der Dankesseite ausfüllt). In dem Fall legen wir den Kontakt direkt an.
  if (res.status === 404) {
    const createRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        email,
        attributes: { TELEGRAM_LINK: inviteLink },
        updateEnabled: true,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Brevo-Kontakt anlegen fehlgeschlagen: ${errText}`);
    }
    return;
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo-Attribut setzen fehlgeschlagen: ${errText}`);
  }
}

// ---------------------------------------------------------------------------

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

    if (url.pathname === '/api/copecart-webhook' && request.method === 'POST') {
      return handleCopecartWebhook(request, env);
    }

    if (url.pathname === '/api/telegram-webhook' && request.method === 'POST') {
      return handleTelegramWebhook(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    // Anything else falls back to the static site.
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      const notFound = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
      return new Response(notFound.body, { status: 404, headers: notFound.headers });
    }
    return response;
  },
};
