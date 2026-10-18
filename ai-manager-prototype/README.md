# AI Business Manager — Samsung prototype

**Isolated proof of concept, not production.** This folder is intentionally separate from `server.js`, `index.html`, Render configuration, and live records. It does not import existing application code or call Mom's / Satori APIs. Both businesses use clearly marked **synthetic sample data**, not real customer records.

## Requirements
- Node.js 18.20+ (Node 20+ recommended for built-in fetch).
- Optional xAI API key from https://console.x.ai. Without a key, runs in deterministic demo mode.

## Run locally

```bash
cd ai-manager-prototype
node server.js
```

Open **http://127.0.0.1:3107** on the same computer. For Android voice testing, use a securely hosted **HTTPS staging** environment with authentication, or a trusted local development tunnel; do not expose the default local server to the public internet.

## Optional Grok mode (environment variables, never commit secrets)

- `XAI_API_KEY`: xAI API key; no key means local demo answers.
- `XAI_MODEL`: defaults to `grok-4.3`. Select another currently supported model if preferred.
- `AI_MANAGER_ACCESS_TOKEN`: required if binding outside loopback. Use a long random secret and enter it in the frontend access-code box.
- `AI_MANAGER_HOST`: defaults to `127.0.0.1` (not publicly exposed).
- `AI_MANAGER_PORT`: defaults to `3107`.

The frontend requests `POST /chat` with `{business:'moms'|'satori',message:'...'}`. The server caps input and response time, never accepts mutating commands, and sends only fixture data to Grok. The `GET /health` endpoint indicates demo configuration only (not actual production health).

**Voice:** Browser SpeechRecognition availability varies. Samsung Chrome on HTTPS is the preferred test environment. Microphone transcription may be browser-service dependent; check privacy needs before sending customer data. Speech synthesis depends on installed Vietnamese voices.

## Explicitly NOT implemented
- No connection to real orders, invoices, Drive, or Render.
- No login/roles, production-grade auditing, payments, approval workflow, background processing, automatic report exports, or persistent chat history.
- No PWA install manifest or Android APK yet.
- No Grok API verification yet: requires a user-supplied API key and a secure staging deployment.
- No automatic change to any live site.

## Next phase (requires separate review)
1. Inspect Mom's existing authenticated admin routes and data structures. Inspect Minh Satori's client-side data / Drive sync and identify a reliable server-side adapter.
2. Add **read-only** adapters with server-side authentication, tenant isolation, timeouts, redaction, and strict data schemas. Never expose any admin keys to the browser.
3. Add deterministic calculation logic for revenue, debt and invoice matching; give Grok only the results it needs to explain, not entire raw datasets.
4. Test with synthetic fixtures, then staging copies; implement audit log, approvals and least-privilege tools before enabling any write.
5. Validate voice on Samsung Chrome / Samsung Internet and add PWA install support once hosted over HTTPS.

## Acceptance tests
- `GET /health` shows `mode: demo-read-only`.
- Chatting without API key returns clearly labelled sample figures.
- Commands such as “xóa hóa đơn” must not modify files or invoke a live service.
- The main storefront works unchanged; no Render auto-deploy from this feature branch.
- A failure from xAI must not affect production.
