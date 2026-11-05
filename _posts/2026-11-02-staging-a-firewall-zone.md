---
title: "A New Firewall Zone Blocked Everything: Staging Network Segmentation Safely"
date: 2026-11-02 10:30:00 -0600
---

**Contents**

1. [The goal](#the-goal)
2. [Step 0: audit before you touch anything](#step-0-audit-before-you-touch-anything)
3. [Step 1: remove what is provably dead, reversibly](#step-1-remove-what-is-provably-dead-reversibly)
4. [Step 2: create the zone (and the 90-second outage)](#step-2-create-the-zone-and-the-90-second-outage)
5. [Step 3: build exceptions from evidence](#step-3-build-exceptions-from-evidence)
6. [Step 4: enforce, with a one-command way back](#step-4-enforce-with-a-one-command-way-back)
7. [API gotchas worth knowing](#api-gotchas-worth-knowing)
8. [Takeaways](#takeaways)

---

## The goal

Put every smart-home and camera device in its own network zone, and stop that zone from initiating connections to the main network, except for the handful of things it genuinely needs. This is the standard "IoT VLAN" idea, done on a gateway with a zone-based firewall.

It sounds like one setting. It is really four steps, and the order matters. I got one of them wrong and caused a short outage, which is the reason for this post.

## Step 0: audit before you touch anything

A read-only pass over the gateway produced a picture that did not match what I thought I had:

| Class | Count | What it meant |
|---|---|---|
| System/derived policies | 97 | Built-in allow/return/invalid-traffic rules. Leave alone. |
| Auto-generated threat-management blocks | 88 | Recreated by the system over time. |
| Threat-management blocks for hosts that look gone | 24 | Needs verifying (see below). |
| Duplicates | 55 | The same hand-made rule copied into every zone pair. |
| Hand-written policies | 2 | One was disabled and written backwards. |

The real rule set was about ten distinct rules, copied into every zone pair. The other 250-odd entries were clutter.

Other findings from the same pass:

- Port labels on the switches were default names almost everywhere, and several "multi-device" ports were hypervisors carrying many guests.
- Some client names in the controller were wrong (a hypervisor named after a person's old PC, an NVR named after a laptop).
- No policy had logging on.

**Lesson.** The audit's output is the checklist for everything after it. Save it as files (`ports.tsv`, `policies.tsv`), not as a mental picture.

## Step 1: remove what is provably dead, reversibly

Two cleanups, both done by disabling first and deleting later:

1. **Stale threat blocks.** My test for "stale" was "the LAN address is not in the controller's current client list". That test flagged one address that turned out to be a live media server with an open port. A client list tells you what has talked recently, not what exists. I disabled only the entries whose hosts did not answer a ping, left the rest, and saved the JSON of each policy first.
2. **A WAN port forward.** The public sites were already served through a tunnel, and DNS records pointed at the tunnel, not at the home IP. I confirmed that with the DNS provider, disabled the 443 forward, and re-checked every public hostname. It had been dead weight with a real attack surface.

Rollback for both is the same: `PUT` the saved object back with `enabled: true`.

## Step 2: create the zone (and the 90-second outage)

I created a new zone and moved the smart-home network into it, intending "no behaviour change, just add logging".

**What happened.** A new zone is born with default system policies of *Block All Traffic* in both directions to every other zone, **and to itself**. The moment the network moved, pings from the main network to smart-home devices failed, including the home-automation hub. Cameras stopped being reachable by the NVR.

**Old order (what I did)**

```text
1. create zone, move network into it
2. (outage)
3. add three allow policies with logging:
     Internal -> IoT, IoT -> Internal, IoT -> IoT
```

**New order (what to do)**

```text
1. create the zone EMPTY
2. add the three allow-all policies with logging
3. move the network into the zone
```

The policies can only reference a zone after it exists, which is why the zone comes first, but it must be empty until the allow rules are in place. The outage lasted 1-2 minutes. I had a before-state export, a probe list of known-good devices, and the NVR's per-camera frame rate as a health check, so I knew within a minute that it was fixed and that nothing else had changed.

**Lesson.** When a platform creates implicit deny rules for new objects, stage the allow rules before the object receives traffic.

## Step 3: build exceptions from evidence

With allow-all plus logging in place, behaviour was the same as before, but now observable. I waited 48 hours and read the firewall logs in the controller UI. (The API cannot read them.)

Before looking at logs, the client inventory already predicted the needed exceptions:

| Exception | Why |
|---|---|
| IoT to DNS servers, port 53 | Everything resolves names. |
| IoT to the media server, port 32400 | One TV box lives on the IoT network and streams from it. |
| IoT to the automation hub, MQTT and web ports | Devices report state and call back to the hub. |
| mDNS (UDP 5353) between zones | Casting and discovery stop working without it. |
| Main to IoT, allowed | The NVR pulls camera streams; people control the devices. |
| IoT to Main, **blocked by default** | Cameras must not initiate connections inward. |

I created these as logged ALLOW policies *above* the future block, where they are harmless while allow-all is still on.

## Step 4: enforce, with a one-command way back

Enforcement is a script with four verbs:

```text
unifi-iot-enforce status | exceptions | enforce | rollback
```

- `exceptions` creates the exception policies (done).
- `enforce` disables the single "IoT-migration IoT to Internal allow" policy, so the system block applies underneath the exceptions.
- `rollback` re-enables it, in seconds.

At the time of writing, enforcement was staged but not yet applied, pending the 48-hour log review. The point of the script is that the decision is one verb, not a re-derivation of what to click.

## API gotchas worth knowing

- Moving a network into a new zone is a `POST` to the zones endpoint with the network IDs. That also removes it from its old zone.
- The policy API's protocol preset is TCP+UDP only. Each "port 53" exception therefore also allows the other protocol on that port. Note it, and accept it.
- A `PATCH` on a policy rejected `enabled`. A full `PUT` of the exported object, minus the `id`, metadata and index fields, worked.
- Firewall logs are UI-only. Plan a human step for the log review.

## Takeaways

- Audit read-only first, and keep the output as files.
- "Looks stale" is not "is dead". Verify each item by another route, then disable before deleting.
- Create allow policies before the zone receives a network.
- Spend 48 hours in allow-all-with-logging before enforcing.
- Make enforcement and rollback one verb each.
