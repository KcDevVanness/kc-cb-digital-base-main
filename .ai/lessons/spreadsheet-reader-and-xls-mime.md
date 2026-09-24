---
title: "A spreadsheet reader is app-owned, and a legacy .xls never resolves from MIME_BY_EXTENSION"
modules: ["sourcing", "attachments"]
areas: ["integration", "module-data"]
topics: ["spreadsheet", "xls", "mime-detection", "attachment-upload", "external-parser-dependency"]
---

# A spreadsheet reader is app-owned, and a legacy .xls never resolves from MIME_BY_EXTENSION

**Context**: Building the supplier-quotation Excel import (`sourcing`) required reading the owner's real files: `PETKIT Quotation Sheet-2026_NEW.xlsx` (OOXML) and `订单表-2026 EXW.xls` (a WPS-written BIFF8 compound document). Two installed surfaces look like they could carry this work and cannot: `@open-mercato/core` ships an XLSX **writer** (`staff/lib/timesheets-reports/xlsx.ts`, `buildXlsx`) but no reader anywhere in the install, and the disabled `sync_excel` module parses CSV only, with a closed `['customers.person']` entity enum living inside `node_modules`.

**Problem**: Two traps recur when a module needs spreadsheet I/O.
1. "The framework already does Excel" is only half true — the writer exists so exports need no dependency, and that invites the assumption that a reader does too. Grep of `package.json`, `yarn.lock` and every `@open-mercato/*` package for `xlsx|exceljs|sheetjs|papaparse` returns nothing; only hand-rolled CSV parsers exist.
2. `.xlsx` and `.xls` are not variants of one format. `.xlsx` is a ZIP, so `detectAttachmentMimeType` resolves it through the ZIP sniff plus `MIME_BY_EXTENSION.xlsx`. `.xls` is an OLE compound document (`D0CF11E0`), which `detectMimeTypeFromBuffer` does not recognize at all, and `MIME_BY_EXTENSION` has no `xls` key — so the attachment route falls back to the client-declared mime or `application/octet-stream`. A route (or a storage rule) that gates on `application/vnd.ms-excel` silently rejects the very file the user uploads, and a hand-rolled OOXML reader cannot open it either.

**Rule**: Treat spreadsheet reading as an app-owned concern with an explicit dependency decision, and branch on the **file extension**, never on the attachment mime, when deciding how to parse:
- Do not attempt to reuse `sync_excel`/`data_sync` for a workbook import unless the file is CSV and the target entity is already in its enum; its parser and entity list are installed code.
- Add a real reader dependency when BIFF8 must be supported (SheetJS `xlsx` covers `.xls`/`.xlsx`/`.csv` in one package); a hand-rolled reader is justified only for OOXML-only with a documented `.xls` re-save step.
- Accept `.xls`/`.xlsx`/`.csv` by extension in the module's own route, and keep the parse path free of DB/auth so it stays testable and liftable.
- Pin library choice against the owner's actual files, not a fabricated fixture: parse the real workbook in a one-off check and record the expected row/column counts, then keep small literal fixtures in unit tests.

**Applies to**: `src/modules/sourcing/**` (parser, parse/remap routes), any future module that accepts a spreadsheet upload, `attachments/lib/security.ts` consumers that gate on mime, and the `sync_excel` decision recorded in `.ai/specs/2026-09-22-supplier-quotation-import.md`.
