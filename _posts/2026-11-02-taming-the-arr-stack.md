---
title: "Taming the *arr Stack: Stuck Imports, Duplicate Grabs, and Delay Profiles"
date: 2026-11-02 10:36:00 -0600
---

**Contents**

1. [Symptoms](#symptoms)
2. [Cause 1: the episode-title rule](#cause-1-the-episode-title-rule)
3. [Cause 2: a zero-minute delay](#cause-2-a-zero-minute-delay)
4. [Cause 3: names the parser cannot match](#cause-3-names-the-parser-cannot-match)
5. [A red herring worth ruling out](#a-red-herring-worth-ruling-out)
6. [Old vs new](#old-vs-new)
7. [What I did not fix](#what-i-did-not-fix)
8. [Takeaways](#takeaways)

---

A self-hosted TV and movie automation stack (Sonarr and Radarr, a Usenet downloader, a transcoder). Seven items sat in the queue in an `importBlocked` state, and every one of those episodes **already had a file**. Meanwhile one movie had been downloaded ten times.

Three separate settings caused it.

## Symptoms

- Seven queue items stuck as `importBlocked`, every episode already present on disk.
- Two reasons given: `Not a Custom Format upgrade` (a better HEVC release had been imported later) and `Found matching series via grab history, but release was matched to series by ID`.
- A single movie grabbed ten times. A TV episode grabbed three times in 2.5 hours at three different qualities.

## Cause 1: the episode-title rule

A setting called *Episode Title Required* was set to `always`. New weekly episodes are usually released before their titles are published, so the title is `TBA` for hours.

What happens:

1. A release is grabbed and downloaded.
2. Import is blocked: *Episode has a TBA title and recently aired*.
3. The app sees no file for the episode, so it keeps searching.
4. It grabs a **second** release.
5. Whichever imports first wins. The other stays stuck forever.

**Fix:** require a title only for bulk season releases, where a missing title would break renaming.

## Cause 2: a zero-minute delay

The delay profile for both apps was 0 minutes. The first release seen is grabbed immediately, and then a better one appears hours later and triggers an upgrade. That is the ten-grab movie and the three-grab episode.

A delay profile exists to let the good release show up. The trick is to avoid waiting when you do not need to.

**Fix:** a 120-minute delay, with two bypasses:

- bypass the delay if the release is already the highest quality in the profile;
- bypass if the release's custom-format score is at or above a threshold that means "this is the release I wanted". I used the score of the preferred HEVC encodes: 150 for TV, 250 for movies.

## Cause 3: names the parser cannot match

Two series never matched:

- A release named `Title.2023.S04...` parsed as a series called "Title" with the year 2023, but the series started in 2000.
- A release named `Show.Name.S02...` did not match the library entry `Show Name (2025)`.

Sonarr has no user-defined aliases, so these cannot be fixed with a setting. They need a manual import when they occur.

## A red herring worth ruling out

The transcoder remuxes `.mp4` files to `.mkv`. That looked suspicious, because the apps logged 255 `episodeFileDeleted / MissingFromDisk` events. I checked: all 255 episodes were re-linked to their new `.mkv` on the same scan. Not a cause.

It does have one side effect worth knowing. A transcoded file gains the HEVC custom formats (+150 in the profile), so any still-queued H.264 grab for that episode becomes "not an upgrade" and gets blocked. That is the first reason in the symptom list.

**Lesson.** When two components touch the same files, prove one is innocent before blaming the other. Counting 255 of 255 beat guessing.

## Old vs new

| Setting | Before | After |
|---|---|---|
| TV: episode title required | `always` | `bulkSeasonReleases` |
| TV: delay profile | usenet 0, torrent 0, bypass if highest quality | 120 min, bypass if highest quality, bypass at custom-format score ≥ 150 |
| Movies: delay profile | usenet 0, torrent 0, bypass if highest quality | 120 min, bypass if highest quality, bypass at custom-format score ≥ 250 |
| TV queue | 7 stuck items | removed; downloads deleted from the downloader; **not blocklisted** |

The queue items were removed without blocklisting, because the releases were fine. The problem was the import state.

The changes were applied through the apps' APIs. Rollback is the "Before" column.

## What I did not fix

- The unparseable releases (cause 3). They still need a manual import.
- Two custom post-processing scripts that fail every run with `xq: command not found`. A missing dependency in the container.
- Movie `downloadFailed` entries. They are incomplete NZBs; automatic re-download handles them.

Writing the "not changed" list in the doc turned out to be useful. It records what is known to be broken so that nobody later assumes the fix covered it.

## Takeaways

- A 0-minute delay profile is a bug magnet. Wait a couple of hours, and bypass the wait when you are already at the target.
- "Title required: always" interacts badly with weekly shows. Limit it to bulk releases.
- Use a score threshold to bypass delays, not only the quality tier.
- Do not blocklist a release just because import is blocked.
- Verify a suspected cause with a count before acting on it.
- End each fix with the list of what you did not fix.
