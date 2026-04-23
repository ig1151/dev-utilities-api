import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  password: Joi.string().min(1).max(200).required(),
});

const COMMON_PASSWORDS = ['password', '123456', 'password123', 'admin', 'letmein', 'qwerty', 'abc123', 'monkey', 'master', 'dragon', 'pass', 'test', 'welcome', 'login', 'passw0rd'];

function scorePassword(password: string): { score: number; strength: string; issues: string[]; suggestions: string[]; entropy: number } {
  let score = 0;
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (password.length >= 8) score += 10;
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;
  if (password.length < 8) { issues.push('Too short — minimum 8 characters'); suggestions.push('Use at least 12 characters'); }

  if (/[a-z]/.test(password)) score += 10; else { issues.push('No lowercase letters'); suggestions.push('Add lowercase letters'); }
  if (/[A-Z]/.test(password)) score += 10; else { issues.push('No uppercase letters'); suggestions.push('Add uppercase letters'); }
  if (/[0-9]/.test(password)) score += 10; else { issues.push('No numbers'); suggestions.push('Add numbers'); }
  if (/[^a-zA-Z0-9]/.test(password)) score += 20; else { issues.push('No special characters'); suggestions.push('Add special characters like !@#$%'); }

  if (/(.)\1{2,}/.test(password)) { score -= 10; issues.push('Repeated characters detected'); }
  if (/^[a-zA-Z]+$/.test(password)) { score -= 5; issues.push('Letters only'); }
  if (/^[0-9]+$/.test(password)) { score -= 10; issues.push('Numbers only'); }
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) { score = 5; issues.push('This is a commonly used password'); suggestions.push('Choose a unique password'); }

  score = Math.max(0, Math.min(100, score));

  let strength = 'very_weak';
  if (score >= 80) strength = 'very_strong';
  else if (score >= 60) strength = 'strong';
  else if (score >= 40) strength = 'moderate';
  else if (score >= 20) strength = 'weak';

  const charsetSize = (/[a-z]/.test(password) ? 26 : 0) + (/[A-Z]/.test(password) ? 26 : 0) + (/[0-9]/.test(password) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(password) ? 32 : 0);
  const entropy = Math.round(password.length * Math.log2(Math.max(charsetSize, 1)) * 10) / 10;

  return { score, strength, issues, suggestions, entropy };
}

router.post('/password-strength', (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const result = scorePassword(value.password);
  logger.info({ strength: result.strength, score: result.score }, 'Password scored');
  res.json({ ...result, latency_ms: Date.now() - start, timestamp: new Date().toISOString() });
});

export default router;
