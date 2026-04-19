#!/bin/bash
set -e

echo "🚀 Setting up Dev Utilities API..."

mkdir -p src/routes

cat > package.json << 'ENDPACKAGE'
{
  "name": "dev-utilities-api",
  "version": "1.0.0",
  "description": "Fast, simple utility APIs for developers — URL metadata, email extraction, and text normalization.",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cheerio": "^1.0.0",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "joi": "^17.11.0",
    "franc": "^6.2.0"
  },
  "devDependencies": {
    "@types/compression": "^1.7.5",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.2"
  }
}
ENDPACKAGE

cat > tsconfig.json << 'ENDTSCONFIG'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
ENDTSCONFIG

cat > render.yaml << 'ENDRENDER'
services:
  - type: web
    name: dev-utilities-api
    env: node
    buildCommand: npm install && npm run build
    startCommand: node dist/index.js
    healthCheckPath: /v1/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
ENDRENDER

cat > .gitignore << 'ENDGITIGNORE'
node_modules/
dist/
.env
*.log
ENDGITIGNORE

cat > src/logger.ts << 'ENDLOGGER'
export const logger = {
  info: (obj: unknown, msg?: string) =>
    console.log(JSON.stringify({ level: 'info', ...(typeof obj === 'object' ? obj : { data: obj }), msg })),
  warn: (obj: unknown, msg?: string) =>
    console.warn(JSON.stringify({ level: 'warn', ...(typeof obj === 'object' ? obj : { data: obj }), msg })),
  error: (obj: unknown, msg?: string) =>
    console.error(JSON.stringify({ level: 'error', ...(typeof obj === 'object' ? obj : { data: obj }), msg })),
};
ENDLOGGER

cat > src/routes/urlMetadata.ts << 'ENDURLMETA'
import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  url: Joi.string().uri().required(),
});

router.post('/url-metadata', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  try {
    const response = await axios.get(value.url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DevUtilitiesBot/1.0)',
        'Accept': 'text/html',
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data as string);
    const domain = new URL(value.url).hostname;

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text().trim() ||
      '';

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    const favicon =
      $('link[rel="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href') ||
      `https://${domain}/favicon.ico`;

    const faviconUrl = favicon.startsWith('http') ? favicon : `https://${domain}${favicon.startsWith('/') ? '' : '/'}${favicon}`;

    logger.info({ url: value.url, ms: Date.now() - start }, 'URL metadata fetched');

    res.json({
      url: value.url,
      domain,
      title: title.slice(0, 300),
      description: description.slice(0, 500),
      image: image || null,
      favicon: faviconUrl,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch URL';
    logger.error({ url: value.url, err }, 'URL metadata failed');
    res.status(422).json({ error: 'Failed to fetch URL', details: message });
  }
});

export default router;
ENDURLMETA

cat > src/routes/emailExtractor.ts << 'ENDEMAIL'
import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  text: Joi.string().min(1).max(50000).required(),
});

function extractEmails(text: string): string[] {
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(regex) ?? [])];
}

function extractNames(text: string): string[] {
  const patterns = [
    /(?:from|by|regards|sincerely|hi|hello|dear)[,\s]+([A-Z][a-z]+ [A-Z][a-z]+)/gi,
    /^([A-Z][a-z]+ [A-Z][a-z]+)[\s,]/gm,
  ];
  const names = new Set<string>();
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) names.add(match[1].trim());
    }
  }
  return [...names].slice(0, 20);
}

function extractCompanies(text: string): string[] {
  const patterns = [
    /(?:at|from|with|@)\s+([A-Z][a-zA-Z0-9\s&.,-]{2,40}(?:Inc|LLC|Ltd|Corp|Co|Group|Technologies|Solutions|Labs|AI|Software|Systems)?)\b/g,
    /([A-Z][a-zA-Z0-9]{2,}(?:\s[A-Z][a-zA-Z0-9]{2,}){0,3})\s+(?:Inc|LLC|Ltd|Corp|Co\.?|Group|Technologies|Solutions|Labs)\b/g,
  ];
  const companies = new Set<string>();
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 2) companies.add(match[1].trim());
    }
  }
  return [...companies].slice(0, 20);
}

