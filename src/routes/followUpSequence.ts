import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  company: Joi.string().min(1).max(200).required(),
  contact_role: Joi.string().min(1).max(100).required(),
  goal: Joi.string().min(5).max(300).required(),
  initial_email: Joi.string().max(2000).optional(),
  num_follow_ups: Joi.number().integer().min(1).max(5).default(3),
  days_between: Joi.number().integer().min(1).max(14).default(3),
  tone: Joi.string().valid('professional', 'casual', 'direct').default('professional'),
});

async function callClaude(prompt: string): Promise<unknown> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
  });
  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
  const data = await response.json() as { choices: { message: { content: string } }[] };
  const text = data.choices[0].message.content ?? '[]';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return Array.isArray(parsed) ? parsed : (parsed.emails ?? parsed.follow_ups ?? parsed.sequence ?? []);
  } catch { return null; }
}

router.post('/follow-up-sequence', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const prompt = `You are a B2B sales expert. Write a ${value.num_follow_ups}-email follow-up sequence.

Company: ${value.company}
Contact role: ${value.contact_role}
Goal: ${value.goal}
Tone: ${value.tone}
Days between emails: ${value.days_between}
${value.initial_email ? `Initial email sent: ${value.initial_email}` : ''}

Return ONLY a valid JSON object with a "sequence" array of follow-up emails:
{
  "sequence": [
    {
      "email_number": 1,
      "send_day": ${value.days_between},
      "subject": "subject line",
      "body": "email body under 80 words",
      "angle": "the approach angle e.g. value add, social proof, urgency, breakup"
    }
  ]
}

Rules:
- Each email must have a different angle
- Never repeat the same opening
- Get shorter and more direct with each follow-up
- Last email should be a polite breakup email`;

  try {
    const result = await callClaude(prompt) as unknown[];
    logger.info({ company: value.company, num_follow_ups: value.num_follow_ups }, 'Follow-up sequence generated');
    res.json({
      company: value.company,
      contact_role: value.contact_role,
      goal: value.goal,
      sequence: result ?? [],
      total_emails: (result ?? []).length,
      total_days: value.num_follow_ups * value.days_between,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    res.status(500).json({ error: 'Generation failed', details: message });
  }
});

export default router;
