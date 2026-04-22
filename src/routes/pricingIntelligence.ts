import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  company: Joi.string().min(1).max(200).required(),
  domain: Joi.string().max(253).optional(),
});

const USER_AGENT = 'Mozilla/5.0 (compatible; PricingBot/1.0)';

async function callClaude(prompt: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 30000,
    }
  );
  const text = res.data.content[0]?.text ?? '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

async function fetchPricingPage(domain: string): Promise<string> {
  const paths = ['/pricing', '/plans', '/pricing-plans', '/price', '/buy'];
  for (const path of paths) {
    try {
      const res = await axios.get(`https://${domain}${path}`, {
        timeout: 8000,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        maxRedirects: 3,
      });
      const $ = cheerio.load(res.data as string);
      $('script, style, nav, footer, header').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
      if (text.length > 500) return text;
    } catch {
      continue;
    }
  }
  return '';
}

async function tavilyPricingSearch(company: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return '';
  try {
    const res = await axios.post(
      'https://api.tavily.com/search',
      { query: `${company} pricing plans tiers cost`, max_results: 5, search_depth: 'basic' },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return (res.data.results ?? [])
      .map((r: { title: string; content?: string }) => r.title + ' ' + (r.content ?? ''))
      .join(' ')
      .slice(0, 6000);
  } catch {
    return '';
  }
}

router.post('/pricing-intelligence', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const company = value.company as string;
  const domain = value.domain
    ? (value.domain as string).replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    : company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';

  try {
    const [pageContent, searchContent] = await Promise.all([
      fetchPricingPage(domain),
      tavilyPricingSearch(company),
    ]);

    const content = (pageContent + ' ' + searchContent).slice(0, 10000);

    if (content.length < 100) {
      res.status(422).json({ error: 'Could not find pricing information for this company' });
      return;
    }

    const result = await callClaude(`You are a pricing intelligence analyst. Extract pricing information for ${company} from the content below.

Return ONLY a valid JSON object with exactly these fields:
{
  "pricing_model": "one of: free, freemium, usage_based, subscription, per_seat, flat_rate, custom, hybrid",
  "positioning": "one of: budget, mid_market, premium, enterprise",
  "has_free_tier": true or false,
  "has_free_trial": true or false,
  "tiers": [
    {
      "name": "tier name",
      "price": "price as string e.g. $29/mo or null if custom",
      "billing": "monthly or annual or per_call or null",
      "key_features": ["feature1", "feature2"],
      "target": "who this tier is for"
    }
  ],
  "price_range": {
    "min": "lowest public price or null",
    "max": "highest public price or Free if applies"
  },
  "custom_pricing": true or false,
  "key_differentiators": ["what makes their pricing unique"],
  "competitors_mentioned": ["any competitors mentioned"],
  "confidence": 0.0 to 1.0
}

Content:
${content}`);

    logger.info({ company, domain, model: (result as Record<string, unknown>)?.pricing_model }, 'Pricing intelligence complete');

    res.json({
      company,
      domain,
      ...(result as Record<string, unknown>),
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    logger.error({ company, err }, 'Pricing intelligence failed');
    res.status(500).json({ error: 'Analysis failed', details: message });
  }
});

export default router;
