import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  company: Joi.string().min(1).max(200).required(),
  goal: Joi.string().min(5).max(300).required(),
});

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
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
  return res.data.content[0]?.text ?? '{}';
}

router.post('/who-to-contact', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();

  const prompt = `You are a B2B sales expert. Given this company and sales goal, identify the best person to contact.

Company: ${value.company}
Goal: ${value.goal}

Return ONLY a valid JSON object with exactly this structure:
{
  "best_contact": {
    "role": "exact job title",
    "reason": "why this person owns this decision",
    "department": "department name"
  },
  "secondary_contacts": ["role1", "role2", "role3"],
  "avoid": ["role that would be wrong to contact"],
  "approach": "one sentence on how to approach this person",
  "confidence": 0.0 to 1.0
}`;

  try {
    const raw = await callClaude(prompt);
    const parsed = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, '').trim());
    logger.info({ company: value.company, goal: value.goal, role: parsed.best_contact?.role }, 'Who to contact complete');
    res.json({
      company: value.company,
      goal: value.goal,
      ...parsed,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    logger.error({ company: value.company, err }, 'Who to contact failed');
    res.status(500).json({ error: 'Analysis failed', details: message });
  }
});

export default router;
