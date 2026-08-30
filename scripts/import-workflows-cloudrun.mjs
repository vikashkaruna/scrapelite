#!/usr/bin/env node
// scripts/import-workflows-cloudrun.mjs
// Bulk imports / synchronizes all 17 workflow JSON definitions in n8n/workflows/
// directly into a remote n8n instance (e.g. GCP Cloud Run) via the n8n REST API.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(__filename, "../..");
const WORKFLOWS_DIR = join(ROOT, "n8n", "workflows");

const N8N_URL = (process.env.N8N_URL || process.env.N8N_BASE_URL || "https://n8n-dev-692109205619.asia-south1.run.app").replace(/\/+$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY || process.env.DATIQ_N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error(`
❌ Error: Missing n8n API Key.
Please provide your n8n API key via the N8N_API_KEY environment variable.

Usage:
  N8N_API_KEY="your-n8n-api-key" node scripts/import-workflows-cloudrun.mjs
  
To generate an API key:
  1. Open n8n: ${N8N_URL}
  2. Navigate to Settings (gear icon) -> n8n API
  3. Click "Create API Key" and copy the key.
`);
  process.exit(1);
}

console.log(`\n======================================================`);
console.log(`  DatIQ — Remote n8n Workflow Bulk Importer (Cloud Run)`);
console.log(`======================================================`);
console.log(`Target n8n URL: ${N8N_URL}`);
console.log(`Workflows Dir:  ${WORKFLOWS_DIR}\n`);

async function fetchJson(endpoint, options = {}) {
  const url = `${N8N_URL}/api/v1${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    data = { raw: body };
  }

  return { ok: res.ok, status: res.status, data };
}

async function run() {
  // 1. Fetch all existing workflows on the remote instance
  console.log(`[1/3] Fetching existing workflows from remote n8n...`);
  const listRes = await fetchJson("/workflows?limit=250");

  if (!listRes.ok) {
    console.error(`❌ Failed to connect to n8n API (${listRes.status}):`, listRes.data);
    process.exit(1);
  }

  const existingWorkflows = listRes.data?.data || listRes.data || [];
  console.log(`✓ Found ${existingWorkflows.length} existing workflows on remote instance.\n`);

  const existingByName = new Map();
  for (const wf of existingWorkflows) {
    if (wf.name) existingByName.set(wf.name.trim().toLowerCase(), wf);
  }

  // 2. Read all local workflow files
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json")).sort();
  console.log(`[2/3] Found ${files.length} local workflow files to synchronize.\n`);

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  // 3. Upsert each workflow
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(WORKFLOWS_DIR, file);
    let rawJson;

    try {
      rawJson = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (err) {
      console.error(`❌ [${i + 1}/${files.length}] Error parsing ${file}:`, err.message);
      errorCount++;
      continue;
    }

    const name = rawJson.name || file.replace(/\.json$/, "");
    const existing = existingByName.get(name.trim().toLowerCase());

    // Prepare payload matching n8n API schema
    const payload = {
      name: rawJson.name,
      nodes: rawJson.nodes || [],
      connections: rawJson.connections || {},
      settings: rawJson.settings || {},
    };

    try {
      if (existing) {
        // Update existing workflow
        const updateRes = await fetchJson(`/workflows/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });

        if (updateRes.ok) {
          console.log(`✓ [${i + 1}/${files.length}] UPDATED: "${name}" (ID: ${existing.id}) [${file}]`);
          updatedCount++;

          // Attempt activation if needed
          try {
            await fetchJson(`/workflows/${existing.id}/activate`, { method: "POST" });
          } catch {
            // Non-blocking
          }
        } else {
          console.error(`❌ [${i + 1}/${files.length}] FAILED UPDATE: "${name}" (${updateRes.status}):`, updateRes.data);
          errorCount++;
        }
      } else {
        // Create new workflow
        const createRes = await fetchJson("/workflows", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (createRes.ok) {
          const newId = createRes.data?.id || createRes.data?.data?.id || "unknown";
          console.log(`✓ [${i + 1}/${files.length}] CREATED: "${name}" (New ID: ${newId}) [${file}]`);
          createdCount++;

          // Attempt activation
          try {
            await fetchJson(`/workflows/${newId}/activate`, { method: "POST" });
          } catch {
            // Non-blocking
          }
        } else {
          console.error(`❌ [${i + 1}/${files.length}] FAILED CREATE: "${name}" (${createRes.status}):`, createRes.data);
          errorCount++;
        }
      }
    } catch (err) {
      console.error(`❌ [${i + 1}/${files.length}] Exception processing ${file}:`, err.message);
      errorCount++;
    }
  }

  console.log(`\n======================================================`);
  console.log(`  Remote Import Summary`);
  console.log(`======================================================`);
  console.log(`  Total Local Workflows: ${files.length}`);
  console.log(`  Created:               ${createdCount}`);
  console.log(`  Updated:               ${updatedCount}`);
  console.log(`  Errors:                ${errorCount}`);
  console.log(`======================================================\n`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error during workflow import:", err);
  process.exit(1);
});
