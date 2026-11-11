---
title: "Auto-Patching a Cluster Without Surprising the Household"
date: 2026-11-02 10:35:00 -0600
corgi: upgrade
---

**Contents**

1. [The goal](#the-goal)
2. [What triggers a patch](#what-triggers-a-patch)
3. [The hypervisor path](#the-hypervisor-path)
4. [The gaming PC path](#the-gaming-pc-path)
5. [Going live behind a flag](#going-live-behind-a-flag)
6. [Bugs that only showed up when it ran](#bugs-that-only-showed-up-when-it-ran)
7. [Stopping it](#stopping-it)
8. [Takeaways](#takeaways)

---

## The goal

When a security advisory is published for software running at home, patch the affected machine, reboot it if needed, and tell me. Do it without interrupting a movie, a recording, or somebody's game.

Home labs have two kinds of machines with opposite problems:

- **Cluster nodes** carry everything the household uses. Rebooting one at the wrong time moves a dozen services.
- **A gaming PC** sleeps most of the day. It must not be woken at random, and it must never be rebooted mid-game.

## What triggers a patch

The key design decision was to patch only on **evidence that a fix exists**:

- A Debian security advisory that matches a package on one of the nodes. The fix is in the security repo by definition.
- A Fedora stable security update whose exact package name matches one installed on the gaming PC.

Vulnerability databases, vendor advisories and Ubuntu items **never queue anything**: they carry no fix guarantee for these hosts, or no host runs them. The first run and any backfill queue nothing either, so turning it on does not patch the world.

Guests (containers and VMs) are handled by a separate playbook, not by this path.

A queue table has one row per host plus advisory, with a state: pending, patching, patched, waiting for image, failed.

## The hypervisor path

Every action is a visible task in the automation server with full output. The workflow only reads `RESULT` lines.

1. **Patch.** Behind a cluster gate: quorum, storage with no warnings (except known ones), placement groups clean, no HA errors. The patch step **never reboots**. A red gate leaves the request queued and retries in an hour.
2. **Reboot**, only if the patch said it was needed, only inside a window between the two backup times. Before any power action:
   - nothing busy (no backup, migration, restore or clone anywhere; no locked guest);
   - the other nodes are online and have RAM for every HA guest that must move, plus 10% headroom, each guest fitting on one node;
   - set storage `noout` and HA node-maintenance; wait up to five minutes for HA to move its guests off;
   - non-HA guests are shut down gracefully, never killed, and one that refuses aborts the run;
   - verify the node is empty, and only then reboot.
3. **Any failed check restores everything**: maintenance off, `noout` unset, stopped guests restarted. The run fails with `ABORTED ... no power action taken`. The reboot retries the next night and pages on the first and every third abort.
4. **After the reboot**, a restore playbook waits for quorum and all storage daemons, leaves maintenance and restarts the guests. If the node does not come back, it is left in maintenance with `noout` set, so a human looks before anything is undone.

**Old (manual)**

```text
apt full-upgrade; reboot; hope
```

**New**

```text
gate -> patch (no reboot) -> [window] -> clear checks -> maintenance + noout
     -> drain HA guests -> graceful stop of the rest -> verify empty
     -> reboot -> restore (wait quorum + OSDs) -> restart guests
     any failure -> undo everything, abort, retry tomorrow
```

## The gaming PC path

- **Wake-on-LAN first.** It is woken only inside a quiet-hours window (02:00-06:00). Outside it, the request waits.
- **A game gate** runs before staging the update, before the app updates, **again right before the reboot**, and before suspending. It recognizes a launched game by several signals: a Steam launch, a Wine or Proton executable, a gamescope app, a game-mode daemon, or a busy GPU. If a game is running, or the check itself cannot run, the result is `DEFERRED ... nothing was changed`, retried every 30 minutes, with a page after 24 hours.
- **Put it back to sleep.** If this run had to wake the machine, `sleep_after` suspends it again (never during a game).
- **Use the distro's own updater.** On this immutable OS image, the plain package upgrade fails with a signature error. The vendor's update tool works.
- **A fix can exist upstream before it exists in the image.** The queue marks it "waiting for image", retries every six hours for three days, then marks it failed and pages.

## Going live behind a flag

It ran for days as a dry run first: once a day per host it said what it would do. Going live is one constant at the top of the planner (`LIVE = true`) plus the id of the reboot template. Rolling back is the same constant, redeployed.

Before going live, what had and had not been exercised was written down:

- Verified: every playbook in check mode against the live hosts (the gate, the clearing checks and the capacity math on all three nodes, the game gate, the update check) and the planner logic offline against simulated automation-server answers for every path (patch, reboot window, abort, deferral, no-newer-image, rebooted).
- **Not exercised for real:** an actual patch, reboot or image apply run from the workflow.

Saying that out loud mattered. It told me which first run to watch.

## Bugs that only showed up when it ran

| Bug | Fix |
|---|---|
| The call to start a task sent no body, because the `sendBody` setting was an expression | Always send a body. |
| The start body was a string where the API wanted an object | Send an object. |
| The server refused a start and the workflow retried immediately | Show *why* it refused and back off for 30 minutes. |
| A patch run that had to wake the PC left it awake afterwards | `sleep_after` puts it back to sleep when the run was the one that woke it. |
| Wake-on-LAN from the laptop failed on a sleeping PC one day, but the same packet from the cluster nodes worked | The wake playbook sends from all three nodes. |

## Stopping it

- Deactivate the workflow. The queue keeps filling but nothing runs.
- Or flip `LIVE` back to false and redeploy.
- Every action is a visible task, so what it did is always readable.
- A manual webhook runs one cycle on demand, with a token.

## Takeaways

- Trigger on proof that a fix exists, not on every advisory.
- Never combine "patch" and "reboot" in one step. Reboot has its own window and checks.
- Every power action needs a pre-flight that proves the cluster can absorb the loss, and an undo that runs when any check fails.
- Leave a failed node in the failed state for a human, with the flags that make that safe.
- Gate on what people are doing, not just on what machines are doing. A game gate is a social feature.
- Ship it as a dry run, then behind one flag. Write down what has not been exercised.
