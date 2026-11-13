---
title: "The Same Corgi Every Time: A Style Guide That Makes Nano Banana Repeatable"
date: 2026-11-13 11:00:00 -0600
tags: [ai, image-generation, gemini, style-guide, pixel-art, design]
corgi: idea
---

**Contents**

1. [Where it started](#where-it-started)
2. [Explore wide, then lock one look](#explore-wide-then-lock-one-look)
3. [Change one thing per prompt, and name it](#change-one-thing-per-prompt-and-name-it)
4. ["Transparent background" is a picture of a checkerboard](#transparent-background-is-a-picture-of-a-checkerboard)
5. [Write the style guide after the look is locked](#write-the-style-guide-after-the-look-is-locked)
6. [The second draft is the one to keep](#the-second-draft-is-the-one-to-keep)
7. [Running the guide: check every image against it](#running-the-guide-check-every-image-against-it)
8. [Sticker sheets and keying out the green](#sticker-sheets-and-keying-out-the-green)
9. [Two guides, not one](#two-guides-not-one)
10. [Takeaways](#takeaways)

---

The corgi at the top of every post on this blog is a single character. It is a Pembroke Welsh corgi in rainbow-frame glasses and black over-ear headphones, drawn as 16-bit pixel art. It started as a profile avatar. Since then it has also become a desktop banner, the error pages in front of the home lab (400 through 504), and twelve reaction stickers. All of it came out of one Gemini conversation using its image model, Nano Banana. Most of the images look like the same dog.

That "same dog" part was not luck, and it did not happen on the first try. This post covers what made it repeatable: a written style guide with fixed colour tokens and a fill-in-the-blanks prompt, a keying background in place of "transparent", and a check of every result against the guide. It also covers the places where the model still drifted.

## Where it started

The first prompt was open on purpose:

```text
My coding handle is "corginator" in reverse. Give me some design options for an avatar with a coding corgi
```

It came back as one sheet with four concepts: a cyberpunk developer, a retro vaporwave pixel corgi, a flat vector corgi, and a hooded CLI hacker. Each had a different palette, medium and font. That is the right first step, but none of these is a character yet. They are four different dogs.

## Explore wide, then lock one look

The next two prompts narrowed it down:

1. "Give me some variants on option 2", which gave four pixel-art directions: cyberpunk palette, **chill lo-fi**, matrix glitch and outrun arcade.
2. "Use 2B as the main vibe", which picked the chill lo-fi one: a night-time bedroom, a lava lamp, plants, a starry window, and a relaxed corgi at a laptop.

From there, each prompt narrowed it further. The useful habit was to **pick a winner by its label** ("2B") instead of describing it again. The label points at one image, while a description can match several.

## Change one thing per prompt, and name it

Locking the look took a chain of small edits, each building on the last image:

| Prompt | Change |
|---|---|
| "2B vibe but with rainbow framed glasses and black headphones" | The two props that make the character |
| "2 circle variants, one with the name in vaporwave purple font and the other with no name" | The avatar in its two forms |
| "the full 2B image ... and just 1 corgi at the table" | The wide scene, with the extra corgi from the variant sheet removed |
| "Replace the monitor with a taken apart PC tower" | The prop that later shows up in half the error pages |
| "the same image without the name on the bottom" | A clean banner |

Each prompt changed one thing and kept the rest, so when something came back wrong, it was clear which change caused it.

The one miss in this stretch came from **pointing at an image by its position**. "Take the 2nd image (black headphones) but use the pink font from the first image" was sent, then sent again reworded, and then dropped for a prompt that said what was wanted ("rainbow framed glasses and black headphones ... name in vaporwave purple font"). Once there are a dozen images in the thread, "the 2nd image" is not a clear reference for you or for the model.

**Old**

```text
Take image 2 (black headphones) but use the pink font from the first image.
```

**New**

```text
The 2B corgi with black over-ear headphones and rainbow-frame glasses, in a circle badge.
Version 1: "rotanigroc" along the bottom in the vaporwave purple pixel font. Version 2: no name.
```

## "Transparent background" is a picture of a checkerboard

The first error-page icons (404, 403, 502, 504) came as busy scenes, so the next prompt was "just the error code and the corgi sitting on top of the text - transparent background".

The result had a grey-and-white checkerboard drawn into the pixels. Image models output flat RGB images. When you ask for transparency, you get a picture of the checkerboard that editors use to show transparency.

The fix was to stop asking for transparency and ask for something easy to remove:

**Old**

```text
... transparent background
```

**New**

```text
... on a solid pure flat chroma green #00FF00 background ... no shadows cast onto the green background.
```

A green screen with no shadows on it can be keyed out in one click in macOS Preview (Instant Alpha) or with a short script. Then the keyed image needs an outline, which went into the guide as a hard rule: a **2 px solid white border around all lettering and props**. Without it, black headphones and dark outlines vanish on a dark page once the green is gone.

## Write the style guide after the look is locked

Once the avatar, banner and first error icons looked right, the prompt was:

```text
Write up a style guide for future avatar/imagery using the same pixel art and corgi
```

Timing matters here. Written earlier, the guide would have described a character that did not exist yet. Written after a dozen images, it describes the dog on screen, and the model can pull the details from its own recent output: fur colours, frame shape, where the headphones sit, which props belong in the room.

The draft covered what you would expect: character, environment, a palette table, asset types (avatar, banner, error badge), and a "master prompt" template.

## The second draft is the one to keep

The first draft was good enough to read and too loose to generate from. Asking for it again as a single Markdown file, together with the full error-code set and the white-border rule, gave a much tighter version. It is saved next to the art as `rotanigroc_asset_style_guide.md`. Here is what changed between the two:

| | First draft | Saved guide |
|---|---|---|
| Fur colour | A range, `#D9732B` to `#EB8D3D` | Three tokens: primary `#EB8D3D`, shade `#C4641B`, cream `#FDF3E7` |
| Headphones | `#1E1F24` to `#353740` | Matte black `#1E1F24` plus accent grey `#3A3D47` for rims and joints |
| Outline | Not mentioned | Its own token: `#FFFFFF`, 2 px, mandatory on lettering and props |
| Keying colour | "Chroma green" | `#00FF00` as a named token, with "no drop shadow into the green plane" |
| Error scenarios | 4 codes, loose ("holding a magnifying glass or peering over the numbers") | 9 codes, one prop and one expression each |
| Post-processing | None | Step-by-step key-out in macOS Preview, export as PNG with alpha |
| Prompt template | One template mixing scene and icon, with two `[INSERT ...]` slots | An icon-only template with `[HTTP_CODE]`, `[STATUS_NAME]` and `[SPECIFIC ACTION / PROP]` |

Each change takes a decision away from the model. A range of hex values lets it pick a new orange every time. Three tokens do not. A scenario that says "magnifying glass **or** peering over" will be drawn either way, while "holding a magnifying glass peering over the edge into empty space" gets one pose.

The template is where the guide pays off. Every new icon is the same sentence with three blanks filled in:

```text
16-bit retro pixel art icon on a solid pure flat chroma green #00FF00 background.
A Pembroke Welsh corgi with thick square rainbow-frame glasses and black over-ear headphones
sitting on top of large pixel-art numbers "[HTTP_CODE]". Below the numbers, pixelated text reads
"[STATUS_NAME]". All text has a crisp 2px solid white outline. The corgi is [SPECIFIC ACTION / PROP].
Clean pixel clusters, sharp edges, no anti-aliasing, no shadows cast onto the green background.
```

The character description, medium, background and outline are fixed text. Only the scene changes. With more of the prompt held constant, there is less room for the character to drift between images.

## Running the guide: check every image against it

With the guide in place, one prompt asked for "all standard error codes (each one its own image)". Eight came back: 400, 401, 403, 404, 500, 501, 502 and 504, each with its own caption and on green.

Two things in that batch only showed up on a check against the guide:

- **A code went missing.** The guide's scenario matrix lists 503 ("Be Right Back" sign on the laptop, corgi napping). The batch has no 503, and nothing in the reply says so. A batch request is not a contract, so count what came back against the list you asked for.
- **A rule was skipped.** The guide says the white outline is mandatory, but the 502 render came out without one. The keying script for the error pages has a `--stroke` option for exactly this case: it draws a solid white outline around the keyed art. The 502 badge was keyed with `--stroke 7`.

Even with a tight guide, the model follows most of it most of the time. The guide does its job by giving you a list to check each image against: the codes asked for, the outline, a flat green background, the glasses, the headphones.

There was also a smaller lesson on the web side. The first error pages added a white outline in CSS to make up for renders without one. Once the PNGs carried their own stroke, the CSS outline came out again. Fix the asset, not the page.

## Sticker sheets and keying out the green

The blog needed something different from error badges: small reaction poses with no text, one per post mood. Two prompts produced two sheets of six:

```text
I'm writing blog posts about various tech projects. Give me some accent art using the corgi
that would be useful for various expressions
```

```text
Those are great, give me another 6 different expressions
```

The model's own image prompt for these, which the conversation shows with each image, carried the guide's rules over without being asked: "2x3 grid", "flat, solid chroma green background (#00FF00)", "a crisp, prominent 2-pixel white outline surrounding its entire shape", "No text is rendered anywhere in the image", "arranged neatly with generous spacing ... ensuring no overlapping". The guide was in the conversation, and it showed up in the prompt.

The same prompt starts with "maintaining the exact same character appearance, color palette, and 16-bit retro pixel art style as `<IMAGE_0>` and `<IMAGE_1>`". So the model was holding the character steady by referring to images already in the thread, not only to the written guide. In a new conversation that context is gone. The safe move is to attach a locked reference image (the plain banner or avatar) **and** paste the guide.

Turning two sheets into twelve stickers took two small scripts:

- `split.py` crops each sheet into a 3-by-2 grid of cells and names each cell after its pose (`cheering`, `typing`, `investigating`, and so on). "Generous spacing, no overlapping" in the prompt is what makes a plain grid cut work.
- `key-sticker.py` removes the green. The naive approach, deleting every green pixel, eats the art: the green v2.0 arrow in the `upgrade` pose, the checkmark flag in `success`, the green band in the rainbow frames (`#00D27F` is right in the palette). So the script only treats green as background when it is **connected to the image border**, or when it is a small gap that is plain chroma colour. Green enclosed by the white outline is art and stays.

Preview's Instant Alpha, as the guide suggests, is fine for one image. For twelve stickers plus nine badges, use a script, and check each result on black and on white for green fringe and gaps in the outline.

## Two guides, not one

The asset guide describes the character: anatomy, palette, medium, scenarios, prompt. It says nothing about blog headers, and it should not. A second guide in this repo (`STYLE_GUIDE.md`) covers how the blog *uses* the character. It sets one corgi per post, where it sits, 240 px tall, no text in the image, alt text in a data file, and a table of which pose fits which kind of post. It points at the asset guide as the source of truth and never repeats the character spec.

That split keeps each guide short and stops them drifting apart. A palette change happens in one file. A new site layout does not touch the prompt.

## Takeaways

- **Explore wide, then pick by label.** Four options, then four variants, then "use 2B". A label points at one image, and a description can match several.
- **One change per prompt.** Glasses and headphones, then one corgi, then the PC tower, then no name. Each step builds on the last image.
- **Refer to images by what is in them, not by their position.** "The 2nd image" stops meaning anything a dozen images in.
- **Never ask for a transparent background.** Ask for flat `#00FF00` with no shadows on it, and a 2 px white outline so dark edges survive keying.
- **Write the guide after the look is locked**, and let the model write it from its own output.
- **Turn ranges into tokens and "or" into one choice.** Every loose phrase in a guide is a decision the model makes again, differently, each time.
- **Make the prompt a template with blanks.** The character text never changes. Only the scene does.
- **Check every batch against the guide.** Here, one code went missing and one image had no outline.
- **Attach a reference image as well as the guide.** In the conversation, the model held the character steady by pointing at earlier images. A new chat has no earlier images.
- **Key out the green with code, not by colour alone.** Green that touches the border is background. Green inside the outline is the art.
- **Keep the character guide and the usage guide separate.** One describes the dog, the other says where it goes.
