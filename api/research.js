// api/research.js — Vercel Serverless Function

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { location } = req.body;
    if (!location) return res.status(400).json({ error: 'Location required' });

    const GEMINI_KEY = process.env.GEMINI_API_KEY_V2;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Tell me the complete history of: ${location}` }] }],
        systemInstruction: {
          parts: [{ text: `You are Ancient Trace — an expert historian. Generate a rich Wikipedia-style historical report in markdown with EXACTLY these section headings (## prefix):
## 🏛️ Historical Overview
## 👥 Notable Figures
## ⚔️ Major Events & Battles
## 🎨 Culture & Architecture
## 💰 Economic History
## 🔮 Legacy & Modern Significance
Be detailed, fascinating and accurate. Use markdown bold for key terms.` }]
        },
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API error');

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
