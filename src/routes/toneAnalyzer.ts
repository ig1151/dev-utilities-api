import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  text: Joi.string().min(10).max(10000).required(),
});

async function callClaude(prompt: string): Promise<unknown> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
  });
  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
  const data = await response.json() as { choices: { message: { content: string } }[] };
  const text = data.choices[0].message.content ?? '{}';
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
