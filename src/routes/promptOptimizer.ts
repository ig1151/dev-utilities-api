import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  prompt: Joi.string().min(10).max(5000).required(),
  goal: Joi.string().max(200).optional(),
  model: Joi.string().valid('claude', 'gpt', 'general').default('general'),
});

async function callClaude(prompt: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] },
    { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 }
  );
  const text = res.data.content[0]?.text ?? '{}';
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch { return null; }
}

router.post('/prompt-optimize', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const prompt = `You are an expert prompt engineer. Analyze and improve this prompt.

Original prompt: "${value.prompt}"
${value.goal ? `Goal: ${value.goal}` : ''}
Target model: ${value.model}

Return ONLY valid JSON:
{
  "optimized_prompt": "the improved prompt",
  "improvements": ["specific improvement made"],
  "issues_found": ["issue with original prompt"],
  "clarity_score_before": 0-100,
  "clarity_score_after": 0-100,
  "techniques_applied": ["technique used e.g. role assignment, few-shot, chain of thought"],
  "estimated_quality_gain": "low, medium, or high"
}`;

  try {
    const result = await callClaude(prompt);
    logger.info({ model: value.model, quality_gain: (result as Record<string, unknown>)?.estimated_quality_gain }, 'Prompt optimized');
    res.json({ original_prompt: value.prompt, ...result as Record<string, unknown>, latency_ms: Date.now() - start, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Optimization failed';
    res.status(500).json({ error: 'Optimization failed', details: message });
  }
});

export default router;
