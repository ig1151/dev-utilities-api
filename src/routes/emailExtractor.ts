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
