# Handoff prompt — per-device Cloudflare tunnel prerequisites

The website should mint a **unique Cloudflare tunnel + subdomain per Raspberry Pi**, so a public
downloadable image can give each user their own hostname + token. That needs a few things from the
Cloudflare account that only the account owner can create. **Copy the prompt below to a Claude that
has access to (or can walk you through) your Cloudflare account.** Its job is to produce and install
the prerequisites, then report back the two non-secret IDs so the minting endpoint can be built.

---

## PROMPT (paste into a fresh Claude, with your Cloudflare login available)

> I run a Cloudflare account that hosts the Worker `leds-frontdoor` (project at
> `C:\websites\BIGLED\cf-worker`, deployed with `wrangler`) on the zone `iddofroom.co.il`. I want the
> Worker to be able to mint a **Cloudflare Tunnel per device** and create a DNS record for each, via
> the Cloudflare API. Please set up and verify exactly these prerequisites, then report back:
>
> 1. **Create a scoped API token** at https://dash.cloudflare.com/profile/api-tokens → "Create Token" →
>    "Create Custom Token". Permissions (minimum):
>    - **Account · Cloudflare Tunnel · Edit**
>    - **Zone · DNS · Edit** (scoped to the `iddofroom.co.il` zone)
>    Account Resources = my account; Zone Resources = `iddofroom.co.il`. Set a sane TTL. Copy the token
>    value ONCE (it's shown only once).
>
> 2. **Find the two IDs** (non-secret): the **Account ID** (dash → any domain → right sidebar, or
>    `GET https://api.cloudflare.com/client/v4/accounts`) and the **Zone ID** for `iddofroom.co.il`
>    (dash → the domain → Overview → API section, or `GET .../zones?name=iddofroom.co.il`).
>
> 3. **Install them as Worker secrets** so they stay server-side only. From `C:\websites\BIGLED\cf-worker`:
>    ```
>    wrangler secret put CF_API_TOKEN     # paste the token from step 1
>    wrangler secret put CF_ACCOUNT_ID    # paste the Account ID
>    wrangler secret put CF_ZONE_ID       # paste the Zone ID
>    ```
>    (If a deploy is needed for the secrets to bind, run `wrangler deploy`.)
>
> 4. **Verify the token works** without exposing it: run a harmless read, e.g.
>    ```
>    curl -s -H "Authorization: Bearer <TOKEN>" \
>      "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/cfd_tunnel?is_deleted=false" | head
>    ```
>    Confirm it returns `"success": true` (an empty `result` array is fine).
>
> 5. **Report back to me** (safe to share): the **Account ID**, the **Zone ID**, and confirmation that
>    `CF_API_TOKEN` / `CF_ACCOUNT_ID` / `CF_ZONE_ID` are set as Worker secrets and the token verified.
>    **Do NOT paste the token value back** — it lives only in the Worker secret now.
>
> Also tell me: is the zone `iddofroom.co.il` on a plan that allows the number of proxied subdomains I'll
> need (one CNAME per device), and are there any account-level tunnel limits I should know about?

---

## What I'll do once you report back

With `CF_ACCOUNT_ID` + `CF_ZONE_ID` known and `CF_API_TOKEN` set as a Worker secret, I'll build the
minting endpoint in `cf-worker` (degrading gracefully to the manual flow if the secret is absent):

- `POST /api/library/device/tunnel` → `POST /accounts/{acct}/cfd_tunnel {name, config_src:"cloudflare"}`
  → `PUT .../cfd_tunnel/{id}/configurations` (ingress → `http://localhost:8088`) →
  `POST /zones/{zone}/dns_records` (CNAME `<slug>.kivsee.iddofroom.co.il` → `<id>.cfargotunnel.com`,
  proxied) → return `{ hostname, token }`.
- A "Get my Pi config" button that emits a pre-filled `ledrings-config.txt` with the issued token +
  `PUBLIC_URL` (consumed by the first-boot provisioner — see `remote-deploy/IMAGE.md`).

Only the **Account ID** and **Zone ID** need to come back to me; the token stays a Worker secret.
