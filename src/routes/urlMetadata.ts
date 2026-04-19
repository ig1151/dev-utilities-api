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
