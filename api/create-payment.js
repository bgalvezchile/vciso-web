const crypto = require('crypto');
const fetch  = require('node-fetch');

function flowSign(params, secretKey) {
  const keys   = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { email, amount, subject, commerceOrder } = req.body || {};
  if (!email || !amount || !subject)
    return res.status(400).json({ error: 'Faltan parámetros: email, amount, subject' });

  const API_KEY    = process.env.FLOW_API_KEY;
  const SECRET_KEY = process.env.FLOW_SECRET_KEY;
  const API_URL    = process.env.FLOW_API_URL || 'https://www.flow.cl/api';
  const SITE_URL   = process.env.SITE_URL     || 'https://www.vciso.cl';

  if (!API_KEY || !SECRET_KEY)
    return res.status(500).json({ error: 'Configuración de pago no disponible' });

  const orderId = commerceOrder || `VCISO-${Date.now()}`;
  const params  = {
    apiKey:          API_KEY,
    commerceOrder:   orderId,
    subject,
    currency:        'CLP',
    amount:          String(Math.round(amount)),
    email,
    urlConfirmation: `${SITE_URL}/api/flow-confirm`,
    urlReturn:       `${SITE_URL}/api/payment-return`,
    paymentMethod:   9,
  };
  params.s = flowSign(params, SECRET_KEY);

  try {
    const resp = await fetch(`${API_URL}/payment/create`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams(params).toString(),
    });
    const data = await resp.json();
    if (data.url && data.token)
      return res.json({ redirect: `${data.url}?token=${data.token}`, token: data.token, orderId });
    console.error('Flow error:', JSON.stringify(data));
    return res.status(500).json({ error: data.message || 'Error al crear pago en Flow' });
  } catch (err) {
    console.error('create-payment error:', err.message);
    return res.status(500).json({ error: 'Error de conexión con Flow' });
  }
};
