# Phase 2B — Voice Layer Optimization: Completion Report

**Status:** Implemented on top of `founder-dashboard-staging`, not yet applied/deployed. Validated locally (syntax, module loading, and live behavioral tests of the new token logic — see Validation Evidence). No deploy has happened from here.

---

## Design refinement (per your review)

Your requested refinement — no interview text in a GET URL — is implemented via a **POST-prepare / GET-stream token handoff**, not the GET-with-query-string design from the original architecture note:

1. Client **POSTs** the real question text to `/api/voice/synthesize/prepare` (same shape as the existing `/synthesize` route — text never leaves a POST body).
2. Server stores it momentarily (in-memory, 30s TTL, single-use) keyed by a random 192-bit token, and returns **only that token** as `streamUrl: '/api/voice/stream/{token}'`.
3. `BrowserAudioPlayer.play(streamUrl)` is called exactly as it already handles any URL string — the browser's own GET (with the token, never the text) triggers native progressive playback.
4. The GET route validates the token (exists, unexpired, deleted-on-first-use, and bound to the requesting user as defense in depth), then pipes ElevenLabs' stream through live.

This was technically achievable without significantly increasing complexity — the two-request POST/GET split is a small, well-understood pattern (equivalent to a signed/one-time URL), and it fully satisfies both your constraint and the original goal (progressive playback via the browser's native audio element, zero changes to `BrowserAudioPlayer`).

---

## 1. Files Changed

| File | Responsibility |
|---|---|
| `config/voice-server-config.js` | Added `ttsModelId` (from `ELEVENLABS_TTS_MODEL`, default `eleven_flash_v2_5`) — the single authoritative source for model selection |
| `public/js/voice/voice-client-config.js` | Removed dead `modelId: "eleven_v3"` field |
| `services/voice-tts-proxy.js` | Added `model_id` to the existing non-streaming call; added the token store (`prepareStream`) and true-streaming pass-through (`streamViaElevenLabsToken`) |
| `routes/voice-tts.js` | Added `POST /synthesize/prepare` and `GET /stream/:token`; existing `POST /synthesize` unchanged, now the fallback path |
| `public/js/voice/tts/elevenlabs-tts-adapter.js` | `synthesize()` now tries the streaming path first (when configured), falls back to the original blob path on any failure; original logic preserved verbatim, just renamed to `_synthesizeViaBlob` |
| `views/interview-session.ejs` | **Not touched by this phase** — confirmed via diff; the adapter's public contract (`synthesize(text)` → Blob-or-URL) didn't change, so nothing above it needed to |
| `BrowserAudioPlayer`, `QuestionSpeechService`, `InterviewVoiceController`, the passive FSM | **Not touched** — confirmed via diff |

---

## 2. Architectural Summary

**Why POST-prepare/GET-stream instead of the originally-proposed GET-with-text:** your refinement request. This adds one new small server-side concern (an ephemeral, single-use, TTL'd token store) in exchange for keeping question text out of every URL, browser history entry, and access log line permanently. The added complexity is genuinely small — a `Map`, a random token, and an ownership check — not a new subsystem.

**Why the fallback lives inside the adapter, not further up:** `QuestionSpeechService` and everything above it already only knows "call `synthesize(text)`, get back something playable." Keeping the streaming-vs-blob decision and its fallback entirely inside `ElevenLabsTTSAdapter` means zero other file needs to know streaming was attempted at all — satisfying "preserve the existing playback controller" and "preserve Rev4 orchestration" by construction, not by care taken elsewhere.

**Why the token is short-lived and single-use:** the GET fires essentially synchronously after the POST resolves (same `synthesize()` call), so there's no legitimate reason for a token to survive more than a few seconds. Deleting on first lookup (even a *failed* lookup, confirmed in testing below) closes the door on retry/replay entirely.

---

## 3. Before vs. After Request Flow

**Before:**
```
Client: fetch POST /api/voice/synthesize (text, voice, language, streaming:true -- ignored)
  → Server: no model_id sent -- ElevenLabs silently defaults to eleven_multilingual_v2
  → Server: buffers the ENTIRE response (await response.arrayBuffer())
  → Server: responds with the complete audio buffer
  → Client: response.blob() -- waits for the full download
  → BrowserAudioPlayer.play(blob)
```

**After:**
```
Client: fetch POST /api/voice/synthesize/prepare (text, voice, language)
  → Server: stores {text, voice, language, userId}, returns {streamUrl} (token only)
Client: BrowserAudioPlayer.play(streamUrl) -- browser issues its own GET
  → Server: GET /api/voice/stream/:token -- validates + deletes token (single-use)
  → Server: POST to ElevenLabs' /stream endpoint, model_id=eleven_flash_v2_5 (or
    ELEVENLABS_TTS_MODEL override), pipes the response through LIVE (Readable.fromWeb
    .pipe(res)) -- nothing buffered server-side
  → Browser: native progressive playback begins as bytes arrive
  ↳ On ANY failure at either step: adapter falls back to the original
    POST /api/voice/synthesize + blob path, unchanged
```

---

## 4. Expected Latency Reduction

Two independent improvements, both real but neither precisely quantifiable from here without live staging data:

- **Model change alone** (`eleven_multilingual_v2` implicit default → explicit `eleven_flash_v2_5`): ElevenLabs publishes ~75ms time-to-first-audio for Flash vs. no published sub-second figure for multilingual v2 (positioned as the higher-latency, higher-quality tier). This improvement applies even on the fallback path, so it's realized regardless of whether streaming succeeds.
- **True streaming** removes the "wait for the entire file" tax entirely — the browser starts playing as soon as enough of the stream has arrived, rather than after ElevenLabs finishes generating the whole utterance. For a typical 1-3 sentence interview question, this could plausibly cut perceived latency by more than the model change alone, but I don't have a real number to give you — it depends on utterance length and ElevenLabs' actual streaming chunk cadence in practice.

**Recommendation:** the new `stream:prepared` (server) and `stream:first_audio_byte` (server) log lines, plus the adapter's `request:start`, give you exactly what's needed to compute a real before/after delta from staging logs — I'd treat this section as a hypothesis to confirm, not a number to trust yet.

## 5. Expected TTS Cost Reduction

Per ElevenLabs' current published pricing structure, Flash models run at roughly half the per-character credit cost of the higher tiers. Since the implicit default (`eleven_multilingual_v2`) was in the higher-cost tier, switching to the explicit Flash default should meaningfully reduce cost per synthesized question — this is independent of the streaming change and applies to every request, including fallback-path ones.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Streaming path fails (network, ElevenLabs error, token issue) | Falls back to the original, already-proven POST+blob path automatically — same behavior as before this phase existed |
| Token store grows unbounded over long uptime | 60s sweep interval removes expired entries; also self-limiting since real usage deletes tokens within seconds of creation |
| A token leaks (e.g., logged somewhere unexpected) | 30s TTL, single-use, and bound to the issuing user's ID — a leaked token is only useful to the same authenticated user, for seconds, once |
| Explicit `model_id` behaves differently than the silent default in some edge case | `eleven_flash_v2_5` is ElevenLabs' own recommended model for this exact use case (real-time conversational) — this is a correction toward their guidance, not a novel choice |
| Orchestration/FSM regression | None of those files were touched at all — confirmed via diff, not just by design intent |

## 7. Rollback Plan

- **Model:** unset `ELEVENLABS_TTS_MODEL` to fall back to the `eleven_flash_v2_5` default, or remove the `model_id` line in `voice-tts-proxy.js` to fully restore the old silent-default behavior.
- **Streaming:** delete the `/synthesize/prepare` and `/stream/:token` routes, and revert `elevenlabs-tts-adapter.js`'s `synthesize()` to call `_synthesizeViaBlob` directly — the original POST `/synthesize` route and its logic are untouched and still fully functional on their own.
- Both are independently revertible; neither depends on the other having shipped.

---

## Validation Evidence

- **Syntax:** `node --check` clean on all 5 modified files.
- **Module loading:** `routes/voice-tts.js` loads successfully and registers exactly the 3 expected routes (`POST /synthesize`, `POST /synthesize/prepare`, `GET /stream/:token`) — verified by requiring it directly and inspecting the Express router stack.
- **Token logic — live behavioral test** (not just syntax) against the real `prepareStream`/`streamViaElevenLabsToken` functions:
  - ✅ Token issued as a non-empty, URL-safe string
  - ✅ Wrong-user access correctly rejected (`TOKEN_FORBIDDEN`)
  - ✅ That rejected attempt still consumed the token (single-use holds even on a *failed* lookup — confirmed by a subsequent legitimate attempt also failing, this time as `TOKEN_NOT_FOUND`)
  - ✅ Correct-user, fresh-token request passes all validation and proceeds to the real network call (only fails there, on a deliberately fake API key — expected and correct)
  - ✅ Re-using an already-consumed token is rejected (`TOKEN_NOT_FOUND`)
- **Diff/blast-radius check:** `git diff --stat` confirms `views/interview-session.ejs` has **zero new lines from this phase** (identical to its Rev4A.1 state), and `BrowserAudioPlayer.js`, `QuestionSpeechService`, `InterviewVoiceController`, and the passive FSM module are absent from the changed-files list entirely.

**Not yet validated (needs staging, not available from here):** real end-to-end streaming playback in an actual browser, real ElevenLabs latency numbers, and a live interview regression pass (skip/interrupt/rapid-submit against the new streaming path specifically). These are exactly the items in the Phase 2B spec's own Validation list that require the app actually running — recommend running through that list on staging before promoting to `main`.
