---
title: "In a worktree session, verify which tree an edit landed in — file tools may resolve against the session root"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["worktree", "parallel-development", "tooling", "relative-paths", "branch-hygiene"]
---

# In a worktree session, verify which tree an edit landed in — file tools may resolve against the session root

**Context**: 2026-10-09, the `feat/order-hub-layout-preview` unit ran from the linked worktree
`../kc-cb-digital-base-min-hub-layout` while the session's root checkout stayed on the primary
worktree (`/Users/vanness/Developer/kc-cb-digital-base-min`, branch `dev`). `bash` honored the
worktree as its cwd, but two file edits issued with worktree-relative paths
(`src/modules/order_hub/i18n/zh.json` / `en.json`) landed in the **primary** checkout instead: the
edit tool reported success with a plausible diff, yet `git -C <worktree> status` stayed clean and
the primary tree's `git status` showed the two files modified (9 duplicate i18n keys each). Both
files were clean before the session, so the revert was exact (`git checkout -- <files>`); the same
accident against a tree carrying someone else's uncommitted work would have mixed two units' edits.

**Problem**: "the edit succeeded" is not evidence of *where* it succeeded. In a session whose
workspace root is the primary worktree, a relative path can resolve against the session root while
the agent believes it is editing the worktree it reached through `bash`. The two trees are
clean-checked separately, so neither side reports a conflict — only the wrong tree's `git status`
does. Parallel sessions share the primary worktree, so a stray write there is cross-unit
contamination, not a local mistake.

**Rule**: after the first file edit of a worktree session, confirm the tree it landed in before
continuing: `git -C <worktree> status --short` must show the change, and
`git -C <primary> status --short` must not. When a tool cannot be trusted to resolve a path, pass
absolute paths into the worktree. Treat a dirty primary tree you did not create as read-only and
revert only edits you can prove are yours (clean before the session, exact diff).

**Applies to**: any `git worktree` session in this repo (`docs/dev/parallel-development.md`,
`AGENTS.md` Delivery Flow step 2), the file-editing tools of agent harnesses whose workspace root
is the primary checkout, and the review of "unexpected dirty files" reports.
