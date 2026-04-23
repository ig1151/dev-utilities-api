import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  text: Joi.string().min(50).max(20000).required(),
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

router.post('/job-analyze', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const prompt = `Analyze this job description and extract structured information.

Return ONLY valid JSON:
{
  "title": "job title",
  "company": "company name if mentioned",
  "location": "location or Remote",
  "employment_type": "full_time, part_time, contract, or freelance",
  "experience_level": "junior, mid, senior, or lead",
  "years_experience": "e.g. 3-5 or null",
  "salary_range": { "min": number or null, "max": number or null, "currency": "USD" },
  "required_skills": ["skill1", "skill2"],
  "nice_to_have_skills": ["skill1"],
  "responsibilities": ["responsibility1"],
  "benefits": ["benefit1"],
  "tech_stack": ["technology1"],
  "remote_friendly": true or false,
  "visa_sponsorship": true or false or null,
  "seniority_score": 0-100,
  "difficulty_score": 0-100
}

Job description:
${value.text.slice(0, 8000)}`;

  try {
    const result = await callClaude(prompt);
    logger.info({ title: (result as Record<string, unknown>)?.title }, 'Job description analyzed');
    res.json({ ...result as Record<string, unknown>, latency_ms: Date.now() - start, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    res.status(500).json({ error: 'Analysis failed', details: message });
  }
});

export default router;
