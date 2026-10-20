const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const app = express();
app.use(express.json());

// Serve your frontend index.html files if they are in the same folder
app.use(express.express?.static ? express.static('public') : express.static('.'));

// Initialize Plaid Client (using Sandbox environment for testing)
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || 'YOUR_CLIENT_ID',
      'PLAID-SECRET': process.env.PLAID_SECRET || 'YOUR_SECRET',
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Example route to fetch balance
app.post('/api/get_balance', async (req, res) => {
  try {
    // In a real flow, you exchange the public_token here
    res.json({ balance: 2850.00 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Use Render's dynamic port or default to 10000
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT`});
});
