# Blog style guide: the post corgi

Every post on this blog gets a pixel corgi whose expression fits what the post is about. The corgi is the rotanigroc
character from the asset style guide (`rotanigroc_asset_style_guide.md`, kept outside this repo): a Pembroke Welsh corgi
in chunky rainbow-frame glasses and matte black over-ear headphones, drawn as 16-bit pixel art. This guide covers how the
blog uses that character. The asset guide stays the source of truth for the character itself.

## 1. What the corgi is for

The corgi tells a reader the mood of a post before they read a word: a fire, a puzzle, a lock, a nap. It is decoration,
not content. A post must make sense with the image missing, and the corgi never carries a fact the text does not.

- One corgi per post, no more.
- Match the **outcome or the trouble** the post is about, not its technology. A post about a GPU that was pegged gets the
  corgi next to a smoking PC, whatever the GPU was doing.
- Keep the tone of the character: calm and capable, even when things are on fire. No gore, no anger, no mocking of
  people or vendors.

## 2. Where it goes

The corgi sits at the right end of the post header, **perched on the rule under the title**, the way the error-page
corgis sit on top of their status digits. `_layouts/post.html` places it, and `assets/main.scss` (`.has-corgi`) draws
the rule and sizes it:

| Screen | Corgi height | Placement |
|---|---|---|
| Wider than 600 px | 120 px | Right of the title and date, bottom edge on the rule |
| 600 px or narrower | 88 px | Below the title and date, right-aligned on the rule |

The post list on the home page stays plain text.

## 3. Picking a pose

These are the poses that exist today. Pick the one whose situation matches the post, and reuse poses freely: a reader
sees one post at a time.

| Key | Pose | Use it for | Posts using it |
|---|---|---|---|
| `at-the-laptop` | Typing on a laptop at the night-time desk (the avatar) | Calm, general build-outs and roundups; anything on a laptop | Old vs New; Local AI on an M1 laptop |
| `puzzled` | Scratching its head under a question mark | Mystery bugs, symptoms with no obvious cause, "why is this happening" | Taming the *arr stack; Couch gaming audio dropouts |
| `keycard` | Holding up a key card beside a rejected badge | Sign-in, identity, scoped credentials, who is allowed in | One sign-in for admin pages; Secrets for agents |
| `guard` | Security cap, padlock shield | Locking things down: firewalls, isolation, guardrails, secrets at rest | Staging a firewall zone; Guardrails for AI agents; Self-hosted secrets server |
| `magnifier` | Peering through a magnifying glass | Investigation, triage, separating signal from noise | CVE alerts that mean something |
| `on-fire` | Alarmed beside a smoking PC tower | Outages, disasters, overloaded hardware, recovery | NVR tuning; Disaster-recovery drill |
| `blueprint` | Studying a blueprint by a construction barrier | Building or rebuilding something from a plan, test rigs | Rebuild test; Testing a hobby OS without a KVM |
| `patch-cables` | Two unplugged cables with a spark between them | Broken links: network paths, mounts, gateways, integrations | Tiered video storage |
| `asleep` | Asleep beside an hourglass | Things that should happen while nobody watches: scheduled jobs, timeouts, quiet nights | Auto-patching a cluster |

When two poses fit, choose the one that matches the post's title. When none fits well, use `at-the-laptop` and add a
new pose later (section 6).

## 4. Adding a corgi to a post

Add one line to the post's front matter, using a key from the table above:

```yaml
---
title: "Your Title"
date: 2026-11-05 14:30:00 -0600
corgi: magnifier
---
```

The key must exist in `_data/corgis.yml`; an unknown key shows no corgi rather than a broken image. Leaving `corgi` out
is allowed, but every published post should have one.

## 5. Image rules

These follow the asset guide's colours and outline rules, adapted to a blog header.

- **Format:** PNG with a transparent background. No baked-in background colour, so one file works in light and dark mode.
- **Outline:** the 2 px (at render size) solid white outline from the asset guide around the whole figure and its props.
  It is what keeps the black headphones visible on the dark theme.
- **Flat bottom edge:** the image is cut straight across at the bottom, so the corgi sits on the header rule. Keep props
  that stand on the ground (a PC tower, an hourglass) resting on that edge.
- **No text in the image.** No status codes, no captions, no `rotanigroc` lettering: the post title is the text.
- **Size:** exactly 240 px tall (shown at 120 px, so it stays sharp on 2x screens), width as the pose needs. Keep the
  file under 150 KB.
- **Name:** `assets/corgis/<key>.png`, where the key is a short lowercase name for the pose, not for a post.
- **Alt text:** describe the pose in one line in `_data/corgis.yml`, starting with "Pixel-art corgi in rainbow glasses
  and headphones". Do not repeat the post title.
- **Palette:** the asset guide's tokens only (fur `#EB8D3D` / `#C4641B` / `#FDF3E7`, headphones `#1E1F24` / `#3A3D47`,
  rainbow frames `#FF4365` to `#00C2FF`). The blog's own colours stay in `assets/main.scss` and are never baked into a corgi.

## 6. Making a new pose

1. Render it with the asset guide's base prompt (section 6), on `#00FF00` chroma green, with the white outline. Leave
   out the status digits and text, and describe the corgi "sitting on a flat ledge along the bottom edge" so the base is
   level. For example: *The corgi is holding a stopwatch and looking pleased.*
2. Key out the green with `key-chroma.py` (homelab-redux, `swag-lan/error-pages-src/`). Add `--stroke 7` if the render
   came out without a white outline.
3. If the render has anything under the corgi (digits, a ledge), crop it off just above, so the bottom is flat.
4. Scale it to 240 px tall, check it on black and on white (no green fringe, outline intact), and save it as
   `assets/corgis/<key>.png`.
5. Add the key, its width and its alt text to `_data/corgis.yml`, and a row to the table in section 3.

The poses in this repo were cut from the error-page badges in the same way: the corgi kept, the status digits and
caption cropped off.
