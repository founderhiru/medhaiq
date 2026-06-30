// AI wrapper — uses Anthropic SDK directly.
// Set ANTHROPIC_API_KEY in environment (Render → Environment Variables).
const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[polsia-ai] WARNING: ANTHROPIC_API_KEY is not set. AI features will fail.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5'; 
async function chat(message, options = {}) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: options.maxTokens || 400,
    messages: [{ role: 'user', content: message }],
    ...(options.system ? { system: options.system } : {}),
  });
  return response.content[0].text;
}

async function chatJSON(message, options = {}) {
  const systemPrompt = (options.system || '') + '\n\nYou must respond with valid JSON only. No markdown, no explanation, no text outside the JSON object.';
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: options.maxTokens || 800,
    messages: [{ role: 'user', content: message }],
    system: systemPrompt,
  });
  const raw = response.content[0].text.trim();
  // Strip markdown code fences if model added them despite instructions
  const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(json);
}

module.exports = { anthropic, chat, chatJSON };
