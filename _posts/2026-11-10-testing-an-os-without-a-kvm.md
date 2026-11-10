---
title: "Testing a Hobby OS on Real Hardware Without a KVM: QEMU, PXE and SSH"
date: 2026-11-10 12:15:00 -0600
---

**Contents**

1. [The problem](#the-problem)
2. [Two loops, one contract](#two-loops-one-contract)
3. [Loop 1: QEMU on every change](#loop-1-qemu-on-every-change)
4. [Loop 2: the real laptop, driven by the network](#loop-2-the-real-laptop-driven-by-the-network)
5. [The answer file: one reboot updates the disk](#the-answer-file-one-reboot-updates-the-disk)
6. [Knowing which build answered](#knowing-which-build-answered)
7. [Bugs only the real machine found](#bugs-only-the-real-machine-found)
8. [Updating without a netboot, and the trap in it](#updating-without-a-netboot-and-the-trap-in-it)
9. [Smaller lessons](#smaller-lessons)
10. [Takeaways](#takeaways)

---

## The problem

I have a side project: a boot manager and small operating system for x86_64 PCs, written in Rust. One image boots from CD, USB or disk on BIOS and UEFI. It has a Setup wizard that installs to a disk, a Startup Repair tool, a desktop with a few apps, a rescue shell, and (later) a network stack with an SSH server.

Testing an OS is awkward. The thing under test *is* the machine. If a change breaks the boot, nothing on that machine can tell you why. The usual answers are a person at the keyboard, or an IP KVM that gives you the screen and keyboard over the network.

I had one spare BIOS laptop and no spare KVM. The goal: test every change on emulated hardware automatically, and test on the real laptop with nobody touching it.

**Old** (the first real-hardware check)

```text
build ISO -> write USB stick -> walk to the laptop -> boot menu key -> pick stick
-> work through a checklist of 10 checks -> photograph failures -> type up results
about 45 minutes per machine, per build
```

**New**

```text
every change:  cargo xtask qemu            headless, serial-driven, PASS/FAIL per scenario
real hardware: build -> publish to netboot -> ssh reboot -> wait for `ver` to show the commit
nobody touches the laptop; no KVM, no USB stick
```

## Two loops, one contract

The key decision came early: **the OS talks to tests over a text channel, and the same text works in QEMU and on hardware.**

Every UI screen (the wizard, the recovery menu, the desktop) also writes itself to the serial port as plain text: numbered controls, their state, their options. Input comes back the same way: a control number, `n=value`, an empty line for the default button. A test never reads pixels to find a button. It reads `[3] button: Startup Repair` and sends `3`.

In QEMU that channel is the emulated COM1 port. On the laptop, once there was a network stack, the channel became SSH. The commands are the same rescue-shell commands either way.

That contract lives in a document, and the harness is its acceptance test. When Setup changed, the contract changed first, and the harness failed loudly until the code caught up.

## Loop 1: QEMU on every change

`cargo xtask qemu` builds the ISO and boots it headless in a set of scenarios. Each one waits for expected lines on the serial stream, with a timeout. There are **no fixed sleeps**.

| Scenario group | What it proves |
|---|---|
| BIOS and UEFI, booted from CD and from disk | The same image boots four ways |
| Firmware settings | Recovery's "Firmware Settings" reaches the firmware's own setup screen (UEFI) |
| Install | The wizard installs to a blank 2 GiB disk on IDE, AHCI, NVMe and virtio, then the disk boots **alone** into the desktop |
| Persist | The editor saves a note, the machine reboots, the terminal reads the note back |
| Damage and repair | The harness corrupts the installed boot files in the image file, boots the ISO, runs Startup Repair, and the disk boots again |
| Programs | A program that faults is killed and the shell keeps working |
| SSH | Boot with a generated key, forward a host port to guest port 22, log in, check `ver`; a different key must be refused |
| Update | Install, push an update over SSH, reboot, check `ver`, roll back twice |
| Screenshots | QEMU monitor `screendump` of each screen once the serial transcript shows it |

A typical boot scenario runs in 12 to 17 seconds. The one that runs a batch of programs takes about two minutes.

A few details made it reliable:

- **Wait for a line, never for a time.** `expect("setup: installation complete")` with a generous limit, but also `expect_any([... "complete", ... "FAILED:"])`, so a failure ends the wait at once instead of sitting out the limit.
- **`-no-reboot`.** A guest restart becomes a QEMU exit. The harness then starts QEMU again with a different disk set (no ISO, same disk), which is exactly a "remove the stick and reboot" step.
- **Name the step that failed.** Output is `FAIL <scenario> step: wizard 6 (Choose a disk): <reason>` plus the serial log path. The step name is the page the harness was waiting for.
- **A blank screenshot is a failure.** If the middle third of a capture is one flat colour, it fails as `blank`. A screenshot job that "succeeds" with black images is the screenshot version of a check that cannot fail.
- **Fixed serial numbers on scratch disks.** The wizard lists disks with their serial, and the harness picks the line with its own serial. It can never choose the wrong disk.

QEMU caught most bugs. It did not catch the ones in this post's later sections, because QEMU's virtual NIC and TCP path are kinder than a real one.

## Loop 2: the real laptop, driven by the network

The laptop's firmware is set to **boot from the network first**. That one setting replaces the KVM.

```text
laptop powers on
  -> PXE -> netboot.xyz (iPXE) menu on the NAS
     -> per-MAC entry for this laptop:
          "test ISO"   : boot the newest SSH test build
          "local disk" : exit, so the firmware falls through to the internal disk
```

The pieces:

1. **Build.** `just iso-ssh KEY.pub` builds a test image with my SSH public key and `ssh = on` in its boot config. It is test-only and never released. Only ED25519 keys are accepted, and only the type and base64 part is embedded (no comment, so no username or hostname ends up in the image).
2. **Publish.** The build uploads the ISO to the Git server's package registry, then starts two runner templates: a read-only `check`, then `apply` with the URL and SHA-256. The NAS downloads the image, checks the hash, and puts it in the netboot menu's "SSH test" slot.
3. **Pick the entry.** Another check/apply template flips the laptop's own menu line between "test ISO" and "local disk". Every apply backs up the menu file first.
4. **Cycle.** A script sends `reboot` over SSH and waits for the laptop to answer again.

The same build-and-publish step also runs as a manual CI job on a runner in the lab, so a build does not need my laptop either.

**Old** (first version of publish)

```text
serve the ISO from the build machine on port 8000 -> netboot menu points at it
(port 8000 was often taken; moved to 8011; the menu broke when the Mac slept)
```

**New**

```text
upload ISO to the package registry -> NAS downloads it, checks SHA-256 -> menu slot
nothing is served from the build machine
```

**Lesson.** Do not make your build machine a server. It sleeps, it changes networks, and its ports are busy. Put artifacts somewhere that is always on, and pass a hash with them.

## The answer file: one reboot updates the disk

PXE alone would boot the new build every time, but the **installed** system on the laptop's disk would stay old. I wanted one reboot to leave the disk on the new build too.

The test ISO's boot config has one more line: `answer = repair`. Before showing the menu, the boot manager compares each installed system's kernel with the kernel it is running:

| Installed kernel | What happens |
|---|---|
| Different | Run the Startup Repair steps against that install, then restart |
| Same | Leave it alone; the menu's default becomes Desktop |
| No install found | Log `answer: no installed system to repair` and continue |

Two details mattered:

- **The "same" case must not repair again**, or the machine loops. Comparing kernels makes the second boot a no-op.
- **In-sync means "go to the desktop"**, not "open the Setup wizard" (the ISO's normal default). Without that, every netboot stopped at the wizard and waited for a person.

Startup Repair writes a fresh boot config for the installed system, so the SSH key and the `answer` line **never reach the installed disk**. The test-only settings stay on the test medium.

## Knowing which build answered

`ver` prints the build stamp and the short commit:

```text
myos 0.1.0, build 2026.11.09 16:15 UTC (46281bb), started by BIOS firmware
```

So "did my change land?" is a string match, and the cycle script is short:

```bash
# laptop-cycle HOST [COMMIT]
run() { perl -e 'alarm shift; exec @ARGV or die' 25 \
          ssh -o BatchMode=yes -o ConnectTimeout=8 "user@$host" "$1" </dev/null 2>/dev/null; }
run reboot >/dev/null || true
sleep 20
for _ in $(seq 1 60); do
  if out=$(run ver) && [[ "$out" == *"$want"* ]]; then echo "$out"; exit 0; fi
  sleep 10
done
echo "no answer with $want within 10 minutes" >&2; exit 1
```

One cycle can mean two PXE boots: the first repairs the disk and restarts, the second finds it in sync. The script does not care. It waits for the right commit.

**Old**

```bash
ssh -o ConnectTimeout=8 user@host ver
```

**New**

```bash
perl -e 'alarm shift; exec @ARGV or die' 25 ssh -o ConnectTimeout=8 user@host ver
```

`ConnectTimeout` only covers the TCP connect. A half-working SSH server that accepts the connection and then stalls hung the script forever. A hard cap per call (perl's `alarm`, since macOS has no `timeout` by default) fixed it, and `exec` keeps ssh's exit status.

**Lesson.** When you test something that may be half-broken, every wait needs a cap, including the waits inside your client tools.

## Bugs only the real machine found

QEMU's user-mode network is forgiving. The laptop's real NIC and a real LAN were not.

| Symptom on the laptop | Cause | Fix |
|---|---|---|
| 9 of 30 back-to-back `ver` calls refused | The SSH server had **one** listening socket. While a session held it, or while it closed, new connections got a reset | Re-listen right after each poll; then two sockets; then four |
| Any connection refused while one session stayed open | Same: one session used the only socket | Four listening sockets on port 22 |
| Ping replies took 0 to 1336 ms | The NIC driver is polled, and it read the receive pointer from a status block the card only refreshed when its interrupt-coalescing timer fired | Ask the card for a status update on every empty receive |
| `reboot` over SSH accepted and ignored at the desktop | Only the boot-menu loop checked the reboot request | The desktop loop checks it too; the QEMU SSH scenario now reboots from the desktop |
| An update upload took 544 s (about 8 KB/s) | SSH channel window of 1000 bytes, a 10 ms delayed ACK in the TCP stack, and Nagle holding small window-adjust packets | 1 MiB window, 32 KiB packets, immediate ACKs and no Nagle on SSH sockets |

The upload fix was measured in QEMU after the fact: a 4 MiB upload went from **84 KiB/s to 665 KiB/s**. A unit test now checks that 256 KiB of input takes at most 40 round trips (the old window needed 109), so the slow path cannot come back quietly.

Each of these became a QEMU or host test once understood. The real machine finds the bug; the emulator keeps it fixed.

## Updating without a netboot, and the trap in it

Netbooting a whole ISO is slow for small changes, so later builds added `update` over SSH: send a bundle of boot files with its SHA-256 and size, the machine writes it with the same steps as Startup Repair, keeps the previous bundle, and `update rollback` swaps back.

```bash
ssh user@host "update $(shasum -a 256 update.bundle | cut -d' ' -f1) $(wc -c < update.bundle)" < update.bundle
```

The trap: the laptop boots the network first, and the netboot ISO's answer file repairs any installed kernel that differs from **its own**. So the very next reboot would "repair" the fresh update back to the netbooted build.

The fix is the menu switch from earlier: before using `update`, flip the laptop's netboot entry to "local disk", so a restart falls through to the installed system. Two automation features that each made sense on their own undid each other.

**Lesson.** Every "self-healing" step has an opinion about what correct looks like. When you add a second way to change the system, check what the first one thinks of it.

The network boot also became the recovery path. A build that cannot boot, or boots but cannot log in, gets fixed by flipping the entry back to "test ISO" and power cycling. That is the job a KVM would do. The USB stick is now the last resort, not the first tool.

## Smaller lessons

- **Judge by output when exit codes lie.** The first SSH server could not send an exit status, so the QEMU scenario judged a login by the printed `ver` line. The update script still decides on the reply text (`ok: update ...`), because the connection can close before ssh reports a status.
- **A failed publish is not a failed build.** Early on, a broken publish step failed the whole build. Now the build succeeds and warns that publishing failed.
- **Name the real failure.** A moved repo left a dangling symlink to the secrets wrapper, and the publish step reported "token not found in vault". The script now checks that the wrapper exists and passes on its own error message.
- **Keep test-only things out of releases by construction.** The SSH key, `ssh_update` and the answer file are only added by the test build recipe, and Repair rewrites them away on the installed disk. A release build cannot carry them by mistake.

## Takeaways

- Give the system a text interface for tests, and use the same one on emulated and real hardware.
- Wait for lines, never for time, and stop waiting on the first failure line.
- Network boot first plus a per-machine menu entry is a cheap stand-in for a KVM: it can always put a known-good build on the machine.
- Put build artifacts on an always-on server with a hash, not on the build machine.
- Make every test build identify itself (`ver` with the commit), and wait for that string.
- Cap every wait, including inside ssh.
- Real hardware finds network and timing bugs that the emulator hides. Turn each one into an emulator test.
- Check that two automated "fix it" mechanisms agree on what correct looks like.
