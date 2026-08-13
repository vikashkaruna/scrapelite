# n8n Upgrade Guide

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §4.6
> **Cadence:** n8n ships a new release every Tuesday. The 11+5+1 DatIQ workflows are tested against a pinned minor (`1.95.x` for V1).

---

## Strategy

- **Pin to a specific minor** (e.g., `1.95.4`) for the first 3 months. Bump deliberately after reading the release notes.
- **Always upgrade staging first.** If you don't have a staging n8n, do it on a copy of the data dir on a different port.
- **Roll back via the previous Docker image** if the upgrade breaks anything; n8n's data schema is forward-only so a rollback may require a backup restore.

---

## Pre-flight (every upgrade)

1. **Take a fresh backup.** Don't skip this. `n8n/ops/BACKUPS.md` has the script.
2. **Read the release notes** for the new version. Watch for:
   - **Breaking workflow changes** — node renames, removed node types
   - **Database migrations** — some n8n releases run a one-time migration on first boot
   - **Auth/API changes** — the MCP Server Trigger has been evolving
3. **Diff the workflow JSONs in git** (`n8n/workflows/`) against what you've exported from the running n8n. If your live version drifted from git, re-export to git first.

```bash
# Pre-upgrade: export current workflows from the running n8n
npx n8n export:workflow --all --output=./n8n-pre-upgrade.json

# Compare against git
diff <(jq -S . n8n-pre-upgrade.json) <(jq -S . n8n/workflows/*.json) | head
```

---

## Upgrade procedure

### On the VPS (production)

```bash
# 1. Take a fresh backup
sudo /opt/datiq-n8n/backup.sh

# 2. Pull the new image
cd /opt/datiq-n8n
docker compose pull n8n

# 3. Stop the running n8n (the new image is loaded on next start)
docker compose down

# 4. Start the new image
docker compose up -d

# 5. Watch the logs for the migration banner
docker compose logs -f n8n
# Look for: "n8n ready on ::, port 5678"
# If you see a migration step, it can take 1-2 minutes on a large workflow set.

# 6. Verify in the UI
# - Workflows are present
# - Credentials decrypt
# - Executions tab is reachable
# - One of the workflows is firing on its test trigger
```

### On staging (if you have a separate n8n instance)

Same procedure but on the staging host. The staging n8n is a smaller dataset so migrations are faster. Confirm:
- All 11+5+1 workflows import successfully
- No "unsupported node type" errors
- Test a workflow with a test payload

---

## Rollback

If the upgrade breaks something and you need to roll back fast:

```bash
# 1. Edit the image tag in docker-compose.yml
sed -i 's/n8nio\/n8n:1.95.4/n8nio\/n8n:1.95.3/' /opt/datiq-n8n/docker-compose.yml

# 2. Pull the old image
cd /opt/datiq-n8n
docker compose pull n8n

# 3. Stop and start
docker compose down
docker compose up -d

# 4. If the data schema changed (n8n ran a forward-only migration on the
#    new version), you also need to restore the data dir from the pre-upgrade
#    backup. The data dir is at /var/lib/datiq-n8n; the backup is at
#    /var/backups/datiq-n8n/<timestamp>/.
sudo BACKUP_DIR=/var/backups/datiq-n8n/<timestamp> /opt/datiq-n8n/restore.sh
```

---

## What NOT to do

- **Don't run `:latest`.** Tag the image to a specific minor. Latest can break in unpredictable ways mid-week.
- **Don't skip the backup.** Even small upgrades can run a schema migration.
- **Don't upgrade in the middle of a workflow execution burst.** The 5-min orchestrator poll means worst case you lose 5 min of work. But if you're testing something time-sensitive, upgrade at off-hours.
- **Don't run two n8n instances against the same data dir.** SQLite is file-locked; you'll corrupt the database.

---

## When to upgrade

- **Patch releases** (e.g., `1.95.3` → `1.95.4`) — same minor, bugfix only. Safe to apply within a week.
- **Minor releases** (e.g., `1.95.x` → `1.96.0`) — new features, possible workflow changes. Wait 2-3 weeks after release for early bugs to surface, then upgrade deliberately.
- **Major releases** (e.g., `1.x` → `2.x`) — rare. Test on staging for at least a week. Read every release note.

---

## Tracking

Keep a CHANGELOG entry in `n8n/CHANGELOG.md` (created on the first upgrade):

```markdown
# n8n upgrades

- 2026-07-26: pinned 1.95.4 (initial install, v2 plan ship)
- YYYY-MM-DD: bumped 1.95.4 → 1.96.0 (reason: needed new MCP trigger feature)
```

That way you have a record of "what was running when" for incident debugging.
