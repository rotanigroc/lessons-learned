# Old vs New: Seven Config Changes From a Homelab (and the Tools Around It)

Most of what goes wrong in a home lab is boring: a memory limit that is too low, a unit that fails on a box with no hardware for it, a reverse proxy that serves the wrong thing to the wrong host. Fixing it is usually a few lines. This post walks through seven real changes, each shown as the old config next to the new one, with the reason for the change.

Everything here is sanitized. IP addresses, hostnames, domains, usernames, container and VM IDs, account names, and media titles are replaced with placeholders such as `192.0.2.10` (a documentation-only range) or `node-a`. The snippets are faithful in shape and intent, but they are not copy-paste-ready for your system. Check every value against your own setup before you apply it.

---

## 1. Give a media container enough memory before it starves

**Symptom.** The NVR web UI stopped answering. Detection latency went from about 20 ms to over 300 ms. Five of six camera feeds were processing at a tiny fraction of their normal rate. Recordings stopped on all cameras except one. Nothing alerted.

**Cause.** The container had hit its memory cap. Memory was about 99% used, and the kernel spent its time evicting and re-reading the same files from shared storage. Disk reads were high and writes were zero. The host load was very high at 0% CPU, which is the signature of tasks blocked on I/O. The cap had been set before the workload grew: larger detection frame sizes, a new license-plate model, semantic search, and a large face model had all been added on top.

**Old**

```ini
# guest config (LXC/VM), memory in MiB
memory: 6000
```

**New**

```ini
# guest config (LXC/VM), memory in MiB
# raised after the stall; the host has ~1 GiB headroom guard
memory: 8800
```

**What changed beyond the number.**

- The raise was done live through a runbook, not by hand, and it was guarded: the playbook refused 9000 because it would have left the host with less than 1 GiB of headroom. Choosing 8800 kept headroom.
- A restart playbook was added to restart the container and verify every camera's processing rate, rather than assuming a restart fixed everything. Four cameras stayed wedged after the memory raise and needed the restart.
- A read-only diagnostics playbook was added. Its hardware probe could hang when the container was starved, so it got a 45-second time limit and was moved to run last.

**Lesson.** A memory cap is a capacity decision. Re-check it when the workload changes, and alert on the signal that predicts the failure (memory pressure above a threshold for five minutes, and "no new recording segment for a camera in five minutes"). The incident had neither alert, so the first sign of trouble was a dead UI.

---

## 2. Stop a failed unit on a host that cannot run it

**Symptom.** A health check kept failing on one Proxmox node. The cause was a system service that tries to talk to a hardware management controller (BMC). The node has no BMC.

**Old.** The service was installed everywhere and failed on boot on any node without the hardware. The health check reported that as a fault, and the failed state stayed set.

**New.** A playbook that acts only when all three conditions hold: the package is installed, there is no IPMI device node, and the unit is in the `failed` state. It masks the unit and clears the failed state. A node that *does* have a BMC and a failed unit is treated as a real fault and left alone.

```yaml
- name: Mask the unit (it cannot start without a BMC)
  when: fixable == 'yes'
  ansible.builtin.systemd:
    name: openipmi.service
    masked: true
    state: stopped

- name: Clear the failed state
  when: fixable == 'yes' and not ansible_check_mode
  ansible.builtin.command: systemctl reset-failed openipmi.service
  changed_when: true
```

**Lesson.** Make a fix conditional on evidence, not on a hostname list. Make it reversible too: the playbook header documents the rollback (`systemctl unmask`). Note the difference between "failed on a node that cannot run it" (fix) and "failed on a node that should run it" (investigate).

---

## 3. Let a transcoder drop what it cannot copy

**Symptom.** A Mac node running hardware-accelerated HEVC encoding failed on some files with `Subtitle codec 0 is not supported` and `Could not write header`. The subtitle track was WebVTT inside MKV, which the bundled ffmpeg could not identify, so the stream had no codec name.

**Old.** The flow copied every stream. Any unknown or unsupported subtitle stopped the whole job, and every audio track kept the default flag from its source. A converted stereo track could end up flagged default alongside the surround track.

**New.** A custom step, placed between "ensure stereo AAC" and "execute":

```bash
# illustrative: the real step is a JS plugin; these are the ffmpeg intents
# subtitle streams with no known codec: drop them
-map -0:s:0 ...                       # drop codec-less subtitle stream(s)
# text subtitles mp4 can't copy into MKV: convert them
-c:s:0 srt
# exactly one default audio track: the highest-channel one
-disposition:a:0 default
-disposition:a:1 0                    # clear default on every other audio stream
```

**Lesson.** A transcode pipeline that copies everything fails on the first stream it does not understand. Decide per stream type what is kept, converted, or dropped, and say so in the job log. The monitor was also changed to include the ffmpeg failure reason in its alert, so an error is diagnosable from the notification alone.

---

## 4. Harden the reverse proxy and the appdata backup together

A review of one storage server's container configs produced a table of findings. Here are four of the fixes, the ones with the largest gap between the old and the new state.

### 4a. Database auth: `trust` to `scram-sha-256`

**Old** (`pg_hba.conf`): any local process, including any container sharing the network namespace, could log in with no password, including replication rows.

```conf
host    all   all   127.0.0.1/32   trust
host    replication all 127.0.0.1/32 trust
```

