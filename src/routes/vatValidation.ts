import { Router, Request, Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  vat_number: Joi.string().min(4).max(20).required(),
  country_code: Joi.string().length(2).uppercase().optional(),
});

const EU_COUNTRIES: Record<string, { name: string; pattern: RegExp }> = {
  AT: { name: 'Austria', pattern: /^ATU\d{8}$/ },
  BE: { name: 'Belgium', pattern: /^BE[01]\d{9}$/ },
  BG: { name: 'Bulgaria', pattern: /^BG\d{9,10}$/ },
  CY: { name: 'Cyprus', pattern: /^CY\d{8}[A-Z]$/ },
  CZ: { name: 'Czech Republic', pattern: /^CZ\d{8,10}$/ },
  DE: { name: 'Germany', pattern: /^DE\d{9}$/ },
  DK: { name: 'Denmark', pattern: /^DK\d{8}$/ },
  EE: { name: 'Estonia', pattern: /^EE\d{9}$/ },
  ES: { name: 'Spain', pattern: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/ },
  FI: { name: 'Finland', pattern: /^FI\d{8}$/ },
  FR: { name: 'France', pattern: /^FR[A-Z0-9]{2}\d{9}$/ },
  GB: { name: 'United Kingdom', pattern: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/ },
  GR: { name: 'Greece', pattern: /^EL\d{9}$/ },
  HR: { name: 'Croatia', pattern: /^HR\d{11}$/ },
  HU: { name: 'Hungary', pattern: /^HU\d{8}$/ },
  IE: { name: 'Ireland', pattern: /^IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/ },
  IT: { name: 'Italy', pattern: /^IT\d{11}$/ },
  LT: { name: 'Lithuania', pattern: /^LT(\d{9}|\d{12})$/ },
  LU: { name: 'Luxembourg', pattern: /^LU\d{8}$/ },
  LV: { name: 'Latvia', pattern: /^LV\d{11}$/ },
  MT: { name: 'Malta', pattern: /^MT\d{8}$/ },
  NL: { name: 'Netherlands', pattern: /^NL\d{9}B\d{2}$/ },
  PL: { name: 'Poland', pattern: /^PL\d{10}$/ },
  PT: { name: 'Portugal', pattern: /^PT\d{9}$/ },
  RO: { name: 'Romania', pattern: /^RO\d{2,10}$/ },
  SE: { name: 'Sweden', pattern: /^SE\d{12}$/ },
  SI: { name: 'Slovenia', pattern: /^SI\d{8}$/ },
  SK: { name: 'Slovakia', pattern: /^SK\d{10}$/ },
};

function normalizeVat(vat: string): string {
  return vat.toUpperCase().replace(/[\s\-\.]/g, '');
}

function detectCountry(vat: string): string | null {
  const prefix = vat.slice(0, 2);
  return EU_COUNTRIES[prefix] ? prefix : null;
}

function validateFormat(vat: string, countryCode?: string): { valid: boolean; country_code: string | null; country_name: string | null; format_valid: boolean } {
  const normalized = normalizeVat(vat);
  const detected = countryCode ?? detectCountry(normalized);

  if (!detected) {
    return { valid: false, country_code: null, country_name: null, format_valid: false };
  }

  const country = EU_COUNTRIES[detected];
  if (!country) {
    return { valid: false, country_code: detected, country_name: null, format_valid: false };
  }

  const formatValid = country.pattern.test(normalized);
  return {
    valid: formatValid,
    country_code: detected,
    country_name: country.name,
    format_valid: formatValid,
  };
}

async function checkVies(vat: string, countryCode: string): Promise<{ active: boolean; company_name?: string; company_address?: string } | null> {
  try {
    const vatNumber = vat.replace(countryCode, '').replace(/[\s\-\.]/g, '');
    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
  <soapenv:Body>
    <urn:checkVat>
      <urn:countryCode>${countryCode}</urn:countryCode>
      <urn:vatNumber>${vatNumber}</urn:vatNumber>
    </urn:checkVat>
  </soapenv:Body>
</soapenv:Envelope>`;

    const res = await axios.post(
      'https://ec.europa.eu/taxation_customs/vies/services/checkVatService',
      soapBody,
      {
        headers: { 'Content-Type': 'text/xml', 'SOAPAction': '' },
        timeout: 8000,
      }
    );

    const xml = res.data as string;
    const valid = xml.includes('<valid>true</valid>');
    const nameMatch = xml.match(/<name>(.*?)<\/name>/);
    const addressMatch = xml.match(/<address>(.*?)<\/address>/s);

    return {
      active: valid,
      company_name: nameMatch?.[1]?.trim() !== '---' ? nameMatch?.[1]?.trim() : undefined,
      company_address: addressMatch?.[1]?.replace(/\n/g, ', ').trim() !== '---' ? addressMatch?.[1]?.replace(/\n/g, ', ').trim() : undefined,
    };
  } catch {
    return null;
  }
}

router.post('/vat-validate', async (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    res.status(400).json({ error: 'Validation failed', details: error.details[0].message });
    return;
  }

  const start = Date.now();
  const normalized = normalizeVat(value.vat_number);
  const { valid, country_code, country_name, format_valid } = validateFormat(normalized, value.country_code);

  let vies_result = null;
  if (format_valid && country_code && country_code !== 'GB') {
    vies_result = await checkVies(normalized, country_code);
  }

  logger.info({ vat: normalized, country_code, valid }, 'VAT validation complete');

  res.json({
    vat_number: normalized,
    valid: vies_result ? vies_result.active : valid,
    format_valid,
    country_code,
    country_name,
    vies_checked: vies_result !== null,
    company_name: vies_result?.company_name ?? null,
    company_address: vies_result?.company_address ?? null,
    latency_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

export default router;
