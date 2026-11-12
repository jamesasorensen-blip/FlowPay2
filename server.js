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

// Explicitly opt-in redesign preview for local/staging evaluation only.
// Disabled by default, so production serves exactly the existing routes.
if (process.env.FLOWPAY_ENABLE_REDESIGN_PREVIEW === '1') {
  const previewAssets = new Map([
    ['/redesign-preview', 'preview/redesign.html'],
    ['/design/financial-clarity.css', 'design/financial-clarity.css'],
    ['/financial-display.mjs', 'financial-display.mjs'],
    ['/financial-view-adapter.mjs', 'financial-view-adapter.mjs'],
    ['/bill-record-adapter.mjs', 'bill-record-adapter.mjs'],
    ['/receipt-reconciliation.mjs', 'receipt-reconciliation.mjs'],
    ['/receipt-text-parser.mjs', 'receipt-text-parser.mjs'],
    ['/cashflow-simulator.mjs', 'cashflow-simulator.mjs'],
    ['/flowpay-navigation.mjs', 'flowpay-navigation.mjs']
  ]);
  for (const [route, filename] of previewAssets) {
    app.get(route, (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      res.sendFile(path.join(__dirname, filename), err => {
        if (err && !res.headersSent) next(err);
      });
    });
  }
}

// Only explicitly approved frontend assets may be served from repository root.
// Do not expose server.js, environment files, Git metadata, package files, or policies.
const publicAssets = new Set([
  'index.html', 'guest-demo.html', 'manual.html', 'manual-account.mjs', 'manual-budget-store.mjs', 'manual-ledger.mjs', 'manual-mfa.mjs', 'manual-mfa-ui.mjs', 'manifest.json', 'manifest.webmanifest', 'favicon.ico',
  'icon-192.png', 'icon-512.png', 'sw.js', 'service-worker.js'
]);
const assetAliases = new Map([
  ['manifest.webmanifest', 'manifest.json'],
  ['favicon.ico', 'icon-192.png']
]);
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:filename', (req, res, next) => {
  if (!publicAssets.has(req.params.filename)) return next();
  const filename = assetAliases.get(req.params.filename) || req.params.filename;
  if (req.params.filename === 'manifest.webmanifest') res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, filename), err => {
    if (err?.status === 404 && !res.headersSent) return next();
    if (err && !res.headersSent) next(err);
  });
});
app.use((_req, res) => res.status(404).send('Not found'));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log('FlowPay frontend server listening'));