**New.** Set a superuser password first, test from a second session, then reload. Narrow the remote rule to the container and LAN subnets:

```conf
host    all   all   127.0.0.1/32      scram-sha-256
host    all   all   172.16.0.0/12     scram-sha-256   # docker bridge range
host    all   all   192.0.2.0/24      scram-sha-256   # LAN
```

Do not forward port 5432 on the router.

### 4b. Default TLS vhost: stop serving the real certificate to every scanner

**Old.** The catch-all `default_server` on 443 served the real wildcard certificate and the site root to any hostname or raw IP that reached it.

**New.** Reject handshakes on the default server and keep only named virtual hosts:

```nginx
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    ssl_reject_handshake on;
}
```

### 4c. Stream proxy: remove the invalid block and the PROXY protocol

**Old.** A stream-context file contained an HTTP-style `server {}` with nested `server {}` blocks, and `proxy_protocol on;` toward a game server. Both `nginx -t` and the game connection broke. The game server does not parse PROXY protocol.

**New.** One file, one listener, no PROXY header:

```nginx
# TCP only: game servers in this setup do not use UDP
server {
    listen 7777;
    proxy_pass 192.0.2.77:7777;
}
```

### 4d. File permissions on secret-bearing configs

**Old.** Config files with plaintext VPN credentials were mode `775`, and a Telegraf config containing an InfluxDB login was `666`.

**New.**

```bash
chmod 600 vpn-client/openvpn/credentials.conf
chmod 644 metrics-agent/conf/agent.conf    # no literal secrets in it; use env refs
```

For the Telegraf case, the review also recommended a write-only database user instead of the admin user, and a read-only Docker socket proxy instead of mounting the raw socket.

**Lesson.** Sort findings by blast radius. The trust-auth database and the socket mount were root-equivalent or open-to-the-world risks, so they got fixed first. Small permission bugs are cheap to fix and easy to forget. A backup that copies every secret needs the same protection as the live files, which means encrypting the copies or keeping them locked down.

---

## 5. Keep passwords out of config files

A camera-control CLI written in Rust reads its device list from a TOML file. The first draft of its example config put passwords inline. The version now in use prefers an environment variable.

**Old**

```toml
[cameras.front_door]
host = "192.0.2.40"
user = "admin"
password = "<plaintext secret>"
```

**New**

```toml
# Copy to ~/.config/amcrest/cameras.toml or point AMCREST_CONFIG at it.
# Prefer password_env over inline passwords.

[cameras.front_door]          # doorbell
host = "192.0.2.40"
user = "admin"
password_env = "AMCREST_ADMIN_PASSWORD"

[cameras.driveway]            # limited user: admin-only calls return 403
host = "192.0.2.41"
user = "stream"
password_env = "AMCREST_STREAM_PASSWORD"
```

The loader supports both fields, and it fails fast when neither is set:

```rust
(None, None) => bail!("{name}: set password or password_env"),
```

**Lesson.** Make the safe path the easy path. The example file, the loader, and the README all say the same thing, so a new user copies the right pattern without reading a security note. A limited-permission account for streaming is also worth it: the driveway camera returns `403` for admin-only calls, which is the access control working.

---

## 6. Put a hard budget in front of an API you script against

**Symptom.** A set of scheduled and event-driven scripts call a paid LLM API. Without a guard, a bug in one loop or a bad input can spend the monthly allowance before anyone notices.

**Old.** Scripts called the API directly and logged nothing about cost.

**New.** Every call goes through one client wrapper. It estimates the worst-case cost of a call, refuses it if month-to-date spend would pass a configured cap, and writes tokens and dollars to a usage log. The cap is set by an environment variable with a default. Nightly work uses the batch interface at half the price. The key is loaded from a secrets vault into the process environment at run time and is never written to a file.

```python
# common/client.py (shape only)
def call(...):
    worst = estimate_worst_case(model, max_tokens, prompt)
    if month_to_date() + worst > CAP_USD:
        raise BudgetExceeded(...)
    resp = _api.messages.create(...)
    log_usage(project, model, resp.usage)
    return resp
```

**Lesson.** A budget that lives only in the provider's console is a notification, not a control. A check in your own client is a control. Use a cheap model for high-volume per-event work, and the batch interface for work that can wait.

---

## 7. Check, then apply, for every playbook

Several of the changes above came from playbooks that follow one pattern, which is worth copying:

1. **Collect** facts with read-only commands and register them.
2. **Report** what would change, with a plain-language message per host.
3. **Apply** only when the condition holds, and skip the change in check mode.
4. **Print a result line** with a stable prefix, so a scheduler or a log search can find it.
5. **Document the rollback** in the header of the file.

The pattern costs about 20 extra lines per playbook. It has paid for itself: a playbook that says "REAL FAULT: BMC present, check by hand" is a playbook that does not silently "fix" the wrong machine.

---

## Takeaways

- Caps and limits are capacity decisions. Revisit them when the workload changes, and alert on the signal before the failure.
- Make fixes conditional on evidence and reversible.
- Pick the safe default in the example config, the loader, and the docs at once.
- Secrets belong in the environment or a vault, not in files that also get backed up.
- Put a budget check in your own code, not only in the provider's dashboard.
