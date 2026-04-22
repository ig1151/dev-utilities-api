import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  task: Joi.string().min(3).max(500).required(),
  workflow: Joi.string().optional(),
  budget: Joi.number().positive().optional(),
});

const KNOWN_COSTS: Record<string, { cost: number; description: string }> = {
  web_search: { cost: 0.002, description: 'Tavily search query' },
  page_fetch: { cost: 0.001, description: 'Fetch and parse a web page' },
  ai_extraction: { cost: 0.005, description: 'Claude AI extraction call' },
  ai_summarize: { cost: 0.003, description: 'Claude AI summarization' },
  ai_analysis: { cost: 0.008, description: 'Claude AI analysis' },
  ai_generation: { cost: 0.005, description: 'Claude AI content generation' },
  lead_discovery: { cost: 0.05, description: 'Full lead discovery workflow' },
  company_research: { cost: 0.08, description: 'Deep company research' },
  email_validation: { cost: 0.001, description: 'Email format validation' },
  domain_check: { cost: 0.002, description: 'Domain intelligence lookup' },
  strategy_execution: { cost: 0.10, description: 'Full strategy execution' },
  market_signal: { cost: 0.02, description: 'Market signal analysis' },
  workflow_orchestration: { cost: 0.15, description: 'Agent workflow orchestration' },
};

async function callClaude(prompt: string): Promise<unknown> {
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
  const text = res.data.content[0]?.text ?? '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

router.post('/task-cost', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const knownStepNames = Object.keys(KNOWN_COSTS).join(', ');

  const prompt = `You are an AI task cost estimator. Estimate the cost to complete this task using AI APIs.

Task: ${value.task}
${value.workflow ? `Workflow type: ${value.workflow}` : ''}

Available step types and their costs (USD):
${Object.entries(KNOWN_COSTS).map(([k, v]) => `${k}: $${v.cost} — ${v.description}`).join('\n')}

Return ONLY a valid JSON object:
{
  "steps": [
    {
      "step": "step name from known types: ${knownStepNames}",
      "description": "what this step does",
      "cost": cost as number,
      "required": true or false
    }
  ],
  "estimated_cost": total cost as number,
  "min_cost": minimum possible cost,
  "max_cost": maximum possible cost,
  "complexity": "simple, moderate, or complex",
  "estimated_api_calls": number,
  "cost_drivers": ["main things driving the cost"],
  "optimization_tips": ["how to reduce cost"]
}`;

  try {
    const result = await callClaude(prompt) as Record<string, unknown>;

    const withinBudget = value.budget
      ? (result?.estimated_cost as number) <= value.budget
      : null;

    logger.info({ task: value.task, estimated_cost: result?.estimated_cost }, 'Task cost estimation complete');

    res.json({
      task: value.task,
      ...result,
      within_budget: withinBudget,
      budget: value.budget ?? null,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Estimation failed';
    logger.error({ task: value.task, err }, 'Task cost estimation failed');
    res.status(500).json({ error: 'Estimation failed', details: message });
  }
});

export default router;
