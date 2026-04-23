import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  goal: Joi.string().min(5).max(500).required(),
  optimize_for: Joi.string().valid('cost', 'speed', 'quality').default('cost'),
  budget: Joi.number().positive().optional(),
});

const YOUR_APIS = [
  { name: 'Lead Discovery', endpoint: '/v1/leads/find', base_url: 'lead-discovery-api-xdmf.onrender.com', cost: 0.05, capability: 'find companies and contacts' },
  { name: 'Company Research', endpoint: '/v1/research/company', base_url: 'company-research-api-mwq4.onrender.com', cost: 0.08, capability: 'deep company intelligence' },
  { name: 'Who To Contact', endpoint: '/v1/who-to-contact', base_url: 'dev-utilities-api.onrender.com', cost: 0.02, capability: 'identify best contact at a company' },
  { name: 'Cold Outreach Generator', endpoint: '/v1/cold-outreach', base_url: 'dev-utilities-api.onrender.com', cost: 0.02, capability: 'generate personalized outreach emails' },
  { name: 'Browser Task', endpoint: '/v1/browser-task', base_url: 'browser-task-api.onrender.com', cost: 0.05, capability: 'search and extract web data' },
  { name: 'Extraction API', endpoint: '/v1/extract/lead', base_url: 'extraction-api-nze4.onrender.com', cost: 0.05, capability: 'extract structured data from text' },
  { name: 'Agent Workflow', endpoint: '/v1/workflow/run', base_url: 'agent-workflow-api.onrender.com', cost: 0.15, capability: 'run goal-driven workflows' },
  { name: 'Market Decision', endpoint: '/v1/decide', base_url: 'market-signal-api-iu2o.onrender.com', cost: 0.02, capability: 'crypto market signals and decisions' },
  { name: 'Strategy Execution', endpoint: '/v1/strategy/execute', base_url: 'strategy-execution-api.onrender.com', cost: 0.10, capability: 'execute trading strategies' },
  { name: 'Pricing Intelligence', endpoint: '/v1/pricing-intelligence', base_url: 'dev-utilities-api.onrender.com', cost: 0.05, capability: 'extract company pricing data' },
  { name: 'Domain Intelligence', endpoint: '/v1/domain-intelligence', base_url: 'dev-utilities-api.onrender.com', cost: 0.005, capability: 'analyze domain risk and tech stack' },
  { name: 'Company Enrichment', endpoint: '/v1/company-enrichment', base_url: 'dev-utilities-api.onrender.com', cost: 0.005, capability: 'enrich company data from domain' },
];

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

router.post('/plan', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const apiList = YOUR_APIS.map(a => `${a.name} (${a.endpoint}) — $${a.cost}/call — ${a.capability}`).join('\n');

  const prompt = `You are an AI execution planner. Plan the optimal steps to achieve this goal.

Goal: ${value.goal}
Optimize for: ${value.optimize_for}
${value.budget ? `Budget: $${value.budget}` : ''}

Available APIs:
${apiList}

Return ONLY valid JSON:
{
  "steps": ["step1", "step2", "step3"],
  "api_calls": [
    { "step": "step name", "api": "endpoint path", "base_url": "base url", "cost": cost as number, "reason": "why this API" }
  ],
  "estimated_cost": total as number,
  "recommended_path": "optimized, fast, or thorough",
  "confidence": 0.0 to 1.0,
  "alternatives": [{ "path": "alternative approach", "cost": number, "tradeoff": "what you gain or lose" }],
  "warnings": ["any warnings about the plan"]
}`;

  try {
    const result = await callClaude(prompt) as Record<string, unknown>;
    const withinBudget = value.budget ? (result?.estimated_cost as number) <= value.budget : null;
    logger.info({ goal: value.goal, estimated_cost: result?.estimated_cost }, 'Execution plan complete');
    res.json({ goal: value.goal, optimize_for: value.optimize_for, ...result, within_budget: withinBudget, budget: value.budget ?? null, latency_ms: Date.now() - start, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Planning failed';
    res.status(500).json({ error: 'Planning failed', details: message });
  }
});

export default router;
