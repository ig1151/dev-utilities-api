import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  domain: Joi.string().min(3).max(253).required(),
});

const TECH_SIGNATURES: Record<string, string[]> = {
  react: ['react', '_next', '__NEXT_DATA__', 'react-root'],
  nextjs: ['__NEXT_DATA__', '_next/static'],
  vue: ['vue', '__vue'],
  angular: ['ng-version', 'angular'],
  wordpress: ['wp-content', 'wp-includes', 'wordpress'],
  shopify: ['shopify', 'cdn.shopify.com', 'Shopify.theme'],
  stripe: ['stripe.com/v3', 'js.stripe.com'],
  intercom: ['intercom', 'widget.intercom.io'],
  hubspot: ['hubspot', 'hs-scripts.com'],
  gtm: ['googletagmanager.com', 'gtm.js'],
  ga: ['google-analytics.com', 'gtag/js'],
  cloudflare: ['cloudflare', '__cf_bm'],
  vercel: ['vercel', '_vercel'],
  aws: ['amazonaws.com', 'cloudfront.net'],
};

const CATEGORY_PATTERNS: Record<string, RegExp> = {
  fintech: /payment|finance|banking|invest|crypto|wallet|trading|financial/i,
  ecommerce: /shop|store|commerce|cart|checkout|product|buy|sell/i,
  saas: /dashboard|software|platform|solution|tool|app|service|api/i,
  media: /news|blog|magazine|media|article|content|publish/i,
  healthcare: /health|medical|doctor|patient|clinic|hospital/i,
  education: /learn|course|education|school|university|training/i,
  devtools: /developer|api|sdk|code|github|deploy|cloud|infra/i,
  marketing: /marketing|seo|ads|campaign|analytics|growth/i,
};

function detectCategory(text: string): string {
  for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (pattern.test(text)) return category;
  }
  return 'general';
}

function detectTechStack(html: string): string[] {
  const stack: string[] = [];
  for (const [tech, signatures] of Object.entries(TECH_SIGNATURES)) {
    if (signatures.some(sig => html.includes(sig))) {
      stack.push(tech);
    }
  }
  return stack;
}

function assessRisk(domain: string, html: string, statusCode: number): { level: string; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const suspiciousTlds = ['.xyz', '.top', '.click', '.loan', '.work', '.date', '.gq', '.tk', '.ml', '.cf'];
  if (suspiciousTlds.some(tld => domain.endsWith(tld))) {
    score += 30;
    reasons.push('Suspicious TLD');
  }

  if (domain.length > 30) { score += 10; reasons.push('Unusually long domain'); }
  if ((domain.match(/-/g) ?? []).length > 3) { score += 15; reasons.push('Multiple hyphens in domain'); }
  if (/\d{4,}/.test(domain)) { score += 10; reasons.push('Long numeric sequence in domain'); }
  if (statusCode >= 400) { score += 25; reasons.push('Domain returned error status'); }
  if (html.length < 500) { score += 15; reasons.push('Very thin page content'); }

  const phishingKeywords = /login|verify|account|secure|update|confirm|suspended/i;
  if (phishingKeywords.test(domain)) { score += 20; reasons.push('Phishing-related keywords in domain'); }

  const level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { level, score, reasons };
}

function isSaas(text: string, techStack: string[]): boolean {
  const saasKeywords = /pricing|subscription|free trial|sign up|dashboard|per month|per user|plan|upgrade/i;
  return saasKeywords.test(text) || techStack.includes('react') || techStack.includes('nextjs');
}

router.post('/domain-intelligence', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  let domain = value.domain as string;
  domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const url = `https://${domain}`;

  try {
    let html = '';
    let statusCode = 200;
    let title = '';
    let description = '';

    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DomainIntelBot/1.0)',
          'Accept': 'text/html',
        },
        maxRedirects: 5,
      });
      html = response.data as string;
      statusCode = response.status;

      const $ = cheerio.load(html);
      title = $('title').text().trim();
      description =
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        '';
    } catch (fetchErr) {
      statusCode = 404;
    }

    const fullText = `${domain} ${title} ${description} ${html.slice(0, 5000)}`;
    const techStack = detectTechStack(html);
    const category = detectCategory(fullText);
    const risk = assessRisk(domain, html, statusCode);
    const saas = isSaas(fullText, techStack);

    const tld = domain.split('.').pop() ?? '';
    const registrar_hint = tld === 'io' ? 'tech/startup' : tld === 'com' ? 'commercial' : tld === 'org' ? 'nonprofit' : tld === 'edu' ? 'education' : tld;

    logger.info({ domain, category, risk: risk.level, saas }, 'Domain intelligence complete');

    res.json({
      domain,
      title: title.slice(0, 200) || null,
      description: description.slice(0, 300) || null,
      category,
      is_saas: saas,
      tech_stack: techStack,
      risk: {
        level: risk.level,
        score: risk.score,
        reasons: risk.reasons,
      },
      tld,
      registrar_hint,
      reachable: statusCode < 400,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ domain, err }, 'Domain intelligence failed');
    res.status(422).json({ error: 'Failed to analyze domain', details: message });
  }
});

export default router;
