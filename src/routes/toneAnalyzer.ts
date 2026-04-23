import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  text: Joi.string().min(10).max(10000).required(),
});

async function callClaude(prompt: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content: prompt }] },
    { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 }
  );
  const text = res.data.content[0]?.text ?? '{}';
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch { return null; }
}

router.post('/tone-analyze', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const prompt = `Analyze the tone of the following text.

Return ONLY valid JSON:
{
  "primary_tone": "one of: formal, casual, friendly, professional, aggressive, passive, confident, uncertain, humorous, serious, empathetic, neutral",
  "secondary_tones": ["tone1", "tone2"],
  "sentiment": "positive, negative, or neutral",
  "sentiment_score": -1.0 to 1.0,
  "formality_score": 0.0 to 1.0,
  "confidence_score": 0.0 to 1.0,
  "emotions": ["emotion1", "emotion2"],
  "writing_style": "one of: conversational, academic, marketing, technical, journalistic, narrative",
  "suggestions": ["suggestion to improve tone if needed"]
}

Text:
${value.text}`;

  try {
    const result = await callClaude(prompt);
    logger.info({ primary_tone: (result as Record<string, unknown>)?.primary_tone }, 'Tone analyzed');
    res.json({ ...result as Record<string, unknown>, latency_ms: Date.now() - start, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    res.status(500).json({ error: 'Analysis failed', details: message });
  }
});

export default router;
