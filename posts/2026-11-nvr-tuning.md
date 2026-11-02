# NVR Tuning: From a Pegged GPU to a Quiet, Useful Alert Stream

**Contents**

1. [Part 1: why was the GPU busy?](#part-1-why-was-the-gpu-busy)
2. [Part 2: motion tuning, before and after](#part-2-motion-tuning-before-and-after)
3. [Part 3: small animals, and the trap in your own measurements](#part-3-small-animals-and-the-trap-in-your-own-measurements)
4. [Part 4: alerts people want](#part-4-alerts-people-want)
5. [Part 5: seeing license plates](#part-5-seeing-license-plates)
6. [The bill comes due](#the-bill-comes-due)
7. [Takeaways](#takeaways)

---

A six-camera NVR with object detection on an integrated GPU. It worked, but the GPU was busy for no obvious reason, the alerts were mostly noise, and plates were unreadable. This post covers the measured fixes, in the order I did them.

## Part 1: why was the GPU busy?

The integrated GPU idled around 6% and swung between 16% and 75%. The swings were the **detector**, not video decode (decode was 4-6%). GPU load followed *detection rate* exactly, so the real question was: what makes the NVR run so many detections?

Per-camera detection rate over 16 samples, with every camera at 5 fps:

| Camera | Avg detections/s |
|---|---|
| Patio | 12.8 (range 7-22) |
| Doorbell | 5.6 |
| Backyard | 1.9 |
| Driveway | 1.6 |
| Alley | 1.0 |
| Garage | 0 |

Roughly 23 per second in total, about 37% model-busy at 16 ms per inference. **One camera was 56% of the load.** Nothing else in the system explained it, so I looked at the camera views with the debug overlay on (motion boxes, detection regions, zones).

- **Patio:** covered in fallen leaves and dappled sun. Every frame had four to seven small motion boxes scattered across the paving (leaves moving, shadows shifting), turning into two to four detection regions per frame. The existing mask only covered the timestamp.
- **Doorbell:** a large bush filled the left 40% of the frame and swayed. The mask covered only the top half.
- The other cameras had masks that were doing their job.

**Lesson.** Do not tune detection settings blind. Pull the per-camera rate first, then look at the picture for the top one or two. Both causes were visible in a single debug frame.

## Part 2: motion tuning, before and after

**Old**

```yaml
cameras:
  patio:
    motion:
      threshold: 40
      contour_area: 20
  doorbell:
    motion:
      mask: [timestamp_corner, sky_and_background_trees]
```

**New**

```yaml
cameras:
  patio:
    motion:
      threshold: 55        # less sensitive to leaf and shadow pixel changes
      contour_area: 120    # ignore leaf-sized blobs; a person is thousands of px
      improve_contrast: true
  doorbell:
    motion:
      mask:
        left_bush:         # the sway-prone bush; the path is to the right
          coordinates: 0.0,0.30,0.42,0.30,0.42,1.0,0.0,1.0
```

The workflow was: back up the config, validate it with the NVR's own validator, recreate the container, and wait for all six cameras to report their full frame rate (75 seconds).

| | Detections/s | GPU avg |
|---|---|---|
| Before | 22.9 | 29% (16-75%) |
| After | 2.1 | 9% (6-14%) |

## Part 3: small animals, and the trap in your own measurements

The owner wanted small animals detected on the steps, but not leaves everywhere else. Motion settings are per camera, not per region, so a region-only sensitivity was not possible without a mask that would also hide people.

The steps are the closest part of the view, so a cat or squirrel there is large in pixels. Leaves in the upper patio are far smaller. I chose `contour_area: 40`, with the threshold doing most of the filtering.

I then tried values live over MQTT (the settings apply instantly and reset on restart). The results looked great: zero patio detections at several combinations. **But the weather had calmed down.** My baseline of 12.8 per second came from a windy morning; the experiment ran in still air. The numbers were not comparable, and I wrote that down in the notes rather than claiming a win.

**Lesson.** A before/after only means something if the conditions match. Write down the conditions next to the numbers, and say so when they do not.

## Part 4: alerts people want

A review of the last 15 alerts and 15 detections showed:

- 13 of 15 alerts were "a person or car in the public alley". Not useful.
- 7 of 15 detections were speech.
- A face match at 0.92 triggered a "delivery" automation for a trick-or-treater.

Fixes:

```yaml
cameras:
  alley:
    review:
      alerts:
        required_zones: [parking_bay, alley_loiter]   # loiter zone: 20 s dwell
review:
  detections:
    labels: [<tracked objects>, bark, yell, breaking, glass, fire_alarm]  # speech removed
```

- Glass-break and fire-alarm audio are alerts on every camera, at a 0.9 threshold.
- The delivery automation now needs a carrier sub-label, or a known-person match of **0.94 or higher**.
- Car alerts in the parking bay use a separate zone with a 30-second dwell and a minimum size, calibrated from 14 days of real events: parked cars were 79-139k pixels at 0.97 confidence for minutes to hours, while a car merely passing close to the camera clipped the zone for 7-26 seconds. A separate zone keeps person alerts in the same polygon immediate.

**Lesson.** Calibrate thresholds from your own history, not from a guess. Fourteen days of events told me where "parked" ends and "passing" begins.

## Part 5: seeing license plates

Plate recognition needs pixels on the plate. The main stream was a wide 16:9 at high resolution, but the detect stream was squeezed to 704x480. Plates were 272-600 pixels, well below the recognizer's minimum of 1000.

**Old:** detect at 704x480 (squeezed from 16:9).

**New:** detect at 1920x1080. Plates became 1,670-3,680 pixels.

Every pixel-based threshold on that camera had to scale with the new frame: the scale factor was 6.14 (about 2.5x per axis). So the minimum car size went from 3,000 px to 18,400 px, the parking-bay car filter from 40,000 to 245,000, and the face-recognition minimum was set explicitly for that camera. Pixel zones had to be converted to relative coordinates.

After: 5 fps, nothing skipped, CPU about 8%, GPU about 9%, detector about 20 ms (up from 15-17 ms).

## The bill comes due

A larger detect frame is also a larger buffer. A day after this tuning, with that camera's resolution raised on top of semantic search, a big face model and plate recognition, the NVR container hit its memory limit and stalled for about 25 minutes. The memory story is in [the first post](2026-11-old-vs-new-configs.md). The tuning here was correct, but it had a cost that I did not budget for.

## Takeaways

- Measure the rate per camera, then look at the picture of the top offender.
- Back up, validate, recreate, verify frame rates. Make it a playbook.
- Write the conditions next to the numbers.
- Calibrate thresholds from your own event history.
- Scale every pixel-based setting when you change the frame size.
- Any capability you add has a memory cost. Check headroom after each change.
