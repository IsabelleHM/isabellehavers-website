# Project Notes – isabellehavers.com

## Website-Struktur

Rein statische Website (HTML + CSS + JS, kein Framework). Alle Seiten liegen als einzelne `.html`-Dateien im Root-Verzeichnis.

### Öffentliche Seiten

| Datei | URL | Zweck |
|---|---|---|
| `index.html` | `/` | Startseite |
| `shop.html` | `/shop` | Kursübersicht + Kauf via CopeCart |
| `mentoring.html` | `/mentoring` | 1:1 Mentoring-Angebot |
| `community.html` | `/community` | Club Easy Warteliste |
| `community-full.html` | `/community-full` | Erweiterte Community-Info |
| `something-good.html` | `/something-good` | Lead-Magnet Landingpage (Insight Timer Traffic) |
| `clear-the-noise.html` | `/clear-the-noise` | Redirect → `/something-good` (alte URL) |
| `club-easy.html` | `/club-easy` | Wartelisten-Formular Club Easy |
| `club-easy-danke.html` | `/club-easy-danke` | Willkommensseite nach CopeCart-Kauf (Abo) |
| `partner.html` | `/partner` | Affiliate-Programm-Info |
| `partnerinnen.html` | `/partnerinnen` | Ältere Partnerinnen-Seite |
| `partner.html` | `/partner` | Affiliate-Landingpage (neu) |
| `404.html` | – | Benutzerdefinierte Fehlerseite (wird vom Worker ausgeliefert) |
| `mood-slider.html` / `stimmungs-barometer.html` | – | Interaktives Tool |
| `impressum.html` | `/impressum` | Impressum |
| `datenschutz.html` | `/datenschutz` | Datenschutzerklärung |
| `agb.html` | `/agb` | AGB |
| `widerruf.html` | `/widerruf` | Widerrufsbelehrung |

### Danke-Seiten (nach Kauf)

Jeder Kurs hat eine eigene Danke-Seite, die CopeCart nach dem Checkout aufruft:

- `danke-meditation.html` – Meditation (hier wird Something Good verschickt)
- `danke-buerostress-kurs.html`
- `danke-energie-kurs.html`
- `danke-schlaf-kurs.html`
- `danke-wut-kurs.html`
- `danke-vom-denken-ins-tun.html`
- `danke-deep-rest-bundle.html`
- `danke-deep-dive-connection-bundle.html`
- `danke-hamsterrad-bundle.html`
- `danke-im-gespraech.html`
- `danke-mentoring.html`
- `mentoring-danke.html`

---

## Hosting-Setup

**Cloudflare Workers** mit Static Assets Binding.

- `wrangler.jsonc` definiert das Setup
- `src/worker.js` ist der Worker – er fängt `/api/*` ab, alles andere wird als statisches Asset ausgeliefert
- `/api/newsletter-subscribe` ist der einzige serverseitige Endpunkt (Brevo-Anbindung, API-Key als Worker Secret)
- Die 404-Seite wird vom Worker manuell ausgeliefert (Cloudflare Workers erkennt `404.html` nicht automatisch wie Cloudflare Pages)
- `background-attachment: fixed` funktioniert auf iOS/Android nicht korrekt – auf Mobile wird es auf `scroll` umgestellt

**Secrets in Cloudflare Workers:**
- `BREVO_API_KEY` – API-Schlüssel für Brevo
- `BREVO_LIST_ID` – Listen-ID für die Newsletter-Liste

---

## Design-System

### Farben

| Name | Hex | Verwendung |
|---|---|---|
| Navy | `#0A1F44` | Headlines, Logo, primärer Text |
| Pink | `#B10058` | Buttons, Akzente, CTAs |
| Pink dunkel | `#970050` | Hover-Zustand Buttons |
| Olive | `#6A6B4A` | Sekundärer Text, Links |
| Creme | `#FDFDF3` | Seitenhintergrund, Inputs |
| Textbraun | `#3D3D2E` | Fließtext |
| Muted | `#A5A58D` | Fine Print, Footer-Links |
| Border | `#E8E8D8` | Karten-Rahmen, Trennlinien |

### Schriften

- **Headlines:** Cormorant Garamond, serif, 700
- **Fließtext / UI:** Plus Jakarta Sans, sans-serif
- Geladen über Google Fonts (im `<head>` jeder Seite)

### Layout-Muster

- Hero-Blobs: absolut positionierte `div`s mit `border-radius: 50%`, `filter: blur(60–70px)`, `opacity: ~0.28`
- Karten: weißer Hintergrund, `border: 1px solid #E8E8D8`, `border-radius: 16–20px`, `box-shadow: 0 8px 40px rgba(10,31,68,0.08)`
- Buttons: `border-radius: 50px`, `padding: 14–16px 32–40px`, font-weight 700
- Testimonials: doppelt duplizierter Marquee-Track mit `animation: marquee-scroll 200s linear infinite`, kein Hover-Pause (GPU-Bug auf Mobile)

---

## Sales-Flow

```
Insight Timer Profil
    → isabellehavers.com/something-good
    → Brevo-Formular (E-Mail eintragen)
    → Brevo schickt Something Good (Audioimpuls) zu

Shop (shop.html)
    → CopeCart Checkout
    → CopeCart ruft Danke-Seite auf (z.B. /danke-meditation)
    → Danke-Seite enthält Brevo-Formular für Folge-E-Mail

Club Easy Abo
    → Warteliste: isabellehavers.com/club-easy → Brevo
    → Kauf: CopeCart → isabellehavers.com/club-easy-danke → Brevo

Affiliate
    → isabellehavers.com/partner
    → CopeCart Affiliate-Registrierung
    → 40 % Provision, Invite-Link mit allen Produkt-IDs
```

**Plattformen:**
- **CopeCart** – Checkout, Zahlungsabwicklung, Affiliate-Programm
- **Brevo** – E-Mail-Marketing, Formulare, Automationen
- **hearThis.at** – Audio-Hosting für Meditationen und Audioimpulse

---

## Claude Code – Nutzungskontext

Isabelle nutzt Claude Code **ausschließlich browserbasiert** (claude.ai/code), kein Terminal-Zugang. Grund: älterer Mac ohne kompatible Terminal-Umgebung.

**Praktische Konsequenzen:**
- Alle Datei-Uploads müssen über GitHub direkt (Drag & Drop im Browser) erfolgen, bevor Claude Code sie in den Branch holen kann
- Bilder liegen oft auf `main`, müssen mit `git checkout origin/main -- "Dateiname"` in den Feature-Branch gezogen werden
- PRs werden von Isabelle selbst in GitHub gemergt und auf Cloudflare deployed
- Nach einem Merge ist der Branch verbraucht – neuer Branch für neue Änderungen

---

## Aktuell offen / in Arbeit

- **partner.html** ist angelegt, aber noch nicht verlinkt (Materialien PDF + Canva-Vorlagen fehlen noch – Platzhalter "folgt bald" vorhanden)
- **Something Good** – Brevo-Automation muss geprüft werden: liefert sie den Audioimpuls korrekt aus, seit der Lead-Magnet umbenannt wurde?
- **Club Easy öffnet am 21.09.** – Danke-Seite `/club-easy-danke` ist bereit, CopeCart muss dort hin konfiguriert werden
- **clear-the-noise.html** bleibt als Redirect bestehen – kann irgendwann entfernt werden, sobald keine alten Links mehr im Umlauf sind
- **OG-Image** (`og-image.jpg`) – wird für Social Sharing verwendet, Inhalt ungeprüft

---

*Zuletzt aktualisiert: Juli 2026*
