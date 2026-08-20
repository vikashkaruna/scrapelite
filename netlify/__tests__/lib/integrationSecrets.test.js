import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  protectConnectionFields,
  revealConnectionSecrets,
} from "../../functions/lib/integrationSecrets.js";

const env = { INTEGRATION_SECRETS_KEY: "test-only-integration-key" };

describe("integrationSecrets", () => {
  it("encrypts and decrypts credentials without storing plaintext", () => {
    const encrypted = encryptSecret("pat-secret", env);
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(encrypted).not.toContain("pat-secret");
    expect(decryptSecret(encrypted, env)).toBe("pat-secret");
  });

  it("uses a fresh nonce for each encryption", () => {
    expect(encryptSecret("same", env)).not.toBe(encryptSecret("same", env));
  });

  it("protects top-level and provider config secrets while preserving metadata", () => {
    const row = protectConnectionFields({
      access_token: "hubspot-token",
      refresh_token: "refresh-token",
      config: { api_key: "pat", webhook_url: "https://hooks.example", base_id: "app123" },
    }, env);
    expect(row.access_token).not.toBe("hubspot-token");
    expect(row.refresh_token).not.toBe("refresh-token");
    expect(row.config.api_key).not.toBe("pat");
    expect(row.config.webhook_url).not.toBe("https://hooks.example");
    expect(row.config.base_id).toBe("app123");
    expect(revealConnectionSecrets(row, env)).toEqual({
      access_token: "hubspot-token",
      refresh_token: "refresh-token",
      config: { api_key: "pat", webhook_url: "https://hooks.example", base_id: "app123" },
    });
  });

  it("keeps old plaintext rows readable during migration", () => {
    expect(revealConnectionSecrets({ access_token: "legacy", config: { api_key: "old" } }, env))
      .toEqual({ access_token: "legacy", config: { api_key: "old" } });
  });

  it("fails closed when a new credential is written without a key", () => {
    expect(() => encryptSecret("secret", {})).toThrow(/INTEGRATION_SECRETS_KEY/);
  });
});
