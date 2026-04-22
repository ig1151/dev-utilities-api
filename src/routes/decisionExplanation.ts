import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  decision: Joi.string().min(3).max(500).required(),
  context: Joi.string().max(500).optional(),
  domain: Joi.string().valid('finance', 'crypto', 'business', 'general').default('general'),
});

async function callClaude(prompt: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 20000,
    }
  );
  const text = res.data.content[0]?.text ?? '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

router.post('/decision-explain', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();

  const prompt = `You are a decision analysis expert. Explain this decision clearly and structurally.

Decision: ${value.decision}
${value.context ? `Context: ${value.context}` : ''}
Domain: ${value.domain}

Return ONLY a valid JSON object:
{
  "summary": "one sentence explanation of what this decision means",
  "reasoning": ["reason 1", "reason 2", "reason 3"],
  "supporting_factors": ["factor that supports this decision"],
  "risk_factors": ["risk or downside to consider"],
  "alternatives": ["alternative decision that could have been made"],
  "confidence": 0.0 to 1.0,
  "verdict": "one of: strong_buy, buy, hold, sell, strong_sell, proceed, caution, avoid (pick most relevant)",
  "time_horizon": "immediate, short_term, medium_term, or long_term",
  "key_assumption": "the main assumption this decision relies on"
}`;

  try {
    const result = await callClaude(prompt) as Record<string, unknown>;
    logger.info({ decision: value.decision, domain: value.domain, verdict: result?.verdict }, 'Decision explanation complete');
    res.json({
      decision: value.decision,
      domain: value.domain,
      ...result,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Explanation failed';
    logger.error({ decision: value.decision, err }, 'Decision explanation failed');
    res.status(500).json({ error: 'Explanation failed', details: message });
  }
});

export default router;
