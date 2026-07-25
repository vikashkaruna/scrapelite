// web3forms.js — thin client for the Web3Forms submission API.
// https://docs.web3forms.com/
//
// Web3Forms delivers the submission as an email to the address the access key
// was registered with. There is no free "deliver to arbitrary address" field,
// so which inbox a message lands in is a property of the KEY, not the payload.
// Everything inbox-related in the payload (`route_to`, subject tag) exists so a
// shared mailbox can filter and forward until a second key is registered.

import { WEB3FORMS_ACCESS_KEY, WEB3FORMS_ENDPOINT } from "./config.js";

const TIMEOUT_MS = 15000;

/** Error thrown when Web3Forms rejects or cannot be reached. */
export class Web3FormsError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message);
    this.name = "Web3FormsError";
    this.status = status;
    this.cause = cause;
  }
}

/**
 * POST a payload to Web3Forms.
 *
 * @param {object}  fields          Form fields. `access_key` is filled from
 *                                  config when not supplied.
 * @param {object}  [opts]
 * @param {string}  [opts.accessKey] Override the access key (used to target a
 *                                   second, inbox-specific key).
 * @param {Function}[opts.fetchImpl] Injectable fetch, for tests.
 * @returns {Promise<{ok: true, message: string}>}
 * @throws  {Web3FormsError}
 */
export async function submitToWeb3Forms(fields, opts = {}) {
  const accessKey = opts.accessKey || fields.access_key || WEB3FORMS_ACCESS_KEY;
  if (!accessKey) {
    throw new Web3FormsError("Web3Forms is not configured (missing access key).");
  }

  const doFetch = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!doFetch) {
    throw new Web3FormsError("fetch is unavailable in this environment.");
  }

  // AbortSignal.timeout is not available everywhere we run (see CLAUDE.md bug 4).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await doFetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ...fields, access_key: accessKey }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Web3FormsError(
      err?.name === "AbortError"
        ? "The request timed out. Please try again."
        : "Could not reach the mail service.",
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }

  // Web3Forms answers with JSON on both success and failure, but a gateway
  // error can still hand back HTML — don't let a parse failure mask the status.
  let body = null;
  try {
    body = await res.json();
  } catch { /* leave body null */ }

  if (!res.ok || body?.success === false) {
    throw new Web3FormsError(
      body?.message || `Mail service rejected the submission (HTTP ${res.status}).`,
      { status: res.status }
    );
  }

  return { ok: true, message: body?.message || "Submission received." };
}
