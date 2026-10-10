---
title: "A script piped to `bash -s` loses everything after the first command that reads stdin"
modules: ["platform"]
areas: ["architecture"]
topics: ["deploy-script", "stdin", "health-gate", "ssh", "fail-open"]
---

# A script piped to `bash -s` loses everything after the first command that reads stdin

**Context**: `scripts/deploy/deploy.sh` is piped to the host as `ssh ... "bash -s" < scripts/deploy/deploy.sh`. On 2026-10-10 a deploy job reported success while the app container was still running its first-time initialization and the public endpoint answered 502 — the deploy log contained no `=== wait for /api/healthz`, no `healthy after Ns`, no `=== deployed`. Cause: `docker compose exec -T caddy caddy reload` attaches stdin by default, so it read the remaining script off the pipe; bash reached EOF right after that command and exited 0. Checking the 2026-09-30 deploy run against the same markers showed the health gate, the disk reclaim and `compose ps` had been silently skipped on every deploy.

**Problem**: When bash runs a script that arrives on stdin, it reads the script lazily from the same descriptor children inherit. Any command that reads stdin — `compose exec`, `docker exec -i`, an interactive tool, `cat`, `ssh` without `-n` — consumes the rest of the script. Bash then sees EOF, treats it as end of file, and exits with the last command's status. The failure is fail-open: the pipeline reports success precisely when the skipped remainder contained the verification, and the logs do not say so — the *missing* lines are the only evidence.

**Rule**: In a stdin-piped script, treat every line after a stdin-reading command as dead code until proven otherwise, and verify a pipeline's proof-of-work by searching its log for the gate's output (`healthy after Ns`), never by the job conclusion. Give stdin-reading commands `< /dev/null`; when adding a command to `deploy.sh`, first ask whether it can read stdin. The health gate is the only thing standing between "container created" and "service serving" — a green deploy whose log lacks it is a lie.

**Applies to**: `scripts/deploy/deploy.sh` and its pipe in `.github/workflows/deploy.yml`; any other script executed through a pipe; any CI contract that claims a health gate exists.
