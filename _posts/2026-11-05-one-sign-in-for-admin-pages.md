---
title: "One Sign-In for Every Admin Page: authentik as Code, With a Break-Glass on Each"
date: 2026-11-05 02:35:00 -0600
tags: [sso, authentik, oidc, reverse-proxy, automation]
---

**Contents**

1. [The goal](#the-goal)
2. [The shape of it](#the-shape-of-it)
3. [authentik as code: blueprints, not clicks](#authentik-as-code-blueprints-not-clicks)
4. [Client secrets that never leave the cluster](#client-secrets-that-never-leave-the-cluster)
5. [Pilot: a Git server, and three surprises](#pilot-a-git-server-and-three-surprises)
6. [The edge gate: moving from a hosted IdP to authentik](#the-edge-gate-moving-from-a-hosted-idp-to-authentik)
7. [Rolling it out in batches](#rolling-it-out-in-batches)
8. [Two tiers of users](#two-tiers-of-users)
9. [Native OIDC for the playbook runner, which restarts itself](#native-oidc-for-the-playbook-runner-which-restarts-itself)
10. [What it does not cover](#what-it-does-not-cover)
11. [Takeaways](#takeaways)

---

A home lab collects admin pages: a NAS UI, download clients, a Git server, dashboards, a playbook runner, a hypervisor. Each had its own login, some had none, and one Git server would let anyone who reached it register an account. This post is how they ended up behind one identity provider, configured from a repo, with a local login kept on every service for the day the identity provider is down.

Sanitized as usual: domains are `example.invalid`, addresses are documentation ranges, and user names, group members, client secrets, vault items and guest or template IDs are left out. Product names and versions are real, because they matter for the bugs.

## The goal

The target written down beforehand:

- One sign-in in front of every admin UI.
- A **local break-glass account on each service**, tested, so the identity provider is never a single point of failure.
- No admin UI that accepts an unauthenticated visitor.
- Everything reproducible from the repo.

## The shape of it

| Piece | Role |
|---|---|
| authentik 2026.8 | Identity provider (OIDC), in its own container with HA, Postgres on replicated storage, in the normal backups |
| Reverse proxy (SWAG/nginx) + oauth2-proxy | The **edge gate**: any proxied service marked `auth` must pass oauth2-proxy, which signs in through authentik |
| Native OIDC | For apps that speak it well (Git server, Grafana, the playbook runner), they talk to authentik directly instead of hiding behind the gate |
| Playbook runner | Applies every change; nothing is clicked in the authentik UI except creating the owner's own account |

Which services get which treatment:

| Service type | Treatment | Why |
|---|---|---|
| Admin UIs with no API clients | Edge gate | One change covers many services |
| Apps with an API that other tools call with keys | Edge gate with the `/api/` path left to the app's own key check | Integrations keep working |
| Apps with good OIDC support | Native OIDC | Real per-user accounts and roles inside the app |
| Hypervisor | Its own OpenID realm, in a separate change window | Too important to bundle |
| Workflow engine | Later, or never | Its webhooks must stay open |
| Media server, home automation, NVR, family-facing apps | Left alone | Companion apps, TVs and family members use their own logins |

## authentik as code: blueprints, not clicks

authentik reads **blueprints**: YAML files describing providers, applications, groups and policy bindings. A playbook pushes the repo's blueprint folder into the container, mounts it through a compose override file (the upstream compose file is never edited), and authentik's worker applies anything new by itself.

A provider plus application plus access rule looks like this:

```yaml
version: 1
metadata:
  name: Runner OIDC
  labels:
    blueprints.goauthentik.io/instantiate: "true"
entries:
  - model: authentik_providers_oauth2.oauth2provider
    id: prov
    identifiers: {name: Runner}
    attrs:
      authorization_flow: !Find [authentik_flows.flow, [slug, default-provider-authorization-implicit-consent]]
      invalidation_flow: !Find [authentik_flows.flow, [slug, default-provider-invalidation-flow]]
      client_type: confidential
      grant_types: [authorization_code, refresh_token]   # see the pilot below
      client_id: runner
      client_secret: !Env RUNNER_OIDC_SECRET
      redirect_uris:
        - matching_mode: strict
          url: https://runner.example.invalid/api/auth/oidc/authentik/redirect
  - model: authentik_core.application
    id: app
    identifiers: {slug: runner}
    attrs: {name: Runner, provider: !KeyOf prov}
  - model: authentik_policies.policybinding
    identifiers: {target: !KeyOf app, group: !Find [authentik_core.group, [name, admins]], order: 0}
    attrs: {negate: false, enabled: true}
```

Branding (logo, favicon, background, a CSS palette), app icons and the login page's source buttons are blueprints too. The check mode of the playbook shows which blueprint files differ, and a `diag` switch prints blueprint import errors and recent authorize errors from the server log (with anything resembling a secret filtered out). That diag mode found most of the bugs below.

## Client secrets that never leave the cluster

Each OIDC client needs a shared secret. The pattern that stuck:

1. The blueprint playbook **generates** each client secret inside the identity provider's container, in its `.env` file, if it is not there yet. It is random, never printed, and checked only by length.
2. The blueprint reads it with `!Env`.
3. The app-side playbook reads the secret from that `.env` through the hypervisor into the playbook's memory, writes it into the app's config, and compares by hash.

No vault item, no runner secret, nothing pasted. Rotation is "delete the line, re-run both playbooks". (One older client, created before this pattern, still reads its secret from a runner environment secret.)

## Pilot: a Git server, and three surprises

The Git server went first, with these rules:

- Add an OIDC auth source with auto-discovery.
- Set `ALLOW_ONLY_EXTERNAL_REGISTRATION = true`. Before this, registration was open with no restriction, so anyone who could reach the server could sign up.
- Keep the local admin password login as break-glass, and test it with authentik's server stopped.

**Surprise 1: `invalid_request` on authorize.** The first sign-in failed with an unhelpful "otherwise malformed" error. The server log said `Invalid grant_type for provider`. authentik 2026.x checks each provider's allowed grant types, and the blueprints set none. Adding `grant_types: [authorization_code, refresh_token]` fixed it. The same bug had **silently broken the already-working Grafana SSO**, and a provider made by hand in the UI for another service was broken the same way. If you upgrade authentik, check every provider for grant types.

**Surprise 2: the callback must be HTTPS.** The next sign-in got a code back, then landed the browser on an `https://` form of the Git server's bare IP, which does not serve TLS. The reverse proxy rewrites every `http://` redirect from authentik to `https://`, so an HTTP callback can never work through it. The fix was to move the Git server to its DNS name for its root URL, with a separate LAN-only name for SSH (the edge proxies HTTPS only), and allow only the HTTPS callback in the blueprint.

**Old**

```ini
[server]
ROOT_URL = http://192.0.2.15/
```

**New**

```ini
[server]
ROOT_URL   = https://git.example.invalid/
DOMAIN     = git.example.invalid
SSH_DOMAIN = git.lan.example.invalid    ; LAN DNS rewrite, the edge does not proxy SSH
```

Old remotes using the IP kept working, and the IP still answers locally as a break-glass path.

**Surprise 3: stdin.** The playbook sends a script into the guest with `bash -s` on stdin. Inside that script, a `docker exec -i` **read the rest of the script as its own input**. The config edit ran and the restart silently did not. Fix: no `-i` where nothing needs to be read, and a `restart=true` switch to force a restart after an interrupted run.

## The edge gate: moving from a hosted IdP to authentik

The edge gate already existed, using a hosted identity provider plus an email allowlist. The switch to authentik was one change:

- A blueprint for the `edge` client and an `admins` group.
- The compose file reads the issuer URL from the environment, so rollback is flipping the environment back. The hosted IdP's values stayed in the vault for the rollback window.
- A playbook writes the four environment values into the edge container through the hypervisor (secret in memory only), with backups of the compose and `.env` files.
- Tested on one already-gated service in a private window.

Two failures, both in the first ten minutes:

**`email in id_token ... isn't verified` (oauth2-proxy 500).** authentik's built-in email scope mapping reports `email_verified: false` for local users. The options were a custom scope mapping for the edge client, or telling oauth2-proxy to accept unverified emails. I took the second, because the group check and the email allowlist still apply:

```yaml
environment:
  OAUTH2_PROXY_INSECURE_OIDC_ALLOW_UNVERIFIED_EMAIL: "true"   # group gate + allowlist still enforced
```

**`upstream sent too big header` (nginx 502) on the callback.** authentik's session cookie is larger than nginx's default header buffers. The proxy-config generator now sets larger buffers on gated hosts and on the auth host's `/oauth2/` locations:

```nginx
proxy_buffer_size          32k;
proxy_buffers              8 32k;
proxy_busy_buffers_size    64k;
large_client_header_buffers 4 32k;
```

The first deploy of that change failed `nginx -t`, because one shared include already set `proxy_buffers`. The deploy playbook restored the previous configs by itself, which is exactly why it validates before reloading.

## Rolling it out in batches

With the gate working, services were added in two batches by adding `auth` to their row in the service table and regenerating the proxy configs:

- **Batch 1:** UI-only admin pages (dashboard, web code editor, game server panels, download client, indexer manager, media statistics, the NAS UI).
- **Batch 2:** two media managers with the new option `api`. Their `/api/` path bypasses the gate, because other tools call it with API keys, and the app's own key check still applies. A health workflow probes that the UI redirects to sign-in and that the API answers `401` without a key, so a future change that opens the API by accident shows up.

Each service keeps its own login as break-glass, reachable on the LAN without the edge.

## Two tiers of users

Later, a second group was added for trusted non-admin users who should reach a recipe app, a dashboard and a game server panel, but not the rest. The edge config generator now has two tiers:

```python
TIERS = {"auth": "admins", "auth-users": "admins,Trusted%20Users"}
```

Each gated server block gets the matching `auth_request` check, and oauth2-proxy enforces `allowed_groups`. The trusted group also gets launcher tiles in authentik for apps that keep their own logins.

Two things to know:

- Group checks need the `groups` claim in the oauth2-proxy session. **Sessions created before the change get 403** until the user signs out and in again.
- Group membership is owned by the blueprint. Adding someone in the UI would be overwritten on the next apply, so membership changes go through the repo, along with the email allowlist.

## Native OIDC for the playbook runner, which restarts itself

The playbook runner got native OIDC instead of the edge gate, because other tools call its API with tokens and those must keep working. The interesting part is that **the runner applies its own SSO change**:

1. The playbook reads the client secret, adds the OIDC provider and the external URL to the runner's `config.json` (backup kept, file mode 600).
2. It cannot restart the runner directly, because that would kill the task doing the restart. Instead it schedules the restart on the hypervisor, outside the runner:

   ```bash
   systemd-run --unit=runner-oidc-restart --on-active=20 \
     pct exec <guest> -- docker restart runner
   ```

3. The task finishes green, and the runner restarts twenty seconds later.

After the owner's first SSO login created the account, a second run with `admin_login=<user>` promoted it to admin. The local `admin` account remains as break-glass, and API tokens for automation were unaffected.

## What it does not cover

- **Direct `IP:port` access.** The edge gate only protects the proxied names. Anyone on the LAN can still reach a service's own port, and its own login. That is also the break-glass path. Closing it is firewall work, not SSO work.
- **Tunnels that skip the proxy.** A public tunnel route pointing straight at a backend bypasses the gate. Gating a public name means pointing its route at the edge.
- **A login source I did not want.** A test of the media server as a login source created a user automatically. The source stays (as a button on the login page), and the stray user was removed by a one-off playbook option.

## Takeaways

- Keep a tested local login on every service. Test it with the identity provider stopped.
- Configure the identity provider from blueprints in a repo. Use the UI only to look.
- Generate client secrets inside the identity provider, copy them in memory, compare by hash.
- After an authentik upgrade, check every provider's grant types, including ones made by hand.
- If a reverse proxy rewrites redirects, the OIDC callback must be HTTPS on a real name.
- Expect `email_verified: false` and oversized cookies when putting oauth2-proxy in front of authentik.
- Gate UIs at the edge, leave `/api/` to the app's keys, and probe both behaviours.
- When a tool applies a change to itself, schedule its restart from outside it.
