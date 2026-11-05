---
title: "Secrets for Agents: A Scoped Vault, Wrapper Scripts, and Redaction by Default"
date: 2026-11-02 10:37:00 -0600
---

**Contents**

1. [The problem](#the-problem)
2. [The design](#the-design)
3. [Where the token lives (three tiers)](#where-the-token-lives-three-tiers)
4. [Wrappers that keep secrets out of transcripts](#wrappers-that-keep-secrets-out-of-transcripts)
5. [Permissions: allow, ask, deny](#permissions-allow-ask-deny)
6. [Mistakes along the way](#mistakes-along-the-way)
7. [Next: a local secrets server on its own VLAN](#next-a-local-secrets-server-on-its-own-vlan)
8. [Takeaways](#takeaways)

---

## The problem

AI coding agents and automation (n8n, a playbook runner, scripts) need credentials to do real work: a monitoring API token, a router key, a hypervisor token. The easy answers are all bad:

- Paste the token into the chat. It lands in the transcript.
- Put it in a `.env` file in the repo. It lands in git, a backup, or a sync tool.
- Give the agent access to your personal password vault. Now one confused or manipulated agent can reach everything.

## The design

1. A **dedicated vault** that holds only the automation credentials. Not the personal vault.
2. A **service account** scoped to that one vault. The service account's token is the only secret the agent's machine needs, and the personal desktop session is never used.
3. **Wrapper scripts** that load the token themselves, call the API, and print only what the caller should see.
4. **Permission rules** in the agent's settings that make the safe path automatic and the unsafe path impossible.

**Old**

```text
export SOME_API_TOKEN=<pasted>          # in a shell history, a .env, a chat
curl -H "Authorization: Bearer $SOME_API_TOKEN" https://api.example.invalid/...
```

**New**

```text
some-api GET /devices fields=id,name       # wrapper loads the secret, redacts output
```

## Where the token lives (three tiers)

The service-account token has to be stored somewhere, and the right place depends on how the agent connects:

| Tier | Where | When | Tradeoff |
|---|---|---|---|
| 1 | The OS login keychain | Local interactive sessions | Best. Unlock follows the user. |
| 2 | A dedicated keychain with an empty password | SSH sessions, headless agents | The login keychain stays locked over SSH and a no-TTY shell cannot unlock it (`security` exits 36, "User interaction is not allowed"). The dedicated keychain unlocks itself. Protected only by account file permissions. |
| 3 | A token file, mode 600, owned by the user | Last resort | The token is unencrypted on disk, readable by any process running as you. The wrapper refuses it unless it is owned by you with mode 600. |

The wrapper tries tier 1, then 2, then 3. After rotating the token, each tier needs a refresh, and the doc says which command does it.

## Wrappers that keep secrets out of transcripts

Rules built into every wrapper:

- **Secrets never go on argv.** A process list shows arguments. Values go to the process on stdin or through the environment.
- **Create or update a credential with stdin:** `printf %s "$VALUE" | agent-secret set "Item Name" field`.
- **Prefer `run`-style injection** (`agent-op run --env-file=...`) so the value goes into the child process's environment, not the screen.
- **Redact by default.** The wrapper for the monitoring API redacts sensitive response fields unless an explicit raw flag is set. The wrapper for the network controller redacts Wi-Fi pre-shared keys. A "read the config" call should not become "print the Wi-Fi password into a transcript".
- **Writes are explicit.** A generic wrapper takes `-X POST|PATCH|DELETE` with the body on stdin. Everything else is a GET. Write scripts default to dry-run and print masked values.
- **A "get the raw value" command exists but is discouraged.** It prints the secret, so it is for a human who needs it.

A small example of the dry-run default, from a script that adds a device to a monitoring system:

```text
add-device --name 192.0.2.5 --display NAME --collector 3            # dry run: prints plan, masks values
add-device --name 192.0.2.5 --display NAME --collector 3 --apply    # creates
```

It also refuses to create a device if the display name already exists.

## Permissions: allow, ask, deny

The agent's settings file gets three lists:

- **Allow:** the read wrappers.
- **Ask:** any wrapper invocation with `-X` (a write).
- **Deny:** the bare password-manager CLI, so the agent can never fall back to the personal account.

The same rules are written in plain language in a global instruction file that every agent session loads: never print, log, or write secret values; no `bash -x` on scripts that read secrets; compare secrets by length or a short hash; tell any sub-agent these rules.

One installer script symlinks the wrappers onto the path, installs the instruction file and a skill, and prints the permission set for the human to merge. The agent does not edit its own permissions.

## Mistakes along the way

| Mistake | What happened | Fix |
|---|---|---|
| Used the keychain tool's built-in password prompt for the token | It silently **truncated input at 128 characters**. The service-account token is longer, so it was stored cut off and every call failed as unauthorized. | Pipe the token from the clipboard into the tool and clear the clipboard afterwards. |
| Created a new item with the wrapper | The "create" path was broken and the "update" path was too. | Fixed both. Values kept off argv throughout. |
| Downloaded a vendor installer | It **embeds an enrollment key**. | The installer extension is git-ignored, so it can never be committed. |
| Fetched a module's source for editing | It would print secrets-bearing properties in a terminal. | Fetch it straight into a JSON processor, never to the screen. |
| The network controller was rate-limiting logins | A scheduled clone job logged in too often. | Poll every 10-15 minutes. |

## Next: a local secrets server on its own VLAN

A service account has API rate limits. As more services read secrets (the agent machine, a workflow engine, a playbook runner), that limit becomes a risk. The plan is a self-hosted Connect-style server: a REST API with a local cache that still syncs from the cloud.

Where it lives matters more than what it is. The design:

| Item | Choice |
|---|---|
| Network | Its own VLAN, DHCP off, not on any SSID |
| Firewall zone | A custom zone containing only that network |
| Inbound | **Only the API port**, TLS only, to one address |
| Outbound | DNS, a package/image mirror, and the sync service's hostnames on 443. No general internet. |
| Gateway | Blocked, so the router's admin interface is unreachable from the VLAN |
| Everything else | Block and log |
| Scope | Granted only the automation vault. One access token per consumer, read-only unless that consumer writes. |
| Management | The runner manages the container from the hypervisor, so no network path into the VLAN is needed for admin |

Because the hypervisors' bridge was not VLAN-aware, the plan includes making the bridge VLAN-aware on every node, and creating an SDN virtual network so the network exists on every node and an HA failover just works. Those two preparatory steps were done first, each tested for tolerance of warnings and safe re-run after a half-apply. The server itself was still to come at the time of writing.

## Takeaways

- Give agents a dedicated vault and a service account, never the personal account.
- Keep the token in the strongest store the session can use, and fall back in a defined order.
- Wrappers, not raw curl: secrets off argv, output redacted, writes explicit, dry-run by default.
- Deny the unsafe tool in the permission file, so the safe one is the only one that works.
- Test your own tooling for silent truncation. A token that is too long for a prompt fails in a way that looks like an auth bug.
- If a secret server is worth running, put it on a network where only its API can reach it.
