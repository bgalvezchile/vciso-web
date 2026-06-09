const crypto = require('crypto');
const fetch  = require('node-fetch');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';

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

// ─── Configuración de productos ───────────────────────────────────────────────
// Para agregar un producto nuevo: añade una entrada al objeto PRODUCTS.
// prefix:      prefijo del commerceOrder (ej: 'EBOOK' para 'EBOOK-123456')
// name:        nombre legible para el email
// price:       precio en CLP (solo informativo en el email)
// hasDownload: true si entrega un PDF descargable (genera token de descarga)
// deliveryMsg: mensaje de entrega que se muestra en el email
const PRODUCTS = {
  ebook: {
    prefix:      'EBOOK',
    name:        'Manual de Ciberseguridad para PYMEs',
    price:       '$12.900 CLP',
    hasDownload: true,
    deliveryMsg: 'Tu PDF personalizado con marca de agua está listo para descargar.',
  },
  diagnostico: {
    prefix:      'DIAG',
    name:        'Diagnóstico Express de Ciberseguridad',
    price:       '$79.000 CLP',
    hasDownload: false,
    deliveryMsg: 'Recibirás tu informe personalizado en las próximas <strong>24 horas hábiles</strong>.',
  },
  politicas: {
    prefix:      'POLITICAS',
    name:        'Generador de Políticas de Seguridad TI',
    price:       '$29.000 CLP',
    hasDownload: false,
    deliveryMsg: 'Tus políticas personalizadas llegarán en las próximas <strong>24 horas hábiles</strong>.',
  },
  dominio: {
    prefix:      'DOMINIO',
    name:        'Análisis Completo de Dominio',
    price:       '$49.000 CLP',
    hasDownload: false,
    deliveryMsg: 'Tu análisis completo de dominio llegará en las próximas <strong>24 horas hábiles</strong>.',
  },
};

// Detecta el producto desde el commerceOrder
function detectProduct(order) {
  for (const [key, cfg] of Object.entries(PRODUCTS)) {
    if (order.toUpperCase().startsWith(cfg.prefix)) return key;
  }
  return 'ebook'; // fallback
}

// Template único de email — se adapta según el producto
function buildEmail(siteUrl, product, cfg, order, downloadToken) {
  const downloadUrl = downloadToken
    ? `${siteUrl}/api/get-download?token=${downloadToken}`
    : null;

  const downloadBtn = downloadUrl ? `
    <div style="text-align:center;margin:28px 0">
      <a href="${downloadUrl}"
         style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
        📥 Descargar mi PDF ahora
      </a>
    </div>
    <p style="color:rgba(255,255,255,0.4);font-size:0.78rem;text-align:center;margin-top:-8px">
      ⏰ Link válido por 48 horas
    </p>` : '';

  const nextSteps = cfg.hasDownload ? `
    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:16px;margin:20px 0">
      <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin:0">
        📧 También te enviamos el PDF a este email como respaldo.
        El PDF incluye tu dirección como <strong>marca de agua</strong> para proteger la autoría.
      </p>
    </div>` : `
    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:16px;margin:20px 0">
      <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;margin:0 0 8px 0">
        📋 <strong>Próximos pasos:</strong>
      </p>
      <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin:0">
        ${cfg.deliveryMsg}<br/>
        Si tienes alguna consulta, escríbenos por WhatsApp: +56 9 8130 7440
      </p>
    </div>`;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;
                background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">

      <div style="font-size:1.8rem;font-weight:900;margin-bottom:8px">
        v<span style="color:#f47c47">CISO</span>.cl
      </div>
      <div style="font-size:0.75rem;color:rgba(255,255,255,0.3);margin-bottom:32px;
                  text-transform:uppercase;letter-spacing:0.06em">
        Ciberseguridad para PYMEs · Santiago, Chile
      </div>

      <h1 style="font-size:1.3rem;font-weight:800;margin-bottom:8px">
        ¡Gracias por tu compra! 🎉
      </h1>
      <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:4px">
        <strong style="color:#fff">${cfg.name}</strong>
      </p>
      <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:24px">
        Pago de <strong style="color:#86efac">${cfg.price}</strong> confirmado ✅
      </p>

      ${downloadBtn}
      ${nextSteps}

      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:20px;
                  margin-top:24px;font-size:0.78rem;color:rgba(255,255,255,0.3)">
        Orden: ${order} · contacto@vciso.cl · WhatsApp +56 9 8130 7440<br/>
        <a href="https://www.vciso.cl" style="color:rgba(255,255,255,0.3)">www.vciso.cl</a>
      </div>
    </div>`;
}

async function sendEmail(to, product, cfg, order, resendKey, siteUrl, downloadToken) {
  const html = buildEmail(siteUrl, product, cfg, order, downloadToken);

  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'vCISO.cl <contacto@vciso.cl>',
      to:      [to],
      bcc:     ['contacto@vciso.cl'],
      subject: `✅ ${cfg.name} — vCISO.cl`,
      html,
    }),
  });
  return resp.json();
}

// ─── Handler principal ─────────────────────────────────────────────────────────
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
    console.log('Flow status:', data.status, 'order:', data.commerceOrder, 'payer:', data.payer);

    if (data.status === 2) {
      const email   = data.payer;
      const order   = data.commerceOrder || '';
      const product = detectProduct(order);
      const cfg     = PRODUCTS[product];

      const downloadToken = cfg.hasDownload
        ? generateDownloadToken(product, email)
        : null;

      console.log(`Producto: ${product}, email: ${email}`);

      try {
        const result = await sendEmail(email, product, cfg, order, RESEND_KEY, SITE_URL, downloadToken);
        console.log('Email enviado:', JSON.stringify(result));
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
