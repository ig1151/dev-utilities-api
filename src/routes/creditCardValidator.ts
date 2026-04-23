import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  card_number: Joi.string().min(13).max(19).required(),
  expiry_month: Joi.number().integer().min(1).max(12).optional(),
  expiry_year: Joi.number().integer().min(2024).max(2040).optional(),
  cvv: Joi.string().min(3).max(4).optional(),
});

function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '').split('').reverse().map(Number);
  const sum = digits.reduce((acc, digit, i) => {
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    return acc + digit;
  }, 0);
  return sum % 10 === 0;
}

function detectCardType(num: string): string {
  const n = num.replace(/\D/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^6(?:011|5)/.test(n)) return 'discover';
  if (/^35/.test(n)) return 'jcb';
  if (/^3(?:0[0-5]|[68])/.test(n)) return 'diners';
  return 'unknown';
}

function maskCard(num: string): string {
  const n = num.replace(/\D/g, '');
  return n.slice(0, 4) + ' **** **** ' + n.slice(-4);
}

router.post('/card-validate', (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const clean = value.card_number.replace(/\D/g, '');
  const luhnValid = luhnCheck(clean);
  const cardType = detectCardType(clean);
  const masked = maskCard(clean);

  let expiryValid: boolean | null = null;
  if (value.expiry_month && value.expiry_year) {
    const now = new Date();
    const expiry = new Date(value.expiry_year, value.expiry_month - 1);
    expiryValid = expiry >= now;
  }

  const cvvValid = value.cvv
    ? (cardType === 'amex' ? value.cvv.length === 4 : value.cvv.length === 3)
    : null;

  const valid = luhnValid && (expiryValid !== false) && (cvvValid !== false);

  logger.info({ cardType, valid }, 'Card validated');
  res.json({
    valid,
    card_type: cardType,
    masked,
    luhn_valid: luhnValid,
    expiry_valid: expiryValid,
    cvv_valid: cvvValid,
    length: clean.length,
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

export default router;
