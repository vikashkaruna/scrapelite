# n8n Backup & Recovery

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §4.3
> **What gets backed up:** the entire n8n data dir (workflows, encrypted credentials, execution history, SQLite DB) **plus** the `.env` file (which holds the encryption key).
>
> **Why the .env matters:** every credential stored in n8n is encrypted with `N8N_ENCRYPTION_KEY`. A backup of the data dir without the matching .env is **unrecoverable** — you can see the encrypted blobs but can't decrypt them.

---

## Daily backup script

`n8n/backup.sh` is the canonical script. It:

1. Stops the n8n container (so SQLite is consistent)
2. tars up the data volume to `/var/backups/datiq-n8n/<timestamp>/n8n-data.tar.gz`
3. Copies `.env` into the same timestamped dir (mode 0600, only readable by root)
4. Restarts the n8n container
5. Prunes backups older than `RETENTION_DAYS=14`

Install on the host:

```bash
# 1. Copy the script into place
sudo cp n8n/backup.sh /opt/datiq-n8n/backup.sh
sudo chmod +x /opt/datiq-n8n/backup.sh
sudo chown root:root /opt/datiq-n8n/backup.sh

# 2. Create the backup root
sudo mkdir -p /var/backups/datiq-n8n
sudo chown root:root /var/backups/datiq-n8n

# 3. Install the cron job
sudo crontab -e
# Add this line:
0 3 * * * /opt/datiq-n8n/backup.sh >> /var/log/datiq-n8n-backup.log 2>&1
```

If your data volume is mounted at a non-default path, set the env var in the cron line:

```cron
0 3 * * * N8N_DATA_SRC=/your/data/path /opt/datiq-n8n/backup.sh >> /var/log/datiq-n8n-backup.log 2>&1
```

### Verify a backup

After the first cron run:

```bash
ls -la /var/backups/datiq-n8n/
# → drwxr-xr-x  root root  2026-07-26 03:00  20260726T030000Z/

ls -la /var/backups/datiq-n8n/20260726T030000Z/
# → -rw-r--r-- root root  2026-07-26 03:00  n8n-data.tar.gz
# → -rw------- root root  2026-07-26 03:00  .env

du -sh /var/backups/datiq-n8n/20260726T030000Z
# → 350M   /var/backups/datiq-n8n/20260726T030000Z
```

The first backup is the biggest (the data dir grows as workflows are added; execution history caps at the prune window).

### Off-host copy (recommended)

Local disk on the VPS is not a real backup — the VPS itself could die. Add an off-host copy step. Two options:

**Option A — Tigris (Fly.io's S3-compatible object store, 5 GB free):**
```bash
# Install the AWS CLI or use rclone
sudo apt install -y rclone
# Configure rclone for Tigris once (rclone config), then:
rclone sync /var/backups/datiq-n8n/ tigris:datiq-n8n-backups/
```

**Option B — Hetzner Storage Box (if you're already on Hetzner):**
```bash
# rsync over SSH
rsync -a /var/backups/datiq-n8n/ u123456@u123456.your-storagebox.de:/backups/n8n/
```

Add the off-host copy to the same cron job, after the local backup completes:
```bash
# Replace the cron line with a wrapper script
sudo tee /opt/datiq-n8n/backup-and-sync.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
/opt/datiq-n8n/backup.sh && rclone sync /var/backups/datiq-n8n/ tigris:datiq-n8n-backups/
EOF
sudo chmod +x /opt/datiq-n8n/backup-and-sync.sh
```

---

## Recovery (`restore.sh`)

`n8n/restore.sh` is the recovery script. It expects:

- `BACKUP_DIR` — path to a previous backup's timestamped directory
- `N8N_DATA_SRC` — where the data dir should be (default `/var/lib/datiq-n8n`)
- `ENV_FILE` — where `.env` should be restored (default `/opt/datiq-n8n/.env`)

Usage:
```bash
# 1. Identify the backup to restore
ls -t /var/backups/datiq-n8n/ | head -3

# 2. Restore
sudo BACKUP_DIR=/var/backups/datiq-n8n/20260726T030000Z \
     N8N_DATA_SRC=/var/lib/datiq-n8n \
     ENV_FILE=/opt/datiq-n8n/.env \
     /opt/datiq-n8n/restore.sh
```

The script:
1. Stops the running n8n container
2. Wipes the target data dir (after pre-flight: it must be empty or the script aborts)
3. Extracts `n8n-data.tar.gz` into place
4. Restores `.env` (but only if missing — never overwrites a current config)
5. Starts n8n

After restore, verify in the UI:
1. Login works
2. Workflows are present
3. Open any workflow with a credential — it should decrypt (if it asks for re-auth, the encryption key doesn't match)

---

## Disaster scenarios

| Scenario | Recovery |
|---|---|
| Accidental workflow delete | Restore from last backup. If you have GitHub commits with the workflow JSON, re-import `n8n/workflows/*.json` from the repo. |
| Credential rotated/lost in n8n | Re-create the credential in n8n UI; workflows auto-bind by name |
| `N8N_ENCRYPTION_KEY` lost | **All credentials are permanently unrecoverable.** You have to re-create every credential in n8n. Workflows themselves are fine (they reference credentials by name, not by content). |
| Entire VPS lost | Provision a new VPS, follow `n8n/ops/DEPLOY.md` §1-6, then `restore.sh` from the off-host copy |
| Data dir corrupted (SQLite) | `restore.sh` from the most recent good backup. The cron script stops n8n before the tar so the data is consistent; corruption from outside causes (disk failure, fsck damage) require restore. |
| `n8n` upgrade broke a workflow | `restore.sh` from the pre-upgrade backup; or fix the workflow manually and re-export to git |

---

## Retention policy

- **Daily backups:** kept for 14 days
- **Weekly backups:** not in V1 (add if you ever need longer history)
- **Off-host copy:** kept for 30 days (Tigris / Hetzner Storage Box lifecycle rule)

If the disk ever fills up, the prune step keeps only the most recent 14 days. To extend, bump `RETENTION_DAYS` in the cron line.

---

## What this does NOT back up

- The DatIQ app itself — that's in git
- Supabase — that's a managed service with its own backup policy
- Netlify env vars — those live in Netlify's dashboard; you should keep a manual copy in `scripts/env/` (gitignored) per `NETLIFY-ENVIRONMENTS.md`

If any of these go away, you can't bring n8n back online correctly even with a perfect n8n-data.tar.gz.
