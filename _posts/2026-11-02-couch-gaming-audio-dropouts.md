---
title: "Couch Gaming on Linux: Chasing Audio Dropouts Through Four Layers"
date: 2026-11-02 23:25:40 -0600
---

**Contents**

1. [The setup](#the-setup)
2. [Symptom: audio hitching](#symptom-audio-hitching)
3. [Layer 1: the GPU's memory clock](#layer-1-the-gpus-memory-clock)
4. [Layer 2: surround sound the TV will not accept](#layer-2-surround-sound-the-tv-will-not-accept)
5. [Layer 3: the encoder underruns](#layer-3-the-encoder-underruns)
6. [Layer 4: the game itself, and a scheduler I had to back out](#layer-4-the-game-itself-and-a-scheduler-i-had-to-back-out)
7. [The review that found free wins](#the-review-that-found-free-wins)
8. [Old vs new, summarized](#old-vs-new-summarized)
9. [Takeaways](#takeaways)

---

## The setup

A living-room gaming PC running an immutable Linux gaming image (Fedora-based, booting straight into a console-style game mode). Ryzen 5 3600X, 16 GiB RAM, an RDNA4 GPU (RX 9060 XT) connected over HDMI to a 4K TV, with a soundbar on the TV's ARC/eARC port. Audio goes out over the GPU's HDMI.

It looked fine on paper. In practice, sound hitched, then surround did not work, then fixing surround caused a new kind of dropout, and finally the whole game stuttered. Each fix revealed the next problem.

## Symptom: audio hitching

PipeWire logged underruns: `[Steam] underrun ... avail:0`. The sound popped and skipped.

### What did not help

I tried the obvious fixes first, and wrote them down because they were wrong:

- **Holding the core clock up.** I set a manual performance level, masked the deep-sleep state and disabled GFXOFF. The core stayed in the 875-1500 MHz range and the audio still hitched.
- **The forum fix.** Advice online says to set a minimum GPU clock of 1000 MHz in the tuning tool. On this GPU generation the option does not exist: the driver only exposes a clock *offset*, and the tool reports no min/max range.

## Layer 1: the GPU's memory clock

The memory clock was idling at 96 MHz. On AMD cards, switching memory-clock steps can glitch both HDMI audio and the display, because the audio shares the GPU's clocking. If the card hops between steps, the audio stream hiccups.

**Old:** driver chooses the memory state dynamically (idle at 96 MHz, boost under load).

**New:** pin the memory clock out of its low states, using the GPU tuning daemon (LACT) with the overdrive feature mask enabled on the kernel command line:

```bash
rpm-ostree kargs --append-if-missing=amdgpu.ppfeaturemask=0xffffffff
systemctl enable --now lactd
```

```yaml
# /etc/lact/config.yaml
gpus:
  <gpu-id>:
    fan_control_enabled: false
    performance_level: manual
    power_states:
      memory_clock:
      - 5      # pinned at 1258 MHz
```

The memory steps are 0=96, 1=456, 2=772, 3=875, 4=1124, 5=1258 MHz.

### The threshold test

To find the smallest safe setting, I held each step alone for three minutes while running a demanding game:

| Memory clock fixed at | Audio |
|---|---|
| 875 MHz (step 3) | clean |
| 772 MHz (step 2) | clean |
| 456 MHz (step 1) | hitch at about 45 seconds |

So 772 MHz is the lowest *fixed* step that is clean. I first applied a floor, allowing steps 3, 4 and 5, since every step down to 772 had tested clean alone. It **switched steps under game load**, and switching is what causes the hitch. A floor still lets the card change steps. A pin does not. I went back to a single step, 5.

Two lessons hid in this:

- **The log was not a reliable signal.** The 456 MHz hitch produced no PipeWire underrun at all. If I had only watched the journal, I would have called that step clean.
- **"Stable at idle" is not "stable under load".** The floor passed a test and failed in play.

## Layer 2: surround sound the TV will not accept

With the hitching gone, I wanted 5.1 surround from games. It did not work, and the reason was in the TV's capabilities (its EDID, the display's self-description):

- The TV advertises **2-channel LPCM only**.
- Multichannel audio is accepted **only as a bitstream**: Dolby Digital 5.1, E-AC-3, DTS-HD, TrueHD.
- Games output PCM.

So through this TV, every game was stereo, whatever the in-game menu said. The 5.1 and 7.1 PCM profiles in the audio server could never reach the soundbar.

**Old:** games output PCM; the TV flattens it to stereo.

**New:** encode the games' 5.1 PCM to Dolby Digital in real time (640 kbps) and send that to the TV as a bitstream, which it passes through to the soundbar.

The pieces:

1. Install the ALSA a52 encoder plugin (applied live, no reboot).
2. An ALSA PCM that chains `plug` → `a52` (48 kHz, 640 kbps, 6 channels) → the HDMI device, with the AES bits set to mark it as non-audio data.
3. A PipeWire config that exposes it as a 6-channel sink in ALSA's 5.1 channel order, with a high priority so it becomes the default.
4. A WirePlumber rule that disables the GPU's own HDMI audio device, so the session manager does not also open it.

```text
# ~/.config/pipewire/pipewire.conf.d/50-ac3-tv.conf  (shape)
sink "ac3_tv" -> alsa pcm "ac3tv", 6ch [ FL FR RL RR FC LFE ], priority 2000
```

It worked. A channel test sent the right sound to each speaker, and the soundbar's display showed Dolby Digital.

Costs to know about: about 30-50 ms added latency (use the soundbar's AV-sync setting), the TV must be set to bitstream/auto output, and games choose their channel count at launch, so restart the game after changing audio.

## Layer 3: the encoder underruns

**First failure: silence after reboot.** The surround sink worked in testing, but after a reboot games had no sound except for snippets. The log looped on `snd_pcm_start: Broken pipe`.

The cause: the a52 plugin is an I/O plugin that encodes in **1536-sample AC-3 frames**. PipeWire was using memory-mapped access and writing 1024 samples at a time, which the plugin could not keep up with. The fix was to make PipeWire match the codec's frame size:

```text
api.alsa.disable-mmap = true
api.alsa.period-size  = 1536
api.alsa.period-num   = 4
api.alsa.headroom     = 1536
```

Reboot-tested.

**Second failure: dips under heavy load.** Under a demanding game, `pw-top` showed the error counter for the new sink climbing. There were two causes:

1. **Realtime priority was being taken away.** The system's realtime-kit watchdog tripped under load ("Recovering from system lockup, not allowing further RT threads") and demoted PipeWire's threads to normal scheduling. The user was not in the `pipewire` group, so PipeWire depended on the realtime kit for its realtime priority rather than having its own.
2. **The game asked for a very small buffer.** It requested a 256-sample quantum (5.3 ms), which is too tight for an encoder that works in 1536-sample frames.

**Old:** realtime on loan from the realtime kit, which could revoke it. Quantum chosen by the game.

**New:**

- Put the user in the `pipewire` group. On this immutable OS the group is defined in `/usr/lib/group`, so its line was copied into `/etc/group` first. A limits file then grants realtime priority 70 to the group, so PipeWire sets realtime itself and nothing can demote it. (Applies from the next login.)
- Set a floor for the buffer: `default.clock.min-quantum = 1024` (about 21 ms).
- Applied live, without restarting audio:

```bash
sudo chrt -f -p 88 <data-loop thread id>          # for pipewire and pipewire-pulse
pw-metadata -n settings 0 clock.min-quantum 1024
```

Result: zero new underruns in 60 seconds in the middle of a game.

Checks worth keeping:

```bash
timeout 3 pw-top -b -n 2 | grep ac3_tv                      # error column should stay flat
ps -L -o tid,cls,rtprio,comm -p $(pgrep -x pipewire)        # data-loop should be class FF (realtime FIFO)
```

## Layer 4: the game itself, and a scheduler I had to back out

Some dips remained, and these were different: **picture and sound stalled together**. That pointed away from the audio path. A 15-minute log at one-second resolution showed the memory clock pinned at step 5 and no PipeWire underruns at a reported dip.

The game (a modern engine running under a compatibility layer) was CPU-bound on this processor: about 6.6 of 12 threads busy, CPU pressure ("some") at 20-30%, no I/O or memory pressure, no shader compilation. Capped at 60 fps with variable refresh off.

### The experiment

The image ships a sched_ext scheduler (`scx_lavd`, a latency-aware scheduler) that is enabled by one service. I turned it on. At first it reduced the short hitches.

### Why I reverted it

Within minutes the game froze intermittently. The kernel log said:

```text
sched_ext: lavd_1.1.3: Background Work[...] failed to run for 38.167s
sched_ext: disabled (runnable task stall)
```

The scheduler had starved a game thread for 38 seconds, the kernel's watchdog ejected it, and the loader service **restarted it**, so the freezes repeated on a loop. I disabled the loader service and went back to the default kernel scheduler (EEVDF). A one-line check confirms it:

```bash
cat /sys/kernel/sched_ext/state      # disabled
```

The first commit message said it "reduced hitches". The second said "do not use here". Both are in the history, on purpose: the reverted experiment is the useful part.

### What is left

A launch option to try (`PROTON_USE_XALIA=0`, because a helper process used about 5% CPU), lower CPU-heavy in-game settings, and keeping the 60 fps cap for headroom. The real fix is hardware: a faster-cache processor on the same board.

## The review that found free wins

Midway through, I did a read-only "couch gaming review" of the whole setup, which turned up cheap fixes unrelated to audio:

| Area | State | Action |
|---|---|---|
| Output mode | 1440p at 120 Hz, HDR on | none; the game mode had already set it |
| Variable refresh | capable but **off** | turn it on in the performance panel and the TV's game mode |
| Frame limit | **60 on a 120 Hz display** | turn off or set 120 per game |
| CPU profile | `balanced` | switch to the `throughput-performance` tuned profile (persists) |
| Games drive | auto-mounted | fine; Steam lists two stale paths for the same disk |
| Health | no failed units, SMART OK, GPU 82 °C junction at 117 W | none |

A frame limit of 60 on a 120 Hz screen and VRR left off were the cheapest findings in the whole exercise.

## Old vs new, summarized

| Problem | Old | New |
|---|---|---|
| Audio hitch | dynamic memory clock, 96 MHz idle | memory clock pinned to the top step |
| Games in stereo | PCM to a TV that takes 2-channel PCM | real-time Dolby Digital encode, bitstream to the soundbar |
| Silence after reboot | mmap, 1024-sample writes | no mmap, 1536-sample periods |
| Dips under load | realtime on loan; game-chosen 256-sample buffer | PipeWire has its own realtime; 1024-sample floor |
| Whole-game stalls | default scheduler | default scheduler (a custom one was tried and reverted) |

## Takeaways

- Write down what did not help. Three fixes from the internet failed before the real one worked.
- Test the *smallest* safe setting, and test it under load. A floor that passes at idle can fail in play.
- A clean log is not a clean result. The failing setting produced no log line.
- Read the display's EDID before debugging "my surround is broken". The answer may be that the TV cannot accept what you send.
- Codec frame size sets your buffer size. Match the period to the frame.
- Realtime priority you borrow can be taken back. Give the audio server its own.
- When the picture and sound stall together, stop looking at audio.
- An experiment that makes things worse belongs in the notes, with the evidence that sent you back.
