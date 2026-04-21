import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  street: Joi.string().min(1).max(200).optional(),
  city: Joi.string().min(1).max(100).optional(),
  state: Joi.string().min(1).max(100).optional(),
  postal_code: Joi.string().min(1).max(20).optional(),
  country: Joi.string().min(2).max(2).uppercase().required(),
}).or('street', 'postal_code');

const POSTAL_PATTERNS: Record<string, { pattern: RegExp; format: string }> = {
  US: { pattern: /^\d{5}(-\d{4})?$/, format: '12345 or 12345-6789' },
  GB: { pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, format: 'SW1A 1AA' },
  CA: { pattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, format: 'A1A 1A1' },
  AU: { pattern: /^\d{4}$/, format: '1234' },
  DE: { pattern: /^\d{5}$/, format: '12345' },
  FR: { pattern: /^\d{5}$/, format: '75001' },
  IT: { pattern: /^\d{5}$/, format: '00100' },
  ES: { pattern: /^\d{5}$/, format: '28001' },
  NL: { pattern: /^\d{4}\s?[A-Z]{2}$/i, format: '1234 AB' },
  BE: { pattern: /^\d{4}$/, format: '1000' },
  CH: { pattern: /^\d{4}$/, format: '1234' },
  AT: { pattern: /^\d{4}$/, format: '1010' },
  SE: { pattern: /^\d{3}\s?\d{2}$/, format: '123 45' },
  NO: { pattern: /^\d{4}$/, format: '0150' },
  DK: { pattern: /^\d{4}$/, format: '1050' },
  FI: { pattern: /^\d{5}$/, format: '00100' },
  PT: { pattern: /^\d{4}-\d{3}$/, format: '1000-001' },
  PL: { pattern: /^\d{2}-\d{3}$/, format: '00-001' },
  CZ: { pattern: /^\d{3}\s?\d{2}$/, format: '110 00' },
  HU: { pattern: /^\d{4}$/, format: '1011' },
  RO: { pattern: /^\d{6}$/, format: '010011' },
  JP: { pattern: /^\d{3}-\d{4}$/, format: '100-0001' },
  CN: { pattern: /^\d{6}$/, format: '100000' },
  IN: { pattern: /^\d{6}$/, format: '110001' },
  BR: { pattern: /^\d{5}-?\d{3}$/, format: '01310-100' },
  MX: { pattern: /^\d{5}$/, format: '06600' },
  ZA: { pattern: /^\d{4}$/, format: '0001' },
  SG: { pattern: /^\d{6}$/, format: '018956' },
  NZ: { pattern: /^\d{4}$/, format: '1010' },
};

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands',
  BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', PT: 'Portugal', PL: 'Poland', CZ: 'Czech Republic',
  HU: 'Hungary', RO: 'Romania', JP: 'Japan', CN: 'China', IN: 'India',
  BR: 'Brazil', MX: 'Mexico', ZA: 'South Africa', SG: 'Singapore', NZ: 'New Zealand',
};

function validatePostalCode(postalCode: string, country: string): { valid: boolean; format?: string } {
  const countryData = POSTAL_PATTERNS[country];
  if (!countryData) return { valid: true }; // Unknown country — pass through
  const valid = countryData.pattern.test(postalCode.trim());
  return { valid, format: countryData.format };
}

function normalizeAddress(street?: string, city?: string, state?: string, postalCode?: string, country?: string) {
  return {
    street: street ? street.trim().replace(/\s+/g, ' ') : undefined,
    city: city ? city.trim().replace(/\b\w/g, c => c.toUpperCase()) : undefined,
    state: state ? state.trim().toUpperCase() : undefined,
    postal_code: postalCode ? postalCode.trim().toUpperCase() : undefined,
    country: country ?? undefined,
  };
}

router.post('/address-validate', (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const country = value.country as string;
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Postal code validation
  let postalValid = true;
  let postalFormat: string | undefined;
  if (value.postal_code) {
    const result = validatePostalCode(value.postal_code, country);
    postalValid = result.valid;
    postalFormat = result.format;
    if (!postalValid) {
      issues.push(`Invalid postal code format for ${country}`);
      if (postalFormat) suggestions.push(`Expected format: ${postalFormat}`);
    }
  }

  // Basic street validation
  if (value.street) {
    if (!/\d/.test(value.street) && country === 'US') {
      issues.push('Street address appears to be missing a number');
    }
    if (value.street.length < 5) {
      issues.push('Street address seems too short');
    }
  }

  // City validation
  if (value.city && /\d/.test(value.city)) {
    issues.push('City name contains numbers — please verify');
  }

  const normalized = normalizeAddress(value.street, value.city, value.state, value.postal_code, country);
  const valid = issues.length === 0;
  const countryName = COUNTRY_NAMES[country] ?? country;

  logger.info({ country, valid, issues: issues.length }, 'Address validation complete');

  res.json({
    valid,
    country_code: country,
    country_name: countryName,
    normalized,
    issues,
    suggestions,
    postal_code_valid: postalValid,
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

export default router;
