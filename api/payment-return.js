const crypto = require('crypto');
const fetch  = require('node-fetch');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso-download-secret-2026';

function flowSign(params, secretKey) {
  const keys   = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

function generateDownloadToken(product, email) {
  const timestamp = Date.now().toString();
  const payload   = `${product}|${email}|${timestamp}`;
  const sig       = crypto
    .createHmac('sha256', DOWNLOAD_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

module.exports = async (req, res) => {
  // Flow envía el token por POST o GET
  const flowToken = (req.body && req.body.token) || req.query.token || '';

  if (!flowToken) {
    return res.redirect(302, '/pago-exitoso.html');
  }

  // Consultar estado del pago en Flow para obtener email y orden
  const API_KEY    = process.env.FLOW_API_KEY;
  const SECRET_KEY = process.env.FLOW_SECRET_KEY;
  const API_URL    = process.env.FLOW_API_URL || 'https://www.flow.cl/api';

  try {
    const params = { apiKey: API_KEY, token: flowToken };
    params.s = flowSign(params, SECRET_KEY);

    const resp = await fetch(
      `${API_URL}/payment/getStatus?${new URLSearchParams(params)}`,
      { method: 'GET' }
    );
    const data = await resp.json();

    if (data.status === 2) {
      // Pago exitoso — generar token de descarga con email real
      const email = data.payer || '';
      const order = data.commerceOrder || '';

      let product = 'servicio';
      if (order.includes('EBOOK'))     product = 'ebook';
      if (order.includes('DIAG'))      product = 'diagnostico';
      if (order.includes('POLITICAS')) product = 'politicas';

      const downloadToken = generateDownloadToken(product, email);

      // Redirigir a pago-exitoso con token de descarga
      return res.redirect(302,
        `/pago-exitoso.html?token=${downloadToken}&email=${encodeURIComponent(email)}&product=${product}`
      );
    }
  } catch (err) {
    console.error('payment-return error:', err.message);
  }

  // Si falla, redirigir sin token
  return res.redirect(302, '/pago-exitoso.html');
};
