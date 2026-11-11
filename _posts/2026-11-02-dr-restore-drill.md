---
title: "A Disaster-Recovery Drill That Actually Boots the Guests"
date: 2026-11-02 10:34:00 -0600
corgi: on-fire
---

**Contents**

1. [Why a drill](#why-a-drill)
2. [The backup design](#the-backup-design)
3. [The drill](#the-drill)
4. [Results](#results)
5. [What the playbook enforces](#what-the-playbook-enforces)
6. [What it took to get a pass](#what-it-took-to-get-a-pass)
7. [What is still manual](#what-is-still-manual)
8. [Takeaways](#takeaways)

---

## Why a drill

A backup that has never been restored is a hope. A restore of the *local* staging copy proves less than it seems, because the local copy is the one most likely to be destroyed in the incident you are insuring against (fire, flood, power surge, ransomware). The copy that matters is the off-site one, encrypted, in a cloud drive.

The goal: restore from the off-site copy into guests that boot.

## The backup design

- Each hypervisor node dumps its guests to its own folder. A verification step checks that **every guest produced a dump**, so a missing one is a failure, not silence.
- A worker encrypts and deduplicates the staging directory (restic), then pushes it to a cloud drive through rclone.
- A run lock prevents two runs from overlapping. Files are copied without owner IDs.
- A scheduler runs it nightly and a watchdog alerts if it does not.
- The encryption password and cloud credentials live only inside the backup container. The restore drill uses the container's own environment file and never prints it.
- False failures were fixed along the way: a glob check on dump files, `tar` exiting 1 on files that changed while being read, and a monitor store that is live and cannot be consistently copied.

## The drill

One playbook, run through the automation server (never ad-hoc), with a `check` mode that prints the plan and gates and an `apply` mode that executes.

1. Restore only the paths needed from the off-site copy, inside the backup container: one container dump, one VM dump, and the newest home-automation backup.
2. Copy the three files to a hypervisor node.
3. Verify the home-automation backup's structure: list the archive, find the manifest, confirm the expected parts are present.
4. Restore the container dump as a **spare** container with a high ID.
5. Strip its network, bind mounts and autostart before first start. Boot it and check it reports a running system.
6. Restore the VM dump as a spare VM. Strip network, passthrough devices and autostart. Boot it and confirm it stays running for 60 seconds.
7. Destroy both spares. Remove scratch files. Run a cleanup check that confirms nothing is left.

## Results

| Step | Result | Time |
|---|---|---|
| Restore three items from off-site (2.6 + 1.9 + 1.2 GiB) | ok | 2m52s |
| Copy to node | ok | 41 s |
| Home-automation backup: 18 entries, manifest, expected parts | ok | seconds |
| Restore spare container | ok | 49 s |
| Boot spare container | running, no physical NIC | 15 s |
| Restore spare VM | ok | 24 s |
| Boot spare VM | running for 60 s | ~2 min |
| Destroy spares, clean up | verified empty | |

About eight minutes of wall time from cloud drive to booted guests.

## What the playbook enforces

- **Never during the backup window.** The run refuses to start in the nightly backup hours.
- **Cluster gate first.** Quorum, storage health, no HA errors.
- **Spare IDs only.** IDs must be at or above 9900 and absent. An existing spare is never touched.
- **Networking is removed before the first start**, so a restored guest can never take the production address or conflict with the original.
- **No HA registration**, so the cluster will not try to manage the spare.
- **An `always:` block destroys the spares and scratch even when the drill fails.**

The last two are the important design choices. The danger of a restore drill is that it works too well: you boot a second copy of a production service on the same network. Everything above is aimed at making that impossible.

## What it took to get a pass

Three earlier runs failed. Each cleaned up after itself, which proved the `always:` block.

| Failure | Fix |
|---|---|
| Network check too strict on a container that runs Docker: bridge and veth interfaces appeared | The check now ignores Docker bridges and veths. Only a real NIC fails it. |
| The VM restore tool rejected the staged filename (twice) | `qmrestore` wants a dump-style archive name. The playbook renames on pull. A real rebuild needs the same rename. |

The container dump restored as-is.

A practical note: each run pulled about 5.6 GiB from the drive. By the time it passed (the fourth run that day), the total was about 22 GiB. Cloud drives meter bandwidth, so debug the drill on the smallest inputs you can.

## What is still manual

- The home-automation backup was verified *structurally*, not opened in a test instance. Backups can be encrypted, in which case the key is needed.
- The encryption password must be kept **outside** the lab. If it only exists on the machine that burned down, the off-site copy is noise. This is documented as an owner step and cannot be automated.

## Takeaways

- Restore from the copy that survives the disaster, not the convenient one.
- Make the drill refuse to harm production: strip networking, use spare IDs, skip HA registration.
- Put the cleanup in an `always:` block, and test that it works by failing.
- Verify the backup job itself checks that every guest was dumped.
- Keep the key to the backup somewhere that does not share a fate with the backup.
- Count what you spend on bandwidth while debugging.
