const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const app = express();
app.use(express.json());

app.use(express.static('.'));

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

app.post('/api/get_balance', async (req, res) => {
  try {
    res.json({ balance: 2850.00 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, function() {
    console.log(Server is running on port ${PORT});
});
