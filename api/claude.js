// Vercel serverless function that proxies to the Anthropic API.
// Uses Haiku for both per-turn word generation and the compact end-screen
// scoring pass (four fields only — fast and cheap).

const MODELS = {
  word: 'claude-haiku-4-5-20251001',
  score: 'claude-haiku-4-5-20251001',
};

// Scoring output is small now (4 fields, ~80 tokens typical).
const MAX_TOKENS = {
  word: 20,
  score: 400,
};

// Deterministic scoring; playful word generation.
const TEMPERATURE = {
  word: 0.9,
  score: 0,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { prompt, task, temperature } = body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'missing prompt' });
    return;
  }

  const model = MODELS[task] || MODELS.word;
  const maxTokens = MAX_TOKENS[task] || MAX_TOKENS.word;
  const temp = typeof temperature === 'number'
    ? Math.max(0, Math.min(1, temperature))
    : (TEMPERATURE[task] ?? 0.7);

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: temp,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(502).json({ error: 'anthropic error', detail: errText });
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('')
      .trim();

    res.status(200).json({ text, model });
  } catch (e) {
    res.status(500).json({ error: 'upstream failure', detail: String(e) });
  }
}
