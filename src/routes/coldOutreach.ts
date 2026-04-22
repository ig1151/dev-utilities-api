import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  company: Joi.string().min(1).max(200).required(),
  contact_role: Joi.string().min(1).max(100).required(),
  goal: Joi.string().min(5).max(300).required(),
  sender_name: Joi.string().max(100).optional(),
  sender_company: Joi.string().max(100).optional(),
  tone: Joi.string().valid('professional', 'casual', 'direct').default('professional'),
  channel: Joi.string().valid('email', 'linkedin').default('email'),
});

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
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

router.post('/cold-outreach', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const isEmail = value.channel === 'email';

  const prompt = `You are an expert B2B copywriter. Write a ${value.tone} cold outreach ${value.channel} message.

Target company: ${value.company}
Target role: ${value.contact_role}
Goal: ${value.goal}
${value.sender_name ? `Sender name: ${value.sender_name}` : ''}
${value.sender_company ? `Sender company: ${value.sender_company}` : ''}
Channel: ${value.channel}

Rules:
- ${isEmail ? 'Max 100 words for the body' : 'Max 300 characters for LinkedIn'}
- Be specific to the company and role
- Focus on value, not features
- Include a clear call to action
- Do NOT use generic phrases like "I hope this finds you well"

Return ONLY a valid JSON object:
${isEmail ? `{
  "subject": "email subject line",
  "body": "email body",
  "cta": "the call to action",
  "word_count": number
}` : `{
  "message": "linkedin message",
  "cta": "the call to action",
  "char_count": number
}`}`;

  try {
    const raw = await callClaude(prompt);
    const parsed = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, '').trim());
    logger.info({ company: value.company, channel: value.channel, tone: value.tone }, 'Cold outreach generated');
    res.json({
      company: value.company,
      contact_role: value.contact_role,
      goal: value.goal,
      channel: value.channel,
      tone: value.tone,
      ...parsed,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    logger.error({ company: value.company, err }, 'Cold outreach failed');
    res.status(500).json({ error: 'Generation failed', details: message });
  }
});

export default router;
