# DSA bank dev tooling

These scripts are **not needed at runtime** — they exist to grow/normalize the problem banks
in `backend/src/main/java/com/aitutor/dsa/`.

| Script | Purpose |
| --- | --- |
| `analyze_banks.py` | Read-only: reports problem counts, signatures and anomalies per bank |
| `regen_banks.py` | Rewrites/normalizes factory calls in the six `DsaBank*.java` files |
| `gen_core.py` | Regenerates `DsaSig.java` + `DsaFns.java` from the bank factory names |

## Gotchas (read before running)

1. **`regen_banks.py` uppercases factory names.** After every regen you MUST run a lowercase
   pass over all six bank files, or the build breaks:
   ```python
   re.sub(r'DsaCatalog\.([A-Z2]+)\(', lambda m: 'DsaCatalog.' + m.group(1).lower() + '(', src)
   ```
2. **`gen_core.py` regenerates `DsaSig`/`DsaFns` from bank factory names only.** The manual
   additions (the `SI2S` enum constant, `FSI2S` interface and `si2s` catalog factory) survive
   a regen only because a bank actually calls `DsaCatalog.si2s(...)` (`kth-distinct-string`).
   If you remove that problem, re-apply the SI2S additions by hand.
3. After any regen, re-run the oracle self-test before committing:
   compile the backend, then iterate `DsaCatalog.all()` and call `expectedFor(...)`
   on every sample and hidden test line — exceptions or empty outputs indicate a
   test-line/signature/oracle mismatch.
4. Pristine bank backups from the original authoring session live in `/tmp/dsa_backup/`
   (session-local; not part of the repo).
