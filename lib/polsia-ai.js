// AI service wrapper — routes all product AI through Polsia proxy.
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  baseURL: process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai',
  apiKey: process.env.POLSIA_API_KEY,
});

// Simple chat — structured text output (scoring, reports)
async function chat(message, options = {}) {
  const response = await anthropic.messages.create({
    max_tokens: options.maxTokens || 4096,
    messages: [{ role: 'user', content: message }],
    system: options.system,
  }, {
    headers: options.subscriptionId ? { 'X-Subscription-ID': options.subscriptionId } : {},
  });
  return response.content[0].text;
}

// Structured JSON output — for scoring responses
async function chatJSON(message, options = {}) {
  const response = await anthropic.messages.create({
    max_tokens: options.maxTokens || 2048,
    messages: [{ role: 'user', content: message }],
    system: options.system + '\n\nYou must respond with valid JSON only. No markdown, no explanation, no text outside the JSON object.',
  }, {
    headers: options.subscriptionId ? { 'X-Subscription-ID': options.subscriptionId } : {},
  });
  const raw = response.content[0].text.trim();
  // Strip markdown code fences if present
  const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(json);
}

module.exports = { anthropic, chat, chatJSON };