# Gate bypasses

Both release gates (staging + production) allow **manual, documented bypasses only**.
A bypass without a future `TODO` is rejected by the gate scripts.

## Vulnerabilities — `vulnerabilities.json`

Checked by `scripts/check-vulnerabilities.mjs` (blocks on `high`/`critical` npm-audit advisories).

```json
{
  "bypasses": [
    {
      "id": "GHSA-xxxx-xxxx-xxxx",
      "package": "some-dep",
      "reason": "dev-only tooling, not shipped to the browser bundle",
      "todo": "TODO: bump some-dep to >=2.0 when the vite 6 migration lands",
      "expires": "2026-09-30",
      "approvedBy": "vikashkaruna"
    }
  ]
}
```

Rules enforced by the script:

- `todo` is **required** and must contain the word "TODO".
- `expires` is **required** (ISO `yyyy-mm-dd`); an expired entry stops bypassing and the gate goes red again.
- Match by GHSA `id` (preferred) or by `package` name.

## Open issues / defects — `gate-bypass` label

Checked by `scripts/check-open-defects.mjs` (blocks on open issues labeled
`bug`, `defect`, `vulnerability`, or `regression`).

To bypass a specific issue:

1. Add the **`gate-bypass`** label to the issue.
2. Add a **`TODO:`** note to the issue body saying when/how it will be fixed.

Both are required — the label alone is rejected.
