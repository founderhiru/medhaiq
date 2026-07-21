// config/voice-config.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §7.
//
// Provider selection lives here, not hardcoded in services or routes
// (Design Principle 7: Configuration over hardcoding). Switching
// providers later (e.g. elevenlabs -> cartesia) is a change to this
// file plus one new adapter -- never a change to InterviewVoiceController
// or QuestionSpeechService.
//
// NOT YET WIRED: nothing in server.js, routes/, or interview-session.ejs
// reads this file as of PR1. It is added now so PR2/PR3 have a single,
// already-reviewed place to read provider selection from -- this PR
// introduces the file, not its consumption.

const VOICE_CONFIG = {
  sttProvider: 'vapi',
  ttsProvider: 'elevenlabs',
  defaultVoice: 'Rachel',
  language: 'en-US',
  streaming: true,
};

module.exports = { VOICE_CONFIG };
