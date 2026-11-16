---
title: "CraftPane Runs DOOM: Two Weeks From First Boot to a Win32 Game in a Window"
date: 2026-11-16 09:45:00 -0600
tags: [craftpane, ai]
corgi: cheering
tldr:
  - "CraftPane, a hobby OS written from scratch in Rust, now runs an unmodified Windows build of DOOM (FreeDoom data) in a desktop window, in QEMU and on a real laptop."
  - "It took two weeks and about 475 commits, mostly written by Claude Code agents working from written plans, with me answering their questions and signing off each milestone."
  - "DOOM needed 25 Win32 functions CraftPane did not have yet. A tiny test program of our own proved windows, messages and drawing before DOOM ever ran."
  - "Real hardware found the last bug: a KVM keyboard's empty USB packet released every held key, so DOOM saw taps instead of a walk. QEMU never showed it."
slideshows:
  doom:
    - src: /assets/posts/craftpane-doom/01-qemu-title.webp
      width: 1024
      height: 768
      alt: "CraftPane desktop in QEMU: a Terminal window behind a FreeDoom window showing the Phase 1 title screen, and a small dock at the bottom"
      caption: "QEMU: started from the Terminal, DOOM opens as an ordinary window beside it."
    - src: /assets/posts/craftpane-doom/02-laptop-e1m1.webp
      width: 1280
      height: 720
      alt: "CraftPane desktop on the laptop, captured over HDMI: a FreeDoom window showing the first level with two monsters ahead"
      caption: "The laptop, captured over HDMI: the first level, started with keyboard input sent from the KVM."
    - src: /assets/posts/craftpane-doom/03-held-key-before.webp
      width: 1204
      height: 378
      alt: "Eight frames of DOOM taken while the left arrow is held: the view is the same in every frame"
      caption: "Before the fix: Left arrow held for three seconds, and the view barely moves. Every hold arrived as one tap."
    - src: /assets/posts/craftpane-doom/04-held-key-after.webp
      width: 903
      height: 378
      alt: "Six frames of DOOM taken while the left arrow is held: the view turns steadily from frame to frame"
      caption: "After the fix: the same held key turns the view steadily, and it stops when the key is released."
---

CraftPane is my hobby operating system: a boot manager, installer and desktop for x86_64 PCs, written from scratch in Rust. Today it ran DOOM. Not a port written for it: the ordinary Windows build of an open-source DOOM engine, playing the free FreeDoom game data, in a window on the CraftPane desktop. Here is the first run, on the test laptop:

<div class="video-embed">
<iframe src="https://www.youtube-nocookie.com/embed/yJlOrfqBa5o" title="CraftPane - FreeDOOM First Run" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

The testing side (QEMU on every change, a real laptop that nobody touches) has [its own post]({% post_url 2026-11-10-testing-an-os-without-a-kvm %}). This one is about the road to the milestone, and what DOOM itself needed.

## Two weeks, in milestones

The repository started on 2 November. Each block below is a plan that agents carried out in waves, ending in a QEMU run that had to print `PASS`.

