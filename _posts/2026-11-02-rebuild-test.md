---
title: "Rebuilding a Service From Code and Backup: A Rehearsal That Found 13 Bugs"
date: 2026-11-02 10:33:00 -0600
corgi: blueprint
---

**Contents**

1. [The test](#the-test)
2. [The structure that made it safe](#the-structure-that-made-it-safe)
3. [Results](#results)
4. [Bug 1: the half-installed app](#bug-1-the-half-installed-app)
5. [Bug 2: the missing cron jobs](#bug-2-the-missing-cron-jobs)
6. [Smaller bugs, big pattern](#smaller-bugs-big-pattern)
7. [Rollback and the hands-off cleanup](#rollback-and-the-hands-off-cleanup)
8. [What it proved, and what it did not](#what-it-proved-and-what-it-did-not)
9. [Takeaways](#takeaways)

---

## The test

"I have backups" and "I can rebuild" are different claims. To test the second, I picked a small, boring service (a dashboard app running in Docker inside an LXC container) and rebuilt it as a **new** container from the repo plus a backup, then cut over to it. The old container was stopped and left intact. Nothing was destroyed.

The rule: no hand steps. If I had to log in and fix something, the repo was missing something, and that is what the test was for.

## The structure that made it safe

One playbook family, with separate phases that can run independently:

| Phase | What it does |
|---|---|
| `check` | Read-only. Prints the plan and gates. |
| `diag` | Read-only. Compares config trees, image IDs, logs. |
| `build` | Creates the new container on a **temporary address**, restores only the app's config from a fresh backup, starts it. |
| `rehearse` | Reboots the new container and confirms the app returns by itself. |
| `cutover` | Stops the old container, reads the final config from the *stopped* old container, moves the real address to the new one, registers with HA. |
| `rollback` | Reverses cutover, in one template. |

Building on a temporary address meant I could verify the new container fully (page loads, same image ID, same database checksum as the backup, same links all returning 200) before anything user-visible changed.

An automatic rollback was built into cutover: if the health check fails, the old container is restarted and the address moved back.

## Results

| Step | Result | Time |
|---|---|---|
| Fresh backup of the old container (~480 MiB) | ok | 1m40s |
| Build the new container from code, restore config | ok | 2-3 min (about 5 min on the first run: package and image pulls dominate) |
| Verify on the temp address | ok | seconds |
| Reboot rehearsal | app back by itself | 45 s |
| Cutover | ok | 1m26s task time, **45 s of app downtime** |

About 55 minutes of wall-clock time including all the debugging. A clean run from scratch is roughly 7 minutes.

## Bug 1: the half-installed app

This one cost the most time. Two cutover attempts failed and rolled back automatically (3 and 5.5 minutes of downtime), before I found the cause.

The image installs the app on the **first start of a new container** (a slow copy across overlay layers). My restore step did `compose down` then `up -d`, which creates a new container, and then shut the whole LXC down for a snapshot-consistent copy. Shutting down mid-copy left a half-installed app directory. It returned HTTP 500 and **survived restarts**, because the copy never ran again.

**Old**

```text
restore: compose down -> restore files -> compose up -d -> reboot CT immediately
```

**New**

```text
restore: stop container (do not remove) -> restore files -> start -> wait for HTTP 200
         -> if unhealthy: recreate once
         nothing reboots the CT before the health check passes
```

**Lesson.** "First start" can be a long, non-atomic operation. A restart or shutdown in the middle of it can leave state that no later restart repairs. Wait for health before doing anything disruptive.

## Bug 2: the missing cron jobs

After the cutover, the monitoring system alerted: "Containers on `<service>`: no report". The old container had been running two small collector scripts from cron, plus a token file, installed by an ad-hoc installer script over SSH. They were never part of the rebuild code, so the new container lacked them.

Fix: a playbook that installs the collectors, a secret supplied from the vault into the runner's environment at run time, and the rebuild playbook now includes it.

**Lesson.** The only reliable inventory of what a machine does is a rebuilt machine that does less. Before the next rebuild, check every other collector and cron job a guest receives from that installer.

## Smaller bugs, big pattern

| # | Symptom | Cause |
|---|---|---|
| 1 | `pvesm list --output-format json` failed | That flag does not exist. Use the API client (`pvesh`). |
| 2 | Cluster gate failed right after a snapshot backup | Placement groups were not clean for about a minute (snapshot trimming). Wait and rerun. |
| 3 | `tar --wildcards` on a directory and `dir/*` returned "Not found" | The directory pattern already includes its contents. |
| 4 | A wait loop died on the first refused connection | `set -e` plus `c=$(curl ...)`: curl exit 7 aborted the script. Add `\|\| true`. |
| 5 | The image tag in the plan was stale | The running image had been updated. The build now asserts the new container runs the same image as the old one. |
| 6 | The IP table listed a free address that was not free | The table lagged reality. Ping and ARP check before using an address. |
| 7 | A check for HA registration always returned 0 | The `grep` pattern did not match this version's output. Use the API. |

Item 7 has a nasty corollary. A *different* playbook (the restore drill) used the same pattern, so its "is it registered with HA" check had never really checked anything. A check that cannot fail is worse than no check, because it looks like coverage.

## Rollback and the hands-off cleanup

Rollback is one template that removes the new container from HA, shuts it down, gives it the temp address, starts the old one and announces the address with a gratuitous ARP. The by-hand version is documented as five commands, in case the automation is the thing that is broken.

Destroying the old container is **not automated**. The notes spell out the command for the owner to run after a few days. Destruction is the one step that has no undo.

## What it proved, and what it did not

Proved: the container, its Docker setup, cache and timezone settings, the app definition, HA registration and the data all come from code plus a backup with no hand step, and the user-visible downtime was 45 seconds.

Not covered: restoring the same data from the off-site copy (that is a separate drill, covered in [the next post]({% post_url 2026-11-02-dr-restore-drill %})) and rebuilding a hypervisor node.

## Takeaways

- Build the replacement beside the original, on a temporary address. Verify before cutting over.
- Make rollback a first-class template, and test the automatic path by actually failing.
- Never destroy the original in the same exercise.
- Watch for non-atomic "first start" operations. Wait for health.
- A rebuild exposes undocumented duties of the old machine. Look for cron jobs and token files.
- Audit your checks. A check that returns the same answer on every machine is not a check.
