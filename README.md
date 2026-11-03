# lessons-learned

Blog-style notes from a home lab and a few small tools, written as **old vs new** config changes with the reasons behind them.

## Posts

- [Old vs New: Seven Config Changes From a Homelab (and the Tools Around It)](posts/2026-11-old-vs-new-configs.md)
- [A New Firewall Zone Blocked Everything: Staging Network Segmentation Safely](posts/2026-11-staging-a-firewall-zone.md)
- [NVR Tuning: From a Pegged GPU to a Quiet, Useful Alert Stream](posts/2026-11-nvr-tuning.md)
- [Tiered Video Storage: Hot on Ceph, Cold on the NAS, and the Stale NFS Handle](posts/2026-11-tiered-video-storage.md)
- [Rebuilding a Service From Code and Backup: A Rehearsal That Found 13 Bugs](posts/2026-11-rebuild-test.md)
- [A Disaster-Recovery Drill That Actually Boots the Guests](posts/2026-11-dr-restore-drill.md)
- [Auto-Patching a Cluster Without Surprising the Household](posts/2026-11-auto-patching-a-cluster.md)
- [Taming the *arr Stack: Stuck Imports, Duplicate Grabs, and Delay Profiles](posts/2026-11-taming-the-arr-stack.md)
- [Secrets for Agents: A Scoped Vault, Wrapper Scripts, and Redaction by Default](posts/2026-11-secrets-for-agents.md)
- [Letting an AI Agent Operate Your Lab: The Guardrails That Kept It Safe](posts/2026-11-guardrails-for-ai-agents.md)
- [A Local AI Host on an M1 Laptop: Model Serving, Sync, and Tuning](posts/2026-11-local-ai-on-a-laptop.md)
- [Couch Gaming on Linux: Chasing Audio Dropouts Through Four Layers](posts/2026-11-couch-gaming-audio-dropouts.md)

## How the content was sanitized

Source material came from private repositories and working notes. Before publishing, everything was reduced to a public-safe form:

| Removed or replaced | Example |
|---|---|
| Public and private IP addresses | `192.0.2.x` (documentation range) |
| Hostnames, node names, domains | `node-a`, `example.invalid` |
| Container and VM IDs | not shown |
| Account names, usernames, email addresses | not shown |
| Passwords, tokens, API keys, VPN credentials | never shown; env-var names only |
| Vault and item names | not shown |
| Media titles and library paths | not shown |
| Game and service specifics that identify a server | generalized |

Snippets are shaped like the real configs and show the real change in intent, but values are placeholders. Verify against your own system before you apply anything.

## Contributing

Before adding a post, check it for anything in the table above. If in doubt, leave it out.
