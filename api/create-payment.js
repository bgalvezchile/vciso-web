const crypto = require('crypto');

// Firma HMAC-SHA256 requerida por Flow
function flowSign(params, secretKey) {
  const keys = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, amount, subject, commerceOrder } = req.body;

  if (!email || !amount || !subject) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  const API_KEY    = process.env.FLOW_API_KEY;
  const SECRET_KEY = process.env.FLOW_SECRET_KEY;
  const API_URL    = process.env.FLOW_API_URL || 'https://www.flow.cl/api';
  const SITE_URL   = process.env.SITE_URL || 'https://www.vciso.cl';

  const orderId = commerceOrder || `VCISO-${Date.now()}`;

  const params = {
    apiKey:          API_KEY,
    commerceOrder:   orderId,
    subject:         subject,
    currency:        'CLP',
    amount:          String(amount),
    email:           email,
    urlConfirmation: `${SITE_URL}/api/flow-confirm`,
    urlReturn:       `${SITE_URL}/pago-exitoso.html`,
    paymentMethod:   9,  // Todos los medios
  };

  params.s = flowSign(params, SECRET_KEY);

  const body = new URLSearchParams(params).toString();

  try {
    const resp = await fetch(`${API_URL}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await resp.json();

    if (data.url && data.token) {
      return res.json({
        redirect: `${data.url}?token=${data.token}`,
        token: data.token,
        orderId,
      });
    } else {
      console.error('Flow error:', data);
      return res.status(500).json({ error: data.message || 'Error al crear pago' });
    }
  } catch (err) {
    console.error('Network error:', err);
    return res.status(500).json({ error: 'Error de conexión con Flow' });
  }
};