| Days | What landed |
|---|---|
| Day 1 | One kernel for BIOS and UEFI, memory and page tables, GPT and FAT32, a Setup wizard that installs to a disk, Startup Repair. The QEMU harness and a licence gate came in the first hour. |
| Day 2 | Networking (a virtual NIC, then a port of a real driver for the laptop's wired NIC), DHCP, ping, an SSH server with key-only login. User mode: ring 3, a program loader, a scheduler, a fault in a program ends only that program. |
| Days 3 to 7 | A Win32 layer: a loader for Windows `.exe` files, more than a thousand Windows and C runtime functions (many of them simple stubs), a batch-file interpreter, and NTFS writes. Small Windows command-line programs began to run. |
| Days 8 to 13 | CraftPane as an installed OS: four partitions, an NTFS data partition that Windows' own disk check accepts, a read-only system partition verified at boot, registry hives that persist, updates and rollback over SSH, and a redesigned desktop. |
| Days 14 and 15 | Loading Windows-style kernel drivers (a side road), then the DOOM plan: windows, messages and drawing for Win32 programs, run beside the desktop. |

About 475 commits in all. Nearly every one was written by a Claude Code agent and lists the model that wrote it. My part was the product owner's: decide what to build, answer each plan's open questions, run the checks that needed my hands or my Windows machine, and sign off.

## Why DOOM, and which DOOM

DOOM is the classic "does this thing really work" test because it needs a little of everything: files, memory, a timer, keyboard input and a screen to draw on, at a steady frame rate. It also exposes the gap between "programs run" and "programs feel right".

The plan compared two Windows builds before writing any code, by listing the functions each one imports from Windows (names only, no code read):

| Candidate | What it needs from Windows | Verdict |
|---|---|---|
| A small open-source engine with a plain Win32 backend | 98 imported functions from 4 system libraries; one window, one message loop, one drawing call; one thread; no sound | **First** |
| A popular full-featured engine | 33 DLLs (graphics, audio and MIDI libraries), 541 missing system functions, threads and C++ exceptions | Later, its own milestone |

The engine is built from source with a cross-compiler, unmodified. The FreeDoom data file is downloaded and checked against a pinned hash. Neither is shipped on the CraftPane image: they go on a test disk as user files.

## What DOOM needed

The first step was to run DOOM and let it fail. CraftPane's program loader lists every function a program imports that CraftPane does not provide. For DOOM that was **25 names**: 12 for windows and messages, 2 for drawing, and the rest small C runtime and string functions.

The C runtime ones were quick. The window ones needed a design, because nothing in the kernel had ever called back into a program:

- **A window procedure.** A Win32 program hands Windows a function, and Windows calls it for every message ("you were created", "a key went down", "please close"). CraftPane now calls that function from the kernel in the program's own unprivileged context, nested correctly: the "you were created" message arrives before `CreateWindowExA` returns, as the documentation says it must.
- **A message queue.** `PeekMessageA` returns posted messages before keyboard input, so a character message arrives before the key-up that follows it. DOOM's menus noticed when that order was wrong.
- **Drawing.** DOOM draws each 640x400 frame into memory and calls `StretchDIBits` once. CraftPane copies that into a window surface that the desktop's compositor draws like any other window.
- **Key presses and releases.** The keyboard driver used to report characters. A game needs to know when a key goes *down* and when it comes back *up*, so the drivers for both PS/2 and USB keyboards now report both.
- **Running beside the desktop.** A Windows GUI program started from the Terminal returns at once, runs as its own task, and gets the desktop's keyboard focus when its window is in front.

The behaviour of every one of those functions came from Microsoft's public documentation only, never from Windows code or binaries. That clean-room rule is written down in the repository, and each new function gets a provenance line naming the page it came from.

## A test program before the real program

Before DOOM ever drew a frame, an agent wrote a tiny Win32 program of our own: one window, a 2x2 picture scaled up to 64x64, every message it receives written to the serial port, quit on Esc.

That program made each piece testable on its own. When it failed, the log said which message was missing or out of order. DOOM, by comparison, just exits early or draws nothing. The test program still runs in every QEMU pass, before DOOM.

**Old** (the shape of most first attempts)

```text
build the real program -> run it -> it exits with no output -> guess which of 25 functions is wrong
```

**New**

```text
survey imports -> implement -> own test program logs every message -> fix order and content
-> only then the real program, which mostly just works
```

## The bugs on the way

| Symptom | Cause | Fix |
|---|---|---|
| The whole machine froze while DOOM loaded | A task was preempted while it held the kernel's heap lock, and another task then waited for that lock forever with interrupts off | The heap lock keeps interrupts off while it is held |
| Loading the 29 MB game file crawled (about 15 reads a second) | Every 2 KiB read opened the file by path and walked the disk's allocation chain to the offset | 256 KiB read-ahead for large read-only files |
| The desktop stopped responding, with no clue why | Nothing said where the CPU was | A "stall watch" that logs where the CPU is when the desktop loop stops coming round |
| Menus skipped or repeated input | Messages came back in the wrong order | Posted messages before keyboard input, as documented |
| **On the laptop only:** holding an arrow key moved one step | See the next section | Read only the bytes the USB keyboard actually sent |

The freeze is the one worth remembering: it only appeared once a program allocated memory heavily while the desktop was busy, which DOOM does at start-up. A lot of earlier tests had passed with the bug in place.

## The bug only real hardware could show

In QEMU, DOOM played. On the laptop, everything looked right until a held key: holding the left arrow should turn the view smoothly, and it barely moved.

{% include slideshow.html slides=page.slideshows.doom label="DOOM on CraftPane, in QEMU and on the laptop, before and after the keyboard fix" %}

The laptop's keyboard during tests is a KVM device, which sends keys as a USB keyboard. After each key report, it sends an empty USB packet. CraftPane's USB driver read the 8-byte buffer anyway, found zeros, and decoded that as "no keys held". Every key press was released about a millisecond later, so DOOM saw a tap, not a hold.

The fix was one line of intent: decode only the bytes the device actually sent. A host test now feeds a key report followed by an empty packet and checks that the key stays down.

QEMU's emulated USB keyboard never sends an empty packet, so no amount of emulator testing would have found this.

## Where it stands

- In QEMU, DOOM ran for three minutes beside the desktop and closed cleanly.
- On the laptop (an older Intel laptop from about 2014, software drawing only), the first frame takes 65 to 73 seconds to appear, and the game then runs at roughly 18 to 26 frames per second. Turning, walking, the menus and quitting all work, and quitting returns exit code 0 with the desktop still running.
- There is no sound yet: CraftPane has no audio driver.

Next on the list: load faster (the program's file requests are answered one per desktop pass, which is most of that minute), add a scripted check that holding Up really walks forward, and then the bigger engine, which needs threads.

## Takeaways

- **Pick a milestone that tests everything at once.** DOOM touched files, memory, timers, input, drawing and scheduling, and it found a heap deadlock that dozens of passing tests had missed.
- **Let the program tell you what it needs.** Listing a program's missing imports turned a vague goal into 25 names, each with a documentation page and a test.
- **Write your own small test program before the real one.** A program that logs every message it gets is far easier to debug than one that silently exits.
- **Emulators are honest, not complete.** QEMU's devices follow the spec closely. Real devices add their own habits, like an empty packet after every key report. Test on the real thing, then turn what you find into a host test.
- **Agents can build an OS if the plan is good.** What made two weeks possible was written plans with pass/fail criteria, clean-room rules agents could follow, and a test harness that said `PASS` or named the failing line.
