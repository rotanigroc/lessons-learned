# lessons-learned

Blog-style notes from a home lab and a few small tools, written as **old vs new** config changes with the reasons behind them.

## Posts

- [Old vs New: Seven Config Changes From a Homelab (and the Tools Around It)](posts/2026-11-old-vs-new-configs.md)

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
