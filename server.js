'use strict';
const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Legacy Plaid endpoints were unauthenticated and are permanently disabled.
// The frontend uses the authenticated Cloudflare Worker API instead.
app.use('/api', (_req, res) => res.status(410).json({ error: 'Legacy API retired' }));

// Only explicitly approved frontend assets may be served from repository root.
// Do not expose server.js, environment files, Git metadata, package files, or policies.
const publicAssets = new Set([
  'index.html', 'manifest.webmanifest', 'favicon.ico',
  'icon-192.png', 'icon-512.png', 'sw.js', 'service-worker.js'
]);
// Serve only the audited MFA browser modules; never expose the cloudflare directory.
const mfaModules = new Set(['flowpay-mfa.mjs', 'flowpay-mfa-ui.mjs']);
app.get('/mfa/:module', (req, res, next) => {
  if (!mfaModules.has(req.params.module)) return next();
  res.type('text/javascript');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'cloudflare', req.params.module), err => {
    if (err && !res.headersSent) next(err);
  });
});
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:filename', (req, res, next) => {
  if (!publicAssets.has(req.params.filename)) return next();
  res.sendFile(path.join(__dirname, req.params.filename), err => {
    if (err && !res.headersSent) next(err);
  });
});
app.use((_req, res) => res.status(404).send('Not found'));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log('FlowPay frontend server listening'));
