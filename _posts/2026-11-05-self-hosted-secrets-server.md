---
title: "A Self-Hosted Secrets Server on Its Own VLAN: 1Password Connect in Homelab Automation"
date: 2026-11-05 02:20:00 -0600
tags: [secrets, 1password, networking, proxmox, automation]
---

**Contents**

1. [Why a Connect server](#why-a-connect-server)
2. [The design](#the-design)
3. [Step 0: check that your plan offers it](#step-0-check-that-your-plan-offers-it)
4. [Building the network first](#building-the-network-first)
5. [Getting the credentials file in without anyone seeing it](#getting-the-credentials-file-in-without-anyone-seeing-it)
6. [The sync that failed: domain allowlists need the gateway's DNS](#the-sync-that-failed-domain-allowlists-need-the-gateways-dns)
7. [Proving the isolation](#proving-the-isolation)
8. [Wrappers: Connect for reads, the service account for everything else](#wrappers-connect-for-reads-the-service-account-for-everything-else)
9. [Keeping it healthy](#keeping-it-healthy)
10. [Takeaways](#takeaways)

---

This is the follow-up to [Secrets for Agents]({% post_url 2026-11-02-secrets-for-agents %}), which ended with a plan: run a self-hosted secrets server on a network where only its API can be reached. This post is how that plan went from a table in a doc to a running service, and the one firewall surprise that took most of the night.

Everything is sanitized. Addresses use the `192.0.2.0/24` and `198.51.100.0/24` documentation ranges, names use `example.invalid`, and vault, item, guest and template identifiers are left out.

## Why a Connect server

Agents and automation in the lab read credentials through a 1Password service account that is scoped to one dedicated vault. That works, but a service account has API rate limits, and the number of readers kept growing: the agent's laptop, a workflow engine, a playbook runner, monitoring. Each new reader moved the lab closer to "everything fails at once because a quota ran out".

1Password Connect is a small self-hosted pair of containers:

- **connect-sync** keeps an encrypted local copy of the vaults the server is granted, synced from 1Password's cloud.
- **connect-api** serves a REST API from that local copy, so reads do not count against the cloud's limits.

The catch is obvious: a box that holds a decrypted working copy of the vault is the vault. Where it lives matters more than what it is.

## The design

| Item | Choice |
|---|---|
| Network | A new VLAN used only for this, DHCP off, no mDNS, not on any SSID |
| Firewall | A custom zone containing only that network, default deny |
| Inbound | TCP 8443, TLS only, to the one server address. Nothing else, not even ping |
| Outbound | DNS, the local package and image mirror, and 1Password's sync domains on 443 |
| Gateway | Blocked, so the router's admin UI and SSH are unreachable from the VLAN |
| Guest | One small unprivileged container (1 core, 512 MB), no SSH server, HA enabled |
| Scope | The Connect server is granted only the automation vault. One access token per consumer |
| Management | The playbook runner manages the guest from the hypervisor (`pct exec` / `pct push`), so no admin path into the VLAN exists |

The compose file is short. Both images are pinned to the same release, the API listens only on TLS, and sync publishes no port at all:

```yaml
x-op: &op
  restart: unless-stopped
  user: "999:999"
  volumes:
    - ./1password-credentials.json:/home/opuser/.op/1password-credentials.json:ro
    - data:/home/opuser/.op/data

services:
  connect-api:
    <<: *op
    image: 1password/connect-api:1.7.3
    ports: ["8443:8443"]
    environment:
      OP_HTTPS_PORT: "8443"
      OP_TLS_CERT_FILE: /tls/fullchain.pem
      OP_TLS_KEY_FILE: /tls/privkey.pem
    volumes:
      - ./1password-credentials.json:/home/opuser/.op/1password-credentials.json:ro
      - data:/home/opuser/.op/data
      - ./tls:/tls:ro

  connect-sync:
    <<: *op
    image: 1password/connect-sync:1.7.3
    environment:
      OP_HTTP_PORT: "8081"

volumes:
  data:
```

Note that a YAML merge key does not merge lists: `connect-api` repeats the two volumes because its own `volumes:` replaces the anchor's.

## Step 0: check that your plan offers it

Connect servers have historically been described as a Teams or Business feature. Before building any network, I checked the account's developer settings. The family plan in use did offer **Developer > Connect servers**. Ten seconds in a web UI, and it would have been a very annoying thing to discover after the VLAN existed.

## Building the network first

The network work was done in order, each step reversible and verified before the next.

**1. The VLAN and zone.** The network was created by hand in the controller UI. It landed in the default internal zone, which means it could reach everything. A script then created the custom zone (which moves the network out of the internal zone) and the six policies. Some controller API details that cost time:

| Thing | What the API wanted |
|---|---|
| TCP only (not TCP and UDP) | A "named protocol" value. The preset field only accepts TCP+UDP |
| A domain allowlist | Destination type `DOMAINS` |
| Policies toward the internet or the gateway | `allowReturnTraffic: false`. The system policy already handles return traffic, and user policies toward those zones refuse the flag |

**2. VLAN-aware bridges on every hypervisor.** The hypervisors' main bridge was a plain bridge, so a guest could not be put on a tagged VLAN. A playbook made each node's bridge VLAN-aware, one node at a time: it gates on cluster health, sets the storage cluster's `noout` flag, backs up the interfaces file, arms a three-minute auto-rollback, reloads networking, proves the node still reaches the gateway and quorum, then disarms the rollback. Only the one VLAN ID is allowed on the bridge, rather than the full 2-4094 range, to keep the filter table tiny.

The first run stopped before touching anything: the network tool's syntax check exits non-zero on a standard warning that the hypervisor's own default config produces. The playbook now tolerates that warning instead of treating it as failure.

**3. A cluster-wide virtual network.** A VLAN zone and a virtual network on top of the bridges, so the network exists on every node and an HA failover lands the guest on the same VLAN. One node's interfaces file was missing the line that includes the SDN config, so the zone stayed in an error state on that node until the playbook added it.

Doing the network first meant the secrets server was born isolated. There was never a moment when it ran on the main LAN "just for testing".

## Getting the credentials file in without anyone seeing it

Connect needs a `1password-credentials.json` from the account, plus an access token for each consumer. Both were created in the 1Password web UI and stored straight into the automation vault. Neither was ever pasted into a chat or a terminal.

The original plan was to stream the file from the laptop over SSH into the guest. What actually shipped is a playbook that reads the file from a **one-shot runner environment secret**:

1. The owner creates a temporary environment in the playbook runner with the file as a base64 secret.
2. The playbook asserts it decodes to JSON with the expected keys, writes it into the guest with mode 600 and the container's uid, and compares by a short hash. It never prints the value (`no_log`), and the staged copy on the hypervisor is removed.
3. The owner deletes the secret.

The same playbook is the rotation procedure: revoke the server in 1Password, update the vault item, re-run.

The TLS certificate is the edge proxy's wildcard. Another playbook copies it from the edge guest into the Connect guest through the hypervisors (the key exists only in the playbook's memory) and restarts the API when it changes. That playbook runs in the nightly drift check, so certificate renewals follow automatically.

## The sync that failed: domain allowlists need the gateway's DNS

The stack came up, `/health` answered over TLS from the main LAN with a valid certificate, and then sync failed:

```text
408 sync did not complete
connect-sync: failed to request.DoUnencrypted
```

Every HTTPS request from the guest failed, including to the 1Password domains the policy explicitly allowed.

**Cause.** The router's domain-match rule works by watching DNS answers. It only knows which IPs belong to an allowed domain if it saw the lookup. The guest resolved through the lab's own DNS server (an ad-blocking resolver on the LAN), so the router never saw those lookups, never learned the IPs, and the domain allowlist matched nothing.

There were two fixes:

| Option | Change | Trade |
|---|---|---|
| A | Allow TCP 443 to anywhere | Simple, and a real weakening: the box holding the vault could reach the whole internet |
| B | Let the VLAN use the gateway for DNS, and keep the domain list | One more narrow rule: DNS to the gateway, placed ahead of the gateway block |

I chose B. An agent had actually tried option A first and was refused by its own sandbox as a security weakening, which was the right call.

**Old**

```text
# guest resolv.conf
nameserver 198.51.100.53        # LAN resolver: router never sees lookups
# policy: Secrets -> External TCP 443, DOMAINS 1password.com, ...   (matches nothing)
```

**New**

```text
# guest resolv.conf
nameserver 192.0.2.1            # the VLAN's gateway: router sees lookups, learns IPs
# policy: Secrets -> Gateway TCP/UDP 53 (ahead of "Secrets -> Gateway block")
# policy: Secrets -> External TCP 443, DOMAINS 1password.com, ...   (now matches)
```

Sync went ACTIVE straight away. The token saw exactly one vault with the same item count as the service account.

**Lesson.** A domain allowlist on a router is only as good as the router's view of DNS. If the client resolves somewhere else, the rule silently matches nothing, and the symptom looks like a TLS or proxy problem.

## Proving the isolation

"The firewall should block that" is a belief. The stack playbook has a check mode that probes from inside the guest and from the LAN, and records the result:

| From | To | Expected | Result |
|---|---|---|---|
| Guest | LAN resolver, package mirror, gateway DNS | open | open |
| Guest | 1Password sync domains | open | open |
| Guest | Hypervisors, playbook runner, home automation, router UI/SSH | blocked | blocked |
| Guest | Any other internet host | blocked | blocked |
| Guest | Ping to the LAN | blocked | blocked |
| LAN | Server on 8443 | open | open |
| LAN | Server on any other port, or ping | blocked | blocked |

Running the probes as a playbook, not by hand, means they can be re-run after any firewall change.

## Wrappers: Connect for reads, the service account for everything else

The agent's `op` wrapper now has two backends and picks one per call:

```bash
case "$1 $2" in
  "read "*|"inject "*|"item get"|"vault list"|"vault get") connect_read=1 ;;
esac
if [[ $connect_read == 1 && -n $ctoken ]] && curl -sf --max-time 2 "$CONNECT_HOST/health" >/dev/null; then
  OP_CONNECT_HOST=$CONNECT_HOST OP_CONNECT_TOKEN=$ctoken op "$@" && exit 0
  echo "Connect read failed; retrying on the service account" >&2
fi
OP_SERVICE_ACCOUNT_TOKEN=$token exec op "$@"
```

The rules behind it:

- **Reads go to Connect** when its token is present and `/health` answers within two seconds.
- **Writes, documents, `run` and `item list` stay on the service account.** The Connect token is read-only, and the `op` CLI version in use refuses `item list` against a Connect server anyway.
- **A failed Connect read retries once on the service account.** Reads are idempotent, so this is safe, and a dead Connect server degrades to the old behaviour instead of breaking every agent.
- **Only one auth mode is set per call.** The wrapper unsets any inherited Connect or account variables first, so `op` can never pick the wrong one.
- An environment switch forces the service account for debugging.

The Connect token lives in the same dedicated keychain as the service-account token and is installed by piping the vault value straight into the keychain command. It never appears on screen.

## Keeping it healthy

- **Monitoring.** A blackbox probe checks `/health` and requires both HTTP 200 and sync status `ACTIVE`. An alert fires after 10 minutes unhealthy, and it has a unit test. The existing certificate-expiry alert covers the new endpoint.
- **Backups.** The guest is in the normal backup jobs. The dump contains the credentials file and the encrypted cache, so it is as sensitive as the vault. The off-site copies were already encrypted, and that stays non-negotiable.
- **Patching.** No SSH server, patched by the same guest-patch playbook as everything else.
- **Later.** Narrow the inbound rule's source from "the whole internal zone" to an address group of the actual consumers, once each one is confirmed working.

## Takeaways

- Check the vendor plan before you build the network for a feature.
- Build the isolated network first, so the sensitive service never runs anywhere else.
- Deliver credentials through a one-shot secret and compare by hash. Make the delivery playbook double as the rotation procedure.
- A router's domain allowlist only works if the router sees the DNS lookups. Point the client at the gateway's resolver, and do not "fix" it by opening 443 to everything.
- Prove isolation with repeatable probes from both sides.
- Make the fast path optional: prefer the local server for reads, fall back to the cloud on any failure, and keep writes on one well-understood path.
- A server that caches your vault is your vault. Back it up like one.
