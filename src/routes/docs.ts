import { Router, Request, Response } from 'express';
const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Dev Utilities API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; background: #0f0f0f; color: #e0e0e0; }
    h1 { color: #7c3aed; } h2 { color: #a78bfa; border-bottom: 1px solid #333; padding-bottom: 8px; }
    pre { background: #1a1a1a; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    code { color: #c084fc; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; margin-right: 8px; color: white; }
    .post { background: #7c3aed; } .get { background: #065f46; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 8px 12px; border: 1px solid #333; text-align: left; }
    th { background: #1a1a1a; }
  </style>
</head>
<body>
  <h1>Dev Utilities API</h1>
  <p>Fast, simple utility APIs for developers — URL metadata, email extraction, and text normalization.</p>
  <h2>Endpoints</h2>
  <table>
    <tr><th>Method</th><th>Path</th><th>Description</th></tr>
    <tr><td><span class="badge post">POST</span></td><td>/v1/url-metadata</td><td>Extract metadata from any URL</td></tr>
    <tr><td><span class="badge post">POST</span></td><td>/v1/email-extract</td><td>Extract emails, names, companies from text</td></tr>
    <tr><td><span class="badge post">POST</span></td><td>/v1/text-clean</td><td>Clean and normalize text with language detection</td></tr>
    <tr><td><span class="badge get">GET</span></td><td>/v1/health</td><td>Health check</td></tr>
  </table>

  <h2>URL Metadata</h2>
  <pre>POST /v1/url-metadata
{ "url": "https://stripe.com" }</pre>

  <h2>Email Extractor</h2>
  <pre>POST /v1/email-extract
{ "text": "Contact John Smith at john@stripe.com or visit https://stripe.com" }</pre>

  <h2>Text Clean</h2>
  <pre>POST /v1/text-clean
{
  "text": "&lt;p&gt;Hello   world!&lt;/p&gt;",
  "options": {
    "remove_html": true,
    "normalize_whitespace": true,
    "lowercase": false
  }
}</pre>
  <p><a href="/openapi.json" style="color:#a78bfa">OpenAPI JSON</a></p>
</body>
</html>`);
});

export default router;
