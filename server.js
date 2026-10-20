const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const configuration = new Configuration({
  // ✅ LIVE mode
  basePath: PlaidEnvironments.production,

  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || 'YOUR_CLIENT_ID',
      'PLAID-SECRET': process.env.PLAID_SECRET || 'YOUR_SECRET',
    },
  },
});

const plaidClient = new PlaidApi(configuration);

/**
 * 1) Create Link token
 * Frontend calls this to get link_token
 */
app.post('/api/create_link_token', async (req, res) => {
  try {
    const { client_user_id } = req.body;

    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: client_user_id || 'user123',
      },
      client_name: 'Your App Name',
      products: ['accounts'],
      country_codes: ['US'],
      language: 'en',
    });

    res.json(response.data);
  } catch (err) {
    console.error('create_link_token error:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to create link token',
      details: err?.response?.data || err.message,
    });
  }
});

/**
 * 2) Exchange public_token for access_token
 * Frontend calls this after user connects via Plaid Link
 */
app.post('/api/exchange_public_token', async (req, res) => {
  try {
    const { public_token } = req.body;

    if (!public_token) {
      return res.status(400).json({ error: 'Missing public_token' });
    }

    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    // ✅ In production, store access_token securely in your DB.
    // For demo purposes, we return it to the client.
    res.json({ access_token: response.data.access_token });
  } catch (err) {
    console.error('exchange_public_token error:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to exchange public token',
      details: err?.response?.data || err.message,
    });
  }
});

/**
 * 3) Get balances
 * Frontend calls this with access_token (in real apps, fetch access_token from DB)
 */
app.post('/api/get_balance', async (req, res) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: 'Missing access_token' });
    }

    const response = await plaidClient.accountsGet({ access_token });

    const accounts = response.data.accounts || [];

    // Sum current balances across all accounts
    const totalCurrentBalance = accounts.reduce((sum, acct) => {
      const current = acct.balances?.current ?? 0;
      return sum + current;
    }, 0);

    res.json({
      balance: totalCurrentBalance,
      accounts: accounts.map((acct) => ({
        account_id: acct.account_id,
        name: acct.name,
        type: acct.subtype,
        current: acct.balances?.current ?? null,
        available: acct.balances?.available ?? null,
        currency: acct.balances?.iso_currency_code ?? null,
      })),
    });
  } catch (err) {
    console.error('get_balance error:', err?.response?.data || err.message);
    res.status(err?.response?.status || 500).json({
      error: 'Failed to fetch balance',
      details: err?.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
