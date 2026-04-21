import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { logger } from './logger';
import urlMetadataRouter from './routes/urlMetadata';
import emailExtractorRouter from './routes/emailExtractor';
import textCleanRouter from './routes/textClean';
import domainIntelligenceRouter from './routes/domainIntelligence';
import companyEnrichmentRouter from './routes/companyEnrichment';
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
    version: '1.1.0',
    description: 'Fast, simple utility APIs for developers.',
    status: 'ok',
    docs: '/docs',
    health: '/v1/health',
    endpoints: {
      url_metadata: 'POST /v1/url-metadata',
      email_extract: 'POST /v1/email-extract',
      text_clean: 'POST /v1/text-clean',
      domain_intelligence: 'POST /v1/domain-intelligence',
    },
  });
});

app.get('/v1/health', (_req, res) => {
  res.json({ status: 'ok', service: 'dev-utilities-api', timestamp: new Date().toISOString() });
});

app.use('/v1', urlMetadataRouter);
app.use('/v1', emailExtractorRouter);
app.use('/v1', textCleanRouter);
app.use('/v1', domainIntelligenceRouter);
app.use('/v1', companyEnrichmentRouter);
app.use('/docs', docsRouter);
app.use('/openapi.json', openapiRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Dev Utilities API running');
});
