---
title: "Yarn copies node_modules per worktree unless nmMode: hardlinks-global shares one store"
modules: ["platform"]
areas: ["spec-pr", "architecture"]
topics: ["yarn", "worktree", "hardlinks", "disk-usage", "dependency-install", "parallel-development"]
---

# Yarn copies node_modules per worktree unless nmMode: hardlinks-global shares one store

**Context**: 2026-10-10, two worktrees of this repo (`kc-cb-digital-base-min` and
`../kc-cb-digital-base-min-catalog-phase1`) each carried a 1.8 GB `node_modules`; `stat -f %l` on
installed files reported **link count 1** and `du -shc` of both trees summed to 3.5 GB — plain
copies, no sharing, with a third worktree about to add another copy. The 2.4 GB zip cache
(`~/.yarn/berry/cache`) was already shared; the *extracted* tree was not. Cause: Yarn 4's
`nodeLinker: node-modules` materialises packages by copy unless `nmMode` says otherwise, and
`nmMode` defaults to `classic` "for compatibility with the ecosystem".

**Problem**: "one worktree per unit" (`docs/dev/parallel-development.md`) multiplies the dependency
tree by the number of in-flight units, and the growth is invisible in the obvious reading —
`du -sh node_modules` prints the **logical** size (1.6 GB) even when every file is a hardlink onto a
shared store, so the numbers look unchanged and the duplication gets re-derived instead of fixed.

**Rule**: keep `nmMode: hardlinks-global` in `.yarnrc.yml`. Yarn then keeps one extracted store per
machine (`~/.yarn/berry/store`) and hardlinks it into every project — measured: the first tree builds
the 1.6 GB store, each later tree costs directory entries only (a throwaway copy measured 768 KB;
`du -shc` of two trees = 1.6 GB total, and `next/dist/server/next.js` carried the same inode in both
trees and in the store). Because a linked file shares its inode with the store, in-place rewrites
under `node_modules` (patch tools, manual edits, a package script overwriting its own published
file) write through to every project using it: keep the repo patch-free, and delete
`~/.yarn/berry/store` — rebuilt from the zip cache on the next install — to reclaim. The mode is
repo-wide: the Docker file stages and CI inherit it, and a store and project on different
filesystems fall back to copying without an error.

**Applies to**: `.yarnrc.yml`; `docs/dev/setup.md` ("依赖安装与磁盘占用"); the worktree section of
`docs/dev/parallel-development.md`; every new worktree's `yarn install`; the `Dockerfile` stages and
`.github/workflows/validate.yml` (which caches the zip cache only, so CI rebuilds the store locally
each run).
