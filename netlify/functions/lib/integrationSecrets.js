// Server-only encryption for provider credentials.
//
// Secrets are stored as `enc:v1:<base64(iv|tag|ciphertext)>`. The key is
// derived from INTEGRATION_SECRETS_KEY and is never sent to the browser.
// Existing plaintext rows remain readable for migration compatibility, but
// every new or changed secret fails closed when the key is not configured.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const KEY_ENV = "INTEGRATION_SECRETS_KEY";
const SECRET_CONFIG_KEYS = new Set(["api_key", "webhook_url"]);

function keyFromEnv(env = process.env) {
  const raw = String(env?.[KEY_ENV] || "");
  if (!raw) return null;
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(value, env = process.env) {
  if (value == null || value === "") return value;
  if (isEncryptedSecret(value)) return value;
  const key = keyFromEnv(env);
  if (!key) throw new Error(`${KEY_ENV} is required to store integration credentials.`);

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

export function decryptSecret(value, env = process.env) {
  if (value == null || value === "" || !isEncryptedSecret(value)) return value;
  const key = keyFromEnv(env);
  if (!key) throw new Error(`${KEY_ENV} is required to read encrypted integration credentials.`);

  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (payload.length < 29) throw new Error("Invalid encrypted integration credential.");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function transformConfig(config, transform) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const out = { ...config };
  for (const [key, value] of Object.entries(out)) {
    if (SECRET_CONFIG_KEYS.has(key) && typeof value === "string") {
      out[key] = transform(value);
    }
  }
  return out;
}

export function protectConnectionFields(fields, env = process.env) {
  const out = { ...(fields || {}) };
  for (const key of ["access_token", "refresh_token"]) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = encryptSecret(out[key], env);
    }
  }
  if (Object.prototype.hasOwnProperty.call(out, "config")) {
    out.config = transformConfig(out.config, (value) => encryptSecret(value, env));
  }
  return out;
}

export function revealConnectionSecrets(connection, env = process.env) {
  if (!connection) return connection;
  const out = { ...connection };
  for (const key of ["access_token", "refresh_token"]) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = decryptSecret(out[key], env);
    }
  }
  if (Object.prototype.hasOwnProperty.call(out, "config")) {
    out.config = transformConfig(out.config, (value) => decryptSecret(value, env));
  }
  return out;
}

export const _internal = { PREFIX, KEY_ENV, SECRET_CONFIG_KEYS, keyFromEnv };
