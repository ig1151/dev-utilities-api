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
