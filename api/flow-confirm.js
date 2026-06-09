const crypto = require('crypto');
const fetch  = require('node-fetch');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso-download-secret-2026';

function flowSign(params, secretKey) {
  const keys   = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

// Token incluye: producto + email + timestamp (para el watermark)
function generateDownloadToken(product, email) {
  const timestamp = Date.now().toString();
  const payload   = `${product}|${email}|${timestamp}`;
  const sig       = crypto
    .createHmac('sha256', DOWNLOAD_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

async function sendEmail(to, product, order, resendKey, siteUrl, downloadToken) {
  const FROM       = 'vCISO.cl <contacto@vciso.cl>';
  const downloadUrl = `${siteUrl}/api/get-download?token=${downloadToken}`;

  const base = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;
    background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
    <div style="font-size:1.8rem;font-weight:900;margin-bottom:24px">
      v<span style="color:#f47c47">CISO</span>.cl
    </div>`;

  const templates = {
    ebook: {
      subject: '📥 Tu Manual de Ciberseguridad para PYMEs — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Gracias por tu compra! 🎉</h1>
        <p style="color:rgba(255,255,255,0.7);margin-bottom:8px">
          Tu pago de <strong>$12.900 CLP</strong> fue confirmado.
        </p>
        <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:24px">
          El PDF incluye tu email como marca de agua para proteger la autoría.
        </p>
        <div style="text-align:center;margin:32px 0">
          <a href="${downloadUrl}"
             style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                    text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
            📥 Descargar mi Manual PDF
          </a>
        </div>
        <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:14px;
                    margin-top:8px;font-size:0.8rem;color:rgba(255,255,255,0.45)">
          ⏰ Link válido por 48 horas · Orden: ${order}<br/>
          ¿Necesitas otro link? contacto@vciso.cl · WhatsApp +56 9 8130 7440
        </div></div>`,
    },
    diagnostico: {
      subject: '✅ Diagnóstico Express recibido — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! En proceso 🔍</h1>
        <p style="color:rgba(255,255,255,0.7)">
          Recibimos tu pago de <strong>$79.000 CLP</strong>.<br/>
          Tu informe llegará en las próximas <strong>24 horas hábiles</strong>.
        </p>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35);margin-top:20px">
          Orden: ${order} · WhatsApp: +56 9 8130 7440
        </p></div>`,
    },
    politicas: {
      subject: '📋 Tus Políticas TI en proceso — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! 📋</h1>
        <p style="color:rgba(255,255,255,0.7)">
          Recibimos tu pago de <strong>$29.000 CLP</strong>.<br/>
          Tus políticas personalizadas llegarán pronto.
        </p>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35);margin-top:20px">
          Orden: ${order} · contacto@vciso.cl
        </p></div>`,
    },
  };

  const tmpl = templates[product] || templates.ebook;

  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM,
      to:      [to],
      bcc:     ['contacto@vciso.cl'],
      subject: tmpl.subject,
      html:    tmpl.html,
    }),
  });

  return await resp.json();
}

module.exports = async (req, res) => {
  const token = (req.body && req.body.token) || req.query.token;
  if (!token) return res.status(400).send('No token');

  const API_KEY    = process.env.FLOW_API_KEY;
  const SECRET_KEY = process.env.FLOW_SECRET_KEY;
  const API_URL    = process.env.FLOW_API_URL || 'https://www.flow.cl/api';
  const SITE_URL   = process.env.SITE_URL     || 'https://www.vciso.cl';
  const RESEND_KEY = process.env.RESEND_API_KEY;

  const params = { apiKey: API_KEY, token };
  params.s = flowSign(params, SECRET_KEY);

  try {
    const resp = await fetch(
      `${API_URL}/payment/getStatus?${new URLSearchParams(params)}`,
      { method: 'GET' }
    );
    const data = await resp.json();
    console.log('Flow status:', data.status, 'payer:', data.payer);

    if (data.status === 2) {
      const email = data.payer;
      const order = data.commerceOrder || '';

      let product = 'servicio';
      if (order.includes('EBOOK'))     product = 'ebook';
      if (order.includes('DIAG'))      product = 'diagnostico';
      if (order.includes('POLITICAS')) product = 'politicas';

      // Token incluye email para el watermark
      const downloadToken = generateDownloadToken(product, email);
      console.log(`Email a ${email}, producto: ${product}`);

      try {
        const result = await sendEmail(
          email, product, order, RESEND_KEY, SITE_URL, downloadToken
        );
        console.log('Email:', JSON.stringify(result));
      } catch (e) {
        console.error('Email error:', e.message);
      }

      return res.status(200).send('OK');
    }

    return res.status(200).send('PENDING');
  } catch (err) {
    console.error('flow-confirm error:', err.message);
    return res.status(500).send('ERROR');
  }
};
