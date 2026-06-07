const crypto = require('crypto');
const fetch  = require('node-fetch');

function flowSign(params, secretKey) {
  const keys   = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

async function sendEmail(to, product, order, resendKey, siteUrl) {
  const FROM = 'vCISO.cl <contacto@vciso.cl>';

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
        <p style="color:rgba(255,255,255,0.7);margin-bottom:24px">
          Tu pago fue confirmado. Haz clic para descargar tu manual:
        </p>
        <div style="text-align:center;margin:32px 0">
          <a href="${siteUrl}/public/downloads/manual-ciberseguridad-pymes.pdf"
             style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                    text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
            📥 Descargar Manual PDF
          </a>
        </div>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35)">
          Orden: ${order}<br/>
          ¿Problemas? contacto@vciso.cl · WhatsApp +56 9 8451 5075
        </p></div>`,
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
          Orden: ${order} · WhatsApp: +56 9 8451 5075
        </p></div>`,
    },
    politicas: {
      subject: '📋 Tus Políticas TI en proceso — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! Generando políticas 📋</h1>
        <p style="color:rgba(255,255,255,0.7)">
          Recibimos tu pago de <strong>$29.000 CLP</strong>.<br/>
          Tus políticas personalizadas llegarán pronto a este email.
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

  const data = await resp.json();
  return data;
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
    console.log('Flow status:', data.status, 'payer:', data.payer, 'order:', data.commerceOrder);

    if (data.status === 2) {
      const email   = data.payer;
      const order   = data.commerceOrder || '';

      let product = 'servicio';
      if (order.includes('EBOOK'))     product = 'ebook';
      if (order.includes('DIAG'))      product = 'diagnostico';
      if (order.includes('POLITICAS')) product = 'politicas';

      console.log(`Enviando email a ${email} para producto: ${product}`);

      try {
        const emailResult = await sendEmail(email, product, order, RESEND_KEY, SITE_URL);
        console.log('Email enviado:', JSON.stringify(emailResult));
      } catch (emailErr) {
        console.error('Error enviando email:', emailErr.message);
      }

      return res.status(200).send('OK');
    }

    console.log('Pago no confirmado, status:', data.status);
    return res.status(200).send('PENDING');
  } catch (err) {
    console.error('flow-confirm error:', err.message);
    return res.status(500).send('ERROR');
  }
};