function extractPhones(text: string): string[] {
  const regex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s][0-9]{3}[-.\s][0-9]{4}/g;
  return [...new Set(text.match(regex) ?? [])].slice(0, 10);
}

function extractUrls(text: string): string[] {
  const regex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  return [...new Set(text.match(regex) ?? [])].slice(0, 10);
}

router.post('/email-extract', (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const text = value.text as string;

  const emails = extractEmails(text);
  const names = extractNames(text);
  const companies = extractCompanies(text);
  const phones = extractPhones(text);
  const urls = extractUrls(text);

  logger.info({ emails: emails.length, names: names.length, companies: companies.length }, 'Email extract complete');

  res.json({
    emails,
    names,
    companies,
    phones,
    urls,
    counts: {
      emails: emails.length,
      names: names.length,
      companies: companies.length,
      phones: phones.length,
      urls: urls.length,
    },
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

export default router;
ENDEMAIL

cat > src/routes/textClean.ts << 'ENDTEXTCLEAN'
import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  text: Joi.string().min(1).max(50000).required(),
  options: Joi.object({
    remove_html: Joi.boolean().default(true),
    remove_urls: Joi.boolean().default(false),
    remove_emails: Joi.boolean().default(false),
    normalize_whitespace: Joi.boolean().default(true),
    lowercase: Joi.boolean().default(false),
    remove_special_chars: Joi.boolean().default(false),
  }).default(),
});

function detectLanguage(text: string): string {
  const sample = text.slice(0, 500).toLowerCase();
  const patterns: Record<string, RegExp> = {
    en: /\b(the|and|is|in|it|of|to|a|that|for|on|with|as|at|be|this|was|are|or|an|but|not|have|from)\b/g,
    es: /\b(el|la|los|las|de|en|un|una|que|y|a|se|por|con|para|como|más|pero|su|al)\b/g,
    fr: /\b(le|la|les|de|un|une|des|en|et|est|à|il|je|que|pas|pour|vous|nous|dans)\b/g,
    de: /\b(der|die|das|den|dem|des|ein|eine|und|ist|in|von|mit|auf|für|an|zu|nicht)\b/g,
    pt: /\b(o|a|os|as|de|em|um|uma|que|e|é|do|da|para|com|não|uma|por|se|na)\b/g,
  };

  let best = 'unknown';
  let bestCount = 0;

  for (const [lang, pattern] of Object.entries(patterns)) {
    const matches = sample.match(pattern);
    const count = matches ? matches.length : 0;
    if (count > bestCount) {
      bestCount = count;
      best = lang;
    }
  }

  return bestCount >= 3 ? best : 'unknown';
}

function cleanText(text: string, options: Record<string, boolean>): string {
  let cleaned = text;

  if (options.remove_html) {
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    cleaned = cleaned.replace(/&[a-z]+;/gi, ' ');
  }

  if (options.remove_urls) {
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
  }

  if (options.remove_emails) {
    cleaned = cleaned.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  }

  if (options.normalize_whitespace) {
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
  }

  if (options.lowercase) {
    cleaned = cleaned.toLowerCase();
  }

  if (options.remove_special_chars) {
    cleaned = cleaned.replace(/[^a-zA-Z0-9\s.,!?;:'"()-]/g, '');
  }

  return cleaned.trim();
}

router.post('/text-clean', (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const original = value.text as string;
  const options = value.options as Record<string, boolean>;

  const cleaned = cleanText(original, options);
  const language = detectLanguage(cleaned);

  const stats = {
    original_length: original.length,
    cleaned_length: cleaned.length,
    chars_removed: original.length - cleaned.length,
    reduction_pct: parseFloat(((1 - cleaned.length / original.length) * 100).toFixed(1)),
  };

  logger.info({ language, stats }, 'Text clean complete');

  res.json({
    cleaned,
    language,
    stats,
    options_applied: options,
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

export default router;
ENDTEXTCLEAN

cat > src/routes/docs.ts << 'ENDDOCS'
import { Router, Request, Response } from 'express';
const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Dev Utilities API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; background: #0f0f0f; color: #e0e0e0; }
    h1 { color: #7c3aed; } h2 { color: #a78bfa; border-bottom: 1px solid #333; padding-bottom: 8px; }
    pre { background: #1a1a1a; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    code { color: #c084fc; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; margin-right: 8px; color: white; }
    .post { background: #7c3aed; } .get { background: #065f46; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 8px 12px; border: 1px solid #333; text-align: left; }
    th { background: #1a1a1a; }
  </style>
</head>
<body>
  <h1>Dev Utilities API</h1>
  <p>Fast, simple utility APIs for developers — URL metadata, email extraction, and text normalization.</p>
  <h2>Endpoints</h2>
  <table>
    <tr><th>Method</th><th>Path</th><th>Description</th></tr>
    <tr><td><span class="badge post">POST</span></td><td>/v1/url-metadata</td><td>Extract metadata from any URL</td></tr>
    <tr><td><span class="badge post">POST</span></td><td>/v1/email-extract</td><td>Extract emails, names, companies from text</td></tr>
    <tr><td><span class="badge post">POST</span></td><td>/v1/text-clean</td><td>Clean and normalize text with language detection</td></tr>
    <tr><td><span class="badge get">GET</span></td><td>/v1/health</td><td>Health check</td></tr>
  </table>

  <h2>URL Metadata</h2>
  <pre>POST /v1/url-metadata
{ "url": "https://stripe.com" }</pre>

  <h2>Email Extractor</h2>
  <pre>POST /v1/email-extract
{ "text": "Contact John Smith at john@stripe.com or visit https://stripe.com" }</pre>

  <h2>Text Clean</h2>
  <pre>POST /v1/text-clean
{
  "text": "&lt;p&gt;Hello   world!&lt;/p&gt;",
  "options": {
    "remove_html": true,
    "normalize_whitespace": true,
    "lowercase": false
  }
}</pre>
  <p><a href="/openapi.json" style="color:#a78bfa">OpenAPI JSON</a></p>
</body>
</html>`);
});

export default router;
ENDDOCS

cat > src/routes/openapi.ts << 'ENDOPENAPI'
import { Router, Request, Response } from 'express';
const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Dev Utilities API',
      version: '1.0.0',
      description: 'Fast, simple utility APIs for developers — URL metadata, email extraction, and text normalization.',
    },
    servers: [{ url: 'https://dev-utilities-api.onrender.com' }],
    paths: {
      '/v1/url-metadata': {
        post: {
          summary: 'Extract metadata from any URL',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } } } } },
          responses: { '200': { description: 'URL metadata' } },
        },
      },
      '/v1/email-extract': {
        post: {
          summary: 'Extract emails, names, companies from text',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } } },
          responses: { '200': { description: 'Extracted contacts' } },
        },
      },
      '/v1/text-clean': {
        post: {
          summary: 'Clean and normalize text with language detection',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, options: { type: 'object' } } } } } },
          responses: { '200': { description: 'Cleaned text with stats' } },
        },
      },
      '/v1/health': {
        get: { summary: 'Health check', responses: { '200': { description: 'OK' } } },
      },
    },
  });
});

export default router;
ENDOPENAPI

cat > src/index.ts << 'ENDINDEX'
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { logger } from './logger';
import urlMetadataRouter from './routes/urlMetadata';
import emailExtractorRouter from './routes/emailExtractor';
import textCleanRouter from './routes/textClean';
import docsRouter from './routes/docs';
import openapiRouter from './routes/openapi';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

app.get('/', (_req, res) => {
  res.json({
    service: 'dev-utilities-api',
    version: '1.0.0',
    description: 'Fast, simple utility APIs for developers.',
    status: 'ok',
    docs: '/docs',
    health: '/v1/health',
    endpoints: {
      url_metadata: 'POST /v1/url-metadata',
      email_extract: 'POST /v1/email-extract',
      text_clean: 'POST /v1/text-clean',
    },
  });
});

app.get('/v1/health', (_req, res) => {
  res.json({ status: 'ok', service: 'dev-utilities-api', timestamp: new Date().toISOString() });
});

app.use('/v1', urlMetadataRouter);
app.use('/v1', emailExtractorRouter);
app.use('/v1', textCleanRouter);
app.use('/docs', docsRouter);
app.use('/openapi.json', openapiRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Dev Utilities API running');
});
ENDINDEX

echo "✅ All files created!"
echo "Next: npm install && npm run dev"