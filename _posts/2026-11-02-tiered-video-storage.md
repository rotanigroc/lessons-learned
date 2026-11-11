---
title: "Tiered Video Storage: Hot on Ceph, Cold on the NAS, and the Stale NFS Handle"
date: 2026-11-02 10:32:00 -0600
corgi: patch-cables
---

**Contents**

1. [The problem](#the-problem)
2. [The design](#the-design)
3. [The failure mode that matters: a dead NFS server](#the-failure-mode-that-matters-a-dead-nfs-server)
4. [Old vs new: detecting a stale mount](#old-vs-new-detecting-a-stale-mount)
5. [Old vs new: the free-space alert that never fired](#old-vs-new-the-free-space-alert-that-never-fired)
6. [Healing everything else that mounts the NAS](#healing-everything-else-that-mounts-the-nas)
7. [Takeaways](#takeaways)

---

## The problem

An NVR wrote its recordings to a NAS over NFS. When the NAS rebooted or its array stopped, the NVR hung on I/O, and recording stopped. A security camera system should not depend on the least reliable box in the house.

## The design

Record locally on fast, replicated storage. Move old footage to the NAS later. Make the NVR see one tree.

- **Hot tier.** A 100 GiB volume on the cluster's replicated block storage, attached to the NVR container. It follows the container on a failover. Excluded from guest backups (footage is not worth backing up).
- **Cold tier.** The NAS over a *soft* NFS mount, mounted only while the NAS answers.
- **One tree.** A union filesystem (`mergerfs`) merges hot (read-write) and cold (no-create) into one path per directory (`recordings`, `clips`, `exports`), bind-mounted into the container at the same paths as before. New files land only on hot. Reads and deletes see both, so existing database paths stay valid and the 73 GiB already on the NAS needed no migration.
- **Offload.** A mover runs every 15 minutes and `rsync`s files older than 24 hours to the same relative path on the NAS, then removes the source. A space rule also applies: when hot reaches 80% it flushes oldest-first down to 60%. The mover does nothing while the NAS is down.
- **Boot order.** The container runtime is ordered after the union service (`Requires`). Without that, a plain NFS entry in `fstab` could let the NVR start against empty local directories and record there.

Hot growth was about 10 GiB per day, so 100 GiB gave roughly nine days of margin with the NAS down. Beyond that, the NVR's own cleanup drops the oldest footage.

The test: block the NAS with a firewall rule in the container for two minutes. New segments kept appearing, the UI loaded, the cold mount went away on its own, and everything came back when the rule was removed.

## The failure mode that matters: a dead NFS server

A hard NFS mount blocks processes in uninterruptible sleep when the server vanishes. That is the thing to avoid. The design uses three defenses:

1. A `soft` mount.
2. A 30-second timer that checks the NAS and **lazy-unmounts** the cold tier when it stops answering. The cold directory then falls back to an empty local stub, so the union stays responsive.
3. The union's free-space reporting ignores the cold branch, so the NVR's disk-pressure logic tracks the hot volume.

## Old vs new: detecting a stale mount

The script that keeps the mount healthy had a subtle bug. After the NAS came back from an outage, the old handle was *stale*. The check `mountpoint -q` **errors** on a stale handle, which the script read as "not mounted", so it tried to mount over it and failed, forever.

**Old**

```bash
mounted() { mountpoint -q "$COLD"; }
```

**New**

```bash
# not mountpoint(1): it errors on a stale handle, which then looked "unmounted"
# and mount failed forever
mounted() { grep -qs " $COLD " /proc/mounts; }
```

Reading `/proc/mounts` reports the truth without touching the filesystem. The rest of the script stays the same:

```bash
if mounted; then
  if ! nfs_up || ! timeout -s KILL 8 stat -t "$COLD/." >/dev/null 2>&1; then
    umount -l -f "$COLD" 2>/dev/null || umount -l "$COLD"    # lazy: never hangs
  fi
elif nfs_up; then
  timeout 30 mount "$COLD"
fi
```

Notice the two probes: a TCP connect to port 2049 (is the server there?) and a `stat` under `timeout -s KILL` (does the mount actually work?). A server can answer a TCP connect and still hand out stale handles.

**Lesson.** Any command that touches a possibly-dead mount can hang or lie. Prefer reading kernel state (`/proc/mounts`), and wrap everything else in `timeout -s KILL`.

## Old vs new: the free-space alert that never fired

The monitoring alert for the recordings volume used a percentage of free space. It never tripped. The union reports free space for the *hot* branch only (the cold branch is ignored on purpose), so a percentage was the wrong unit for the signal I cared about.

**Old:** alert when free space is below a percentage.

**New:** alert on an absolute free-space threshold on the hot volume, tuned from the observed normal range.

```text
free space threshold: 40 GB -> 10 GB
(the union shows hot free space only; 20-40 GB is normal)
```

The first threshold of 40 GB would have alerted constantly, because 20-40 GB is the normal operating range with a 24-hour hot window. Ten gigabytes is the point where the mover is not keeping up.

## Healing everything else that mounts the NAS

The NVR is the special case, because it has its own timer and a soft mount. Everything else that mounts the NAS (other containers, Docker containers inside them) tends to go stale together after an outage. A second tool heals those, in layers, in order:

1. **Node mount.** Lazy unmount and remount on the hypervisor.
2. **Container bind.** A bind mount cannot be refreshed from outside, so the container is rebooted.
3. **Docker container.** Restart any container whose bind sits under such a mount.

Each fix re-checks the layers above it, because remounting a node mount makes the binds above it stale.

The guardrails matter more than the fix:

- Act only when the NAS is *up and its array is started*, which it detects by mounting a read-only probe export that exists only while the array is running.
- A stale item must have been seen on an earlier run as well, so a transient blip does not trigger a heal.
- Per item: a 20-minute cooldown and at most three heals per day.
- The NVR container is excluded, because it has its own mechanism.
- A maintenance mode detaches everything cleanly before a planned NAS shutdown and reattaches it afterwards.

**Lesson.** Automatic healing needs rate limits and a kill switch, or the healer becomes the incident.

## Takeaways

- Do not make a recording system depend on a flaky mount. Put the hot path on local, replicated storage.
- Make the cold tier optional: soft mount, lazy unmount, empty fallback directory.
- Check mounts by reading `/proc/mounts`, not by calling something that can hang.
- Alert on absolute free space of the volume that matters.
- Heal in layers, with evidence requirements, cooldowns, and a maintenance switch.
