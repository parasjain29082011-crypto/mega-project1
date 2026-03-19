// api/oracle.js — Vercel Serverless Function

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, systemPrompt, maxTokens } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });

    const GEMINI_KEY = process.env.GEMINI_API_KEY_FINAL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens || 512 }
    };
    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API error');

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
