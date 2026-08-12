// netlify/functions/lib/supabaseServerClient.js
//
// @supabase/supabase-js >=2.108 eagerly constructs a RealtimeClient inside
// createClient() (SupabaseClient constructor -> _initRealtimeClient ->
// new RealtimeClient() -> _initializeOptions()), which resolves
// `options.transport ?? WebSocketFactory.getWebSocketConstructor()`
// SYNCHRONOUSLY at construction time — not lazily on first `.channel()`
// call. Netlify Functions run on Node 20, which has no native global
// WebSocket, so `getWebSocketConstructor()` THROWS:
//   "Node.js 20 detected without native WebSocket support. ..."
// None of these server-side functions use Realtime (.channel()/.subscribe()
// are never called — they only use auth.getUser() and REST queries), so the
// fix is to hand createClient() a harmless placeholder transport. This
// short-circuits the `??` fallback and skips getWebSocketConstructor()
// entirely, without adding a "ws" dependency neither Node runtime needs.
//
// Every Netlify Function that calls createClient() must route through
// this helper — see docs/SESSION-HANDOFF-2026-08-13-REALTIME-WEBSOCKET-FIX.md.
class NoRealtimeTransport {}

/**
 * Merge caller-supplied supabase-js client options with the realtime
 * transport stub. Caller's own `realtime` sub-options (if any) are
 * preserved; only `transport` is forced.
 */
export function noRealtimeOptions(options = {}) {
  return {
    ...options,
    realtime: { ...options.realtime, transport: NoRealtimeTransport },
  };
}

export const _internal = { NoRealtimeTransport };
