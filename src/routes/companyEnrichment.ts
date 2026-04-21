import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  company: Joi.string().min(1).max(200).optional(),
  domain: Joi.string().min(3).max(253).optional(),
}).or('company', 'domain');

const TECH_SIGNATURES: Record<string, string[]> = {
  react: ['react', '_next', '__NEXT_DATA__'],
  nextjs: ['__NEXT_DATA__', '_next/static'],
  vue: ['vue.js', '__vue'],
  angular: ['ng-version', 'angular.js'],
  wordpress: ['wp-content', 'wp-includes'],
  shopify: ['cdn.shopify.com', 'Shopify.theme'],
  hubspot: ['hubspot', 'hs-scripts.com'],
  intercom: ['widget.intercom.io'],
  salesforce: ['salesforce', 'force.com'],
  stripe: ['js.stripe.com'],
  gtm: ['googletagmanager.com'],
  cloudflare: ['cloudflare', '__cf_bm'],
  vercel: ['_vercel', 'vercel.app'],
  aws: ['amazonaws.com', 'cloudfront.net'],
};

const INDUSTRY_PATTERNS: Record<string, RegExp> = {
  fintech: /payment|finance|banking|invest|crypto|wallet|trading|financial/i,
  ecommerce: /shop|store|commerce|cart|checkout|product|buy|sell/i,
  saas: /dashboard|software|platform|solution|tool|app|service/i,
  media: /news|blog|magazine|media|article|content|publish/i,
  healthcare: /health|medical|doctor|patient|clinic|hospital/i,
  education: /learn|course|education|school|university|training/i,
  devtools: /developer|api|sdk|code|deploy|cloud|infrastructure/i,
  marketing: /marketing|seo|ads|campaign|analytics|growth/i,
  security: /security|cyber|threat|protect|firewall|compliance/i,
  hr: /hiring|recruitment|talent|hr|human resources|payroll/i,
};

function detectIndustry(text: string): string {
  for (const [industry, pattern] of Object.entries(INDUSTRY_PATTERNS)) {
    if (pattern.test(text)) return industry;
  }
  return 'general';
}

function detectSize(text: string): string | null {
  const patterns = [
    { pattern: /(\d+,\d+|\d+)\s*(?:\+)?\s*employees/i, extract: (m: RegExpMatchArray) => m[1] },
    { pattern: /team\s+of\s+(\d+)/i, extract: (m: RegExpMatchArray) => m[1] },
    { pattern: /(\d+)\s*people/i, extract: (m: RegExpMatchArray) => m[1] },
  ];
  for (const { pattern, extract } of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(extract(match).replace(',', ''));
      if (num < 10) return '1-10';
      if (num < 50) return '11-50';
      if (num < 200) return '51-200';
      if (num < 500) return '201-500';
      if (num < 1000) return '501-1000';
      if (num < 5000) return '1001-5000';
      return '5000+';
    }
  }
  return null;
}

function detectFounded(text: string): string | null {
  const match = text.match(/(?:founded|established|since|incorporated)\s+(?:in\s+)?(\d{4})/i);
  return match ? match[1] : null;
}

function detectType(text: string, domain: string): string {
  if (/\.gov|government|federal|municipal/i.test(text + domain)) return 'Government';
  if (/\.edu|university|college|school/i.test(text + domain)) return 'Education';
  if (/nonprofit|non-profit|\.org|501\(c\)/i.test(text + domain)) return 'Nonprofit';
  if (/nasdaq|nyse|public company|stock|ticker/i.test(text)) return 'Public';
  return 'Private';
}

router.post('/company-enrichment', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  let domain = value.domain as string | undefined;
  if (domain) domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const company = value.company as string | undefined;

  try {
    let html = '';
    let title = '';
    let description = '';
    let resolvedDomain = domain;

    if (domain) {
      try {
        const res2 = await axios.get(`https://${domain}`, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnrichmentBot/1.0)', 'Accept': 'text/html' },
          maxRedirects: 5,
        });
        html = res2.data as string;
        const $ = cheerio.load(html);
        title = $('title').text().trim();
        description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
      } catch { /* Domain unreachable */ }
    } else if (company) {
      const guessed = company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
      try {
        const res2 = await axios.get(`https://${guessed}`, {
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnrichmentBot/1.0)', 'Accept': 'text/html' },
          maxRedirects: 5,
        });
        html = res2.data as string;
        resolvedDomain = guessed;
        const $ = cheerio.load(html);
        title = $('title').text().trim();
        description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
      } catch { /* Could not resolve domain */ }
    }

    const fullText = `${company ?? ''} ${resolvedDomain ?? ''} ${title} ${description} ${html.slice(0, 5000)}`;
    const techStack = Object.entries(TECH_SIGNATURES)
      .filter(([, sigs]) => sigs.some(sig => html.includes(sig)))
      .map(([tech]) => tech);

    const industry = detectIndustry(fullText);
    const size = detectSize(fullText);
    const founded = detectFounded(fullText);
    const type = detectType(fullText, resolvedDomain ?? '');
    const linkedin = resolvedDomain
      ? `linkedin.com/company/${resolvedDomain.split('.')[0]}`
      : company
      ? `linkedin.com/company/${company.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
      : null;

    logger.info({ company, domain: resolvedDomain, industry }, 'Company enrichment complete');

    res.json({
      company: company ?? title.split('|')[0].trim() ?? resolvedDomain,
      domain: resolvedDomain ?? null,
      industry,
      type,
      size,
      founded,
      headquarters: null,
      description: description.slice(0, 300) || null,
      linkedin,
      tech_stack: techStack,
      reachable: html.length > 0,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Enrichment failed';
    logger.error({ company, domain, err }, 'Company enrichment failed');
    res.status(422).json({ error: 'Enrichment failed', details: message });
  }
});

export default router;
