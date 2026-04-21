import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const ibanSchema = Joi.object({
  iban: Joi.string().min(5).max(34).required(),
});

const bicSchema = Joi.object({
  bic: Joi.string().min(8).max(11).required(),
});

const IBAN_LENGTHS: Record<string, number> = {
  AL: 28, AD: 24, AT: 20, AZ: 28, BH: 22, BE: 16, BA: 20, BR: 29,
  BG: 22, CR: 22, HR: 21, CY: 28, CZ: 24, DK: 18, DO: 28, EE: 20,
  FO: 18, FI: 18, FR: 27, GE: 22, DE: 22, GI: 23, GR: 27, GL: 18,
  GT: 28, HU: 28, IS: 26, IE: 22, IL: 23, IT: 27, JO: 30, KZ: 20,
  XK: 20, KW: 30, LV: 21, LB: 28, LI: 21, LT: 20, LU: 20, MK: 19,
  MT: 31, MR: 27, MU: 30, MD: 24, MC: 27, ME: 22, NL: 18, NO: 15,
  PK: 24, PS: 29, PL: 28, PT: 25, QA: 29, RO: 24, SM: 27, SA: 24,
  RS: 22, SK: 24, SI: 19, ES: 24, SE: 24, CH: 21, TN: 24, TR: 26,
  AE: 23, GB: 22, VG: 24,
};

const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Germany', GB: 'United Kingdom', FR: 'France', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', PL: 'Poland', PT: 'Portugal',
  IE: 'Ireland', GR: 'Greece', CZ: 'Czech Republic', HU: 'Hungary', RO: 'Romania',
  US: 'United States', CA: 'Canada', AU: 'Australia', JP: 'Japan',
};

function mod97(str: string): number {
  let remainder = 0;
  for (const char of str) {
    remainder = (remainder * 10 + parseInt(char)) % 97;
  }
  return remainder;
}

function validateIban(iban: string): { valid: boolean; country_code: string | null; country_name: string | null; formatted: string; length_valid: boolean; checksum_valid: boolean; bank_code?: string; account_number?: string } {
  const normalized = iban.toUpperCase().replace(/\s/g, '');
  const countryCode = normalized.slice(0, 2);
  const formatted = normalized.match(/.{1,4}/g)?.join(' ') ?? normalized;

  const expectedLength = IBAN_LENGTHS[countryCode];
  const lengthValid = expectedLength ? normalized.length === expectedLength : normalized.length >= 15 && normalized.length <= 34;

  if (!lengthValid) {
    return { valid: false, country_code: countryCode, country_name: COUNTRY_NAMES[countryCode] ?? null, formatted, length_valid: false, checksum_valid: false };
  }

  // Move first 4 chars to end and convert letters to numbers
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const numeric = rearranged.split('').map(c => isNaN(parseInt(c)) ? (c.charCodeAt(0) - 55).toString() : c).join('');
  const checksumValid = mod97(numeric) === 1;

  // Extract bank code and account number (simplified)
  const bankCode = normalized.slice(4, 8);
  const accountNumber = normalized.slice(8);

  return {
    valid: checksumValid,
    country_code: countryCode,
    country_name: COUNTRY_NAMES[countryCode] ?? null,
    formatted,
    length_valid: lengthValid,
    checksum_valid: checksumValid,
    bank_code: bankCode,
    account_number: accountNumber,
  };
}

function validateBic(bic: string): { valid: boolean; bank_code: string; country_code: string; country_name: string | null; location_code: string; branch_code?: string; formatted: string } {
  const normalized = bic.toUpperCase().replace(/\s/g, '');
  const valid = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalized);

  const bankCode = normalized.slice(0, 4);
  const countryCode = normalized.slice(4, 6);
  const locationCode = normalized.slice(6, 8);
  const branchCode = normalized.length === 11 ? normalized.slice(8) : undefined;

  return {
    valid,
    bank_code: bankCode,
    country_code: countryCode,
    country_name: COUNTRY_NAMES[countryCode] ?? null,
    location_code: locationCode,
    branch_code: branchCode,
    formatted: normalized,
  };
}

router.post('/iban-validate', (req: Request, res: Response) => {
  const { error, value } = ibanSchema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const result = validateIban(value.iban);
  logger.info({ country: result.country_code, valid: result.valid }, 'IBAN validation complete');

  res.json({
    ...result,
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

router.post('/bic-validate', (req: Request, res: Response) => {
  const { error, value } = bicSchema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const result = validateBic(value.bic);
  logger.info({ country: result.country_code, valid: result.valid }, 'BIC validation complete');

  res.json({
    ...result,
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

export default router;
