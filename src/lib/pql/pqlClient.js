// pqlClient.js — buffered client for activation events.
//
// These do NOT go through analyticsService.track(). That writes to
// `analytics_events`, which migration 0005 made world-readable — `USING (true)`
// — on the stated grounds that it holds "non-PII, no user content". True of a
// page view; false the moment an event carries `domain`, `templateKey` or
// `count`, because those say WHICH COMPANIES a specific user researched and how
// many accounts they enriched. Publishing a recruiter's sourcing list to anyone
// holding the publishable key is a leak, not an analytics decision.
//
// So they go to POST /api/pql/events, which writes them with the service key to
// `activation_events` (0040) — private, FK'd to the account, cascading on
// deletion.
//
// Buffered for the same reason analyticsService buffers: one HTTP request per
// user action, on a path the user is waiting on, is not a trade worth making
// for a metric.

const FLUSH_DELAY_MS = 4000;
const MAX_BUFFER = 50;

let _buffer = [];
let _timer = null;
let _send = null; // injected; see configurePqlClient

/**
 * Wire the transport. Called once from the app shell with apiClient, so this
 * module stays free of an import cycle (apiClient → analytics → apiClient) and
 * stays trivially testable without mocking fetch.
 */
export function configurePqlClient(sendFn) {
  _send = typeof sendFn === "function" ? sendFn : null;
}

function scheduleFlush() {
  if (_timer) return;
  _timer = setTimeout(() => { _timer = null; void flushPqlEvents(); }, FLUSH_DELAY_MS);
  // Never hold a Node process (or a test runner) open for a metric.
  if (typeof _timer?.unref === "function") _timer.unref();
}

/**
 * Queue one activation event. Never throws, never returns a rejected promise:
 * an analytics failure must not be able to surface inside a user flow, and
 * every caller here is fire-and-forget.
 */
export function recordActivationEvent(name, properties = {}) {
  try {
    if (!name) return { ok: false };
    _buffer.push({ name, properties, occurredAt: new Date().toISOString() });
    // Drop the OLDEST on overflow. The newest events are the ones that change
    // a score — an old duplicate of a signal that already saturated is the
    // cheapest thing to lose.
    if (_buffer.length > MAX_BUFFER) _buffer = _buffer.slice(-MAX_BUFFER);
    scheduleFlush();
    return { ok: true, queued: _buffer.length };
  } catch {
    return { ok: false };
  }
}

/** Send whatever is buffered. Safe to call at any time. */
export async function flushPqlEvents() {
  if (!_buffer.length || !_send) return { ok: true, sent: 0 };
  const batch = _buffer;
  _buffer = [];
  try {
    await _send({ events: batch });
    return { ok: true, sent: batch.length };
  } catch {
    // Deliberately NOT re-queued. A guest, a signed-out session, or an
    // unconfigured Supabase all land here, and a retry loop would keep
    // replaying events that can never be attributed to an account — the exact
    // shape of the guest-flush bug already documented for extractions.
    return { ok: false, sent: 0 };
  }
}

export function _resetPqlClientForTests() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _buffer = [];
  _send = null;
}

export const __testing = { FLUSH_DELAY_MS, MAX_BUFFER, buffer: () => _buffer.slice() };
