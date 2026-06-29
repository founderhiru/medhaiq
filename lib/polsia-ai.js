const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function chat(message, options = {}) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: options.maxTokens || 4096,
    messages: [{ role: 'user', content: message }],
    system: options.system,
  });
  return response.content[0].text;
}

async function chatJSON(message, options = {}) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: options.maxTokens || 2048,
    messages: [{ role: 'user', content: message }],
    system: options.system + '\n\nYou must respond with valid JSON only. No markdown, no explanation.',
  });
  const raw = response.content[0].text.trim();
  const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(json);
}

module.exports = { anthropic, chat, chatJSON };