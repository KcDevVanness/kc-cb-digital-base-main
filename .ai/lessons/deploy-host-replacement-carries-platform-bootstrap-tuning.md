---
title: "Replacing the deploy host carries the image platform, bootstrap distro paths and memory tuning"
modules: ["platform"]
areas: ["architecture"]
topics: ["deployment-host", "image-platform", "bootstrap-scripts", "instance-sizing", "elastic-ip"]
---

# Replacing the deploy host carries the image platform, bootstrap distro paths and memory tuning

**Context**: 2026-10-10 the production host `i-056bebe0773cdd6bc` (t3.large, x86_64, Ubuntu, 8 GB) was terminated and replaced by `i-0b63a86ce28929eec` (t4g.micro, aarch64, Amazon Linux 2023, 1 GiB). Three things broke independently of the app: the `:production` image in GHCR was amd64-only (`exec format error` on the new host at `up -d`), `bootstrap-host.sh` installed Docker through apt (AL2023 has dnf, no compose-plugin package, no `git`, and the SSH user is `ec2-user` not `ubuntu`), and every memory valve (`NODE_OPTIONS`, `DB_POOL_MAX`, postgres `shared_buffers`, redis `maxmemory`) plus the swap size was sized for 8 GB.

**Problem**: No host fact is derived at deploy time — image platform, install path, SSH user, memory ceilings and swap are each hard-coded for one host class across four files, so changing the instance silently invalidates the other three: the pipeline fails at `up -d`, the bootstrap script dies at `apt-get`, or the stack boot-loops against the OOM killer, each with an unrelated-looking symptom. Two further traps: terminating an instance deletes its EBS volumes unless `DeleteOnTermination=false` or a snapshot exists, and only an Elastic IP — re-associated to the replacement before anything else touches addresses — keeps DNS and the `DEPLOY_HOST` secret valid across the swap.

**Rule**: Treat a deploy-host replacement as one change across four coupled surfaces — (1) `.github/workflows/deploy.yml`: `platforms` matching the host arch plus a runner of that arch (`ubuntu-24.04-arm` is free for public repos; QEMU emulation of arm64 is not a substitute), (2) `scripts/deploy/bootstrap-host.sh`: per-distro install path and SSH user, (3) `docker-compose.deploy.yml` + the generated `.env`: memory values and swap for the new instance class, (4) `docs/deploy/*`. Probe the fresh host before trusting the script (`uname -m`, `dnf list --available docker`, `command -v git`), associate the Elastic IP first, and verify through the pipeline's own health gate rather than a manual `docker run`.

**Applies to**: `.github/workflows/deploy.yml`, `scripts/deploy/*.sh`, `docker-compose.deploy.yml`, `docs/deploy/{cicd,host-access}.md`, repository secrets `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY`.
