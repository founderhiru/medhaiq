// ═══════════════════════════════════════════════════════════════════════════
// routes/vapi-silent-model.js
// ═══════════════════════════════════════════════════════════════════════════
// PURPOSE (2026-07-25, tts_pipeline architecture fix):
//
// MedhaIQ's actual architecture already owns 100% of the conversation:
//   - services/interview.js decides every question, follow-up, and reprompt
//   - The frontend submits candidate answers to our own HTTP route
//     (routes/interview.js), not through Vapi at all
//   - QuestionSpeechService + ElevenLabs speaks whatever our backend decided
//
// Vapi's job in this architecture is ONLY: capture the candidate's mic audio
// and transcribe it (STT). It should never generate its own conversational
// text, because there is no point in the flow where Vapi's own "model" stage
// is supposed to have a voice of its own — the real brain lives entirely in
// services/interview.js, several steps removed from Vapi's request/response
// turn cycle.
//
// Root cause of the "Vapi Assistant speaks" bug (confirmed via live log,
// 2026-07-25): the Vapi assistant's model is a real hosted Claude. Asking it
// (via system prompt) to "never produce output, regardless of what's asked"
// is structurally a jailbreak-shaped instruction, and Claude's own safety
// training is built to resist exactly that pattern — so it refuses and
// explains its real identity instead. No wording of that prompt can reliably
// win this; it isn't a bug in the prompt, it's Claude correctly doing what
// it's designed to do.
//
// THE FIX (per Vapi's own documented architecture — docs.vapi.ai Core
// Models / Data Flow / Custom LLM guides): Vapi's assistant.model field
// supports `provider: 'custom-llm'`, which points the model stage at a
// server you control instead of a real model provider. This is Vapi's own
// documented, first-class mechanism for "I own the conversation logic" —
// not a workaround. This route is that server: it implements the minimum
// OpenAI-chat-completions-compatible contract Vapi's custom-llm requires,
// and always returns an immediate, empty completion. There is no model
// running behind this endpoint at all — nothing to refuse, nothing to
// self-identify, nothing to generate. It is structurally silent, not
// instructed to be silent.
//
// TO ACTIVATE: on the Vapi dashboard (or via a PATCH to /assistant), change
// the assistant's `model` field to:
//   { "provider": "custom-llm", "url": "<this server's public URL>/api/vapi-silent-model/chat/completions", "model": "silent-stub" }
// That is a dashboard/assistant-config change outside this repository —
// this file only provides the endpoint for it to point at. Once switched,
// the assistantOverrides.model system-prompt override in
// views/interview-session.ejs becomes unnecessary and can be removed in a
// follow-up cleanup (left in place for now — additive, harmless, and out of
// scope for this change).
//
// NOTE: routes/vapi.js's existing POST /api/vapi-webhook (assistant-request
// handler) is a different, separate mechanism — it only fires for calls
// that don't specify an assistant ID upfront and ask Vapi's server to
// supply one dynamically. Since our client always passes a concrete
// assistant ID (VAST) to vapiSDK.run()/vapi.start(), that webhook path is
// very likely never invoked in the current flow (consistent with the log
// evidence: the assistant speaks generic self-referential text, never the
// crafted spokenText that webhook would produce). Left untouched — not in
// scope here, and may be intentional infrastructure for a different call
// path.
// ═══════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();

router.post('/vapi-silent-model/chat/completions', (req, res) => {
  const isStream = !!(req.body && req.body.stream);
  const id = 'chatcmpl-silent-' + Date.now();
  const created = Math.floor(Date.now() / 1000);
  const model = (req.body && req.body.model) || 'silent-stub';

  console.log('[SILENT-MODEL] chat/completions called — returning empty completion (no real model invoked), stream=' + isStream);

  if (isStream) {
    // Vapi's custom-llm integration expects Server-Sent Events when
    // stream:true is requested. A single chunk with empty content and an
    // immediate stop is the minimal valid stream — see Vapi's Custom LLM /
    // Fine-tuned Models docs for the expected chunk shape.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const chunk = {
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    };
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // Non-streaming fallback — same empty-completion contract. Includes BOTH
  // `message` (standard OpenAI non-streaming shape) AND `delta` (confirmed,
  // via a live Vapi support thread, to be the shape Vapi's client actually
  // reads in at least some cases even outside a strict streaming request) —
  // this is intentionally defensive: extra fields are harmless and ignored
  // by any OpenAI-compatible client that expects only one of them, but
  // omitting the one Vapi actually reads would silently break this endpoint.
  return res.status(200).json({
    id, object: 'chat.completion', created, model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: '' },
      delta: { role: 'assistant', content: '' },
      logprobs: null,
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
});

module.exports = router;
