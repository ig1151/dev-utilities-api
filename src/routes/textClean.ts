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
