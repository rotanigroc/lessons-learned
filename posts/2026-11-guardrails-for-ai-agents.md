# Letting an AI Agent Operate Your Lab: The Guardrails That Kept It Safe

**Contents**

1. [The situation](#the-situation)
2. [Rule 1: read-only by default](#rule-1-read-only-by-default)
3. [Rule 2: a dry run, shown, before every write](#rule-2-a-dry-run-shown-before-every-write)
4. [Rule 3: all remote changes go through one runner](#rule-3-all-remote-changes-go-through-one-runner)
5. [Rule 4: every playbook can undo itself](#rule-4-every-playbook-can-undo-itself)
6. [Rule 5: never print secrets, and never kill by name](#rule-5-never-print-secrets-and-never-kill-by-name)
7. [Rule 6: keep output out of the repo](#rule-6-keep-output-out-of-the-repo)
8. [Rule 7: when the sandbox says no, ask a human](#rule-7-when-the-sandbox-says-no-ask-a-human)
9. [Making the rules load themselves](#making-the-rules-load-themselves)
10. [Checks that run without being asked](#checks-that-run-without-being-asked)
11. [Takeaways](#takeaways)

---

## The situation

Over about three weeks, an AI coding agent did most of the hands-on work on a home lab: a three-node virtualization cluster, a NAS, a smart-home hub, network gear, an NVR, a workflow engine, and a handful of Mac and Linux machines. It read configs, wrote playbooks, tuned settings and ran maintenance.

That is a lot of trust. These are the rules that made it safe enough to keep doing, written as old (what I would have done) versus new (what the rules enforce).

## Rule 1: read-only by default

**Old:** the agent logs in, looks around, and fixes what it finds.

**New:** the first pass over any system is read-only and produces a findings file. A change is a separate step with a separate yes. The network audit, the home-automation lights audit and the camera GPU study were all read-only passes that wrote down what they saw before anything was touched.

## Rule 2: a dry run, shown, before every write

Every script that writes has a dry-run default, and the agent must show the dry run before it applies. The word `--apply` is a deliberate act:

```text
tool add-device --name X                 # dry run, masked values
tool add-device --name X --apply         # only after the user said yes
```

Playbooks pair a `check` template with an `apply` template. The agent runs the check first.

## Rule 3: all remote changes go through one runner

**Old**

```text
ssh node1 'systemctl restart something'      # no record, wrong user, no keys managed
ansible -m shell ... (from the laptop)
```

**New**

Anything that runs on a host (patching, wake, suspend, reboot, service changes, even read-only checks when a template exists) is a playbook run as a template in the automation server. It has the right keys, an audit trail and full output.

Why this is worth the friction:

- There is a record of every action.
- Credentials for the hosts live in the runner, not on the agent's machine.
- A playbook that works once works again.
- It makes "what changed last Tuesday" a question with an answer.

If a playbook does not exist, the agent writes it and asks for the template. Direct access is a fallback the user must grant explicitly.

## Rule 4: every playbook can undo itself

The pattern, from the first post, applies to everything the agent writes:

1. Read-only facts first.
2. A `--check` mode that prints what would change.
3. A backup before the change, in a named folder.
4. The change.
5. A verification (health, frame rate, HTTP 200).
6. An automatic restore of the backup if verification fails.
7. The rollback written in the header of the file, including the by-hand version.

Example: updating the NVR software backs up the compose file, config and a consistent database copy, tags the old image as `rollback`, pins the new image tag (it used to float on `:stable`), restarts, checks the version and camera frame rates, and restores by itself on failure. It never prunes the old image, because that image is the rollback. It refuses to start if the container's disk has under 2 GiB free.

## Rule 5: never print secrets, and never kill by name

- No `bash -x` on scripts that read secrets.
- Compare secrets by length or short hash.
- Wrappers redact by default (see [the secrets post](2026-11-secrets-for-agents.md)).
- **Never kill a process by name.** A live service the user depends on may own a port. The agent tests on another port and kills only its own PID.
## Rule 6: keep output out of the repo

The repo holds identifiers: addresses, MACs, hostnames. Command output, exports and screenshots go in a scratch directory. A secret scan is part of the change test, so a stray token fails the build.

## Rule 7: when the sandbox says no, ask a human

The agent's environment blocks remote writes and SSH to the nodes. The rule is: **do not work around it.** Give the user the exact root-shell commands to paste, or ask them to run the command themselves. A block is information. If the agent routes around it, the block was decoration.

Related: commits are signed through the password manager's SSH agent, which hangs when locked. The rule is not to bypass signing but to tell the user.

## Making the rules load themselves

The rules are only useful if every session sees them. Two small files do that:

1. A short **global instruction file** that every agent session on the machine loads. It carries the credential rules and one pointer: "for any task that touches the lab, load the lab skill first".
2. A **skill** with the system map (what each system is and how to reach it), the standing rules above, and the datasources (IP assignments, system details, a config baseline). The map uses one wrapper per system.

The result: a chat opened in an unrelated project, asked something about the NAS, starts from the same safe place as a chat in the lab repo.

A **config baseline** is a good example of the pattern at small scale. For one Linux desktop, a weekly snapshot is compared with 21 cited best-practice rules. Findings carry the reason, the source and the fix. A fix is a dry run until `--yes`. Only a few kinds of fix exist (sysctl values, systemd units, I/O scheduler), each records the old values on the host, and `revert` undoes the last apply. BIOS, firmware, kernel arguments, SSH and the OS image are never touched by it. They produce findings only.

## Checks that run without being asked

- A **nightly baseline** script runs a fixed list of pass/fail checks against the lab. At the start it had 31 passes and 4 known failures, and the four were written down. If the count changes, something moved.
- A **nightly drift check** runs every check template, auto-fixes the fixable drift, re-checks, and only alerts if drift remains.
- A **change test** in CI runs read-only checks against the live hosts and a secret scan.
- A **quarterly secrets audit** is scheduled.
- A task tracker with IDs, owner answers and results. The agent updates it as it works. A reader can see what was asked, what was done and what is open.

## Takeaways

- The best guardrail is a default: read-only, dry-run, check-before-apply.
- Put every remote change behind one audited runner, even when it is slower.
- Write the rollback before the change. Test the automatic one by failing on purpose.
- Treat a sandbox block as a decision, not an obstacle.
- Never kill by name. Never print a secret.
- Put the rules where every session loads them, not in one repo.
- Run scheduled checks that fail loudly, and write the known failures down.
