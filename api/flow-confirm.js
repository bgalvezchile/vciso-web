const crypto = require('crypto');
const fetch  = require('node-fetch');

function flowSign(params, secretKey) {
  const keys   = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

module.exports = async (req, res) => {
  const token = (req.body && req.body.token) || req.query.token;
  if (!token) return res.status(400).send('No token');

  const API_KEY    = process.env.FLOW_API_KEY;
  const SECRET_KEY = process.env.FLOW_SECRET_KEY;
  const API_URL    = process.env.FLOW_API_URL || 'https://www.flow.cl/api';
  const SITE_URL   = process.env.SITE_URL     || 'https://www.vciso.cl';

  const params = { apiKey: API_KEY, token };
  params.s = flowSign(params, SECRET_KEY);

  try {
    const resp = await fetch(
      `${API_URL}/payment/getStatus?${new URLSearchParams(params)}`,
      { method: 'GET' }
    );
    const data = await resp.json();

    if (data.status === 2) {
      const email   = data.payer;
      const order   = data.commerceOrder || '';
      let   product = 'servicio';
      if (order.includes('EBOOK'))     product = 'ebook';
      if (order.includes('DIAG'))      product = 'diagnostico';
      if (order.includes('POLITICAS')) product = 'politicas';

      fetch(`${SITE_URL}/api/send-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, product, order, amount: data.amount }),
      }).catch(e => console.error('Email error:', e.message));

      return res.status(200).send('OK');
    }
    return res.status(200).send('PENDING');
  } catch (err) {
    console.error('flow-confirm error:', err.message);
    return res.status(500).send('ERROR');
  }
};
