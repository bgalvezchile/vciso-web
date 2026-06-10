const crypto = require('crypto');
const fetch  = require('node-fetch');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';
const TOKEN_TTL       = 48 * 60 * 60 * 1000; // 48 horas

function flowSign(params, secretKey) {
  const keys   = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
}

// Token incluye: producto | email | timestamp | empresa (opcional)
function generateToken(product, email, empresa) {
  const timestamp = Date.now().toString();
  const empresaStr = empresa || '';
  const payload   = `${product}|${email}|${timestamp}|${empresaStr}`;
  const sig       = crypto
    .createHmac('sha256', DOWNLOAD_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

// ── Configuración de productos ───────────────────────────────────────────────
const PRODUCTS = {
  ebook: {
    prefix:       'EBOOK',
    name:         'Manual de Ciberseguridad para PYMEs',
    price:        '$12.900 CLP',
    hasDownload:  true,   // entrega PDF con watermark
    hasForm:      false,
    deliveryMsg:  null,
  },
  diagnostico: {
    prefix:       'DIAG',
    name:         'Diagnóstico Express de Ciberseguridad',
    price:        '$89.000 CLP',
    hasDownload:  false,
    hasForm:      true,   // necesita formulario
    formPath:     '/diagnostico',
    deliveryMsg:  'Recibirás tu informe personalizado en las próximas <strong>48 horas hábiles</strong> una vez que completes el formulario.',
  },
  politicas: {
    prefix:       'POLITICAS',
    name:         'Generador de Políticas de Seguridad TI',
    price:        '$29.000 CLP',
    hasDownload:  false,
    hasForm:      true,
    formPath:     '/generador-politicas',
    deliveryMsg:  'Usa el link para acceder al generador y crear tus políticas personalizadas.',
  },
  dominio: {
    prefix:       'DOMINIO',
    name:         'Análisis Completo de Dominio',
    price:        '$49.000 CLP',
    hasDownload:  false,
    hasForm:      true,
    formPath:     '/analisis-dominio',
    deliveryMsg:  'Recibirás tu informe de análisis de dominio en las próximas <strong>48 horas hábiles</strong> una vez que confirmes los datos.',
  },
};

function detectProduct(order) {
  for (const [key, cfg] of Object.entries(PRODUCTS)) {
    if (order.toUpperCase().startsWith(cfg.prefix)) return key;
  }
  return 'ebook';
}

function buildEmail(siteUrl, product, cfg, order, token) {
  const LOGO = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;
    background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
    <div style="font-size:1.8rem;font-weight:900;margin-bottom:8px">
      v<span style="color:#f47c47">CISO</span>.cl
    </div>
    <div style="font-size:0.75rem;color:rgba(255,255,255,0.3);margin-bottom:32px;
                text-transform:uppercase;letter-spacing:0.06em">
      Ciberseguridad para PYMEs · Santiago, Chile
    </div>`;

  // Bloque de acción principal según tipo de producto
  let actionBlock = '';

  if (cfg.hasDownload && token) {
    // Ebook → botón de descarga PDF
    const downloadUrl = `${siteUrl}/api/get-download?token=${token}`;
    actionBlock = `
      <div style="text-align:center;margin:28px 0">
        <a href="${downloadUrl}"
           style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                  text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
          📥 Descargar mi PDF ahora
        </a>
      </div>
      <p style="color:rgba(255,255,255,0.4);font-size:0.78rem;text-align:center;margin-top:-8px">
        ⏰ Link válido por 48 horas · PDF con marca de agua personalizada
      </p>`;
  } else if (cfg.hasForm && token) {
    // Diagnóstico / Políticas → botón para acceder al formulario
    const formUrl = `${siteUrl}${cfg.formPath}?token=${token}`;
    actionBlock = `
      <div style="background:rgba(255,255,255,0.04);border-radius:8px;
                  padding:16px;margin:20px 0">
        <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;margin:0 0 12px 0">
          📋 <strong>Siguiente paso:</strong> completa el formulario para que podamos preparar tu entrega.
        </p>
        <p style="color:rgba(255,255,255,0.55);font-size:0.85rem;margin:0 0 20px 0">
          ${cfg.deliveryMsg}
        </p>
      </div>
      <div style="text-align:center;margin:24px 0">
        <a href="${formUrl}"
           style="background:#1e4fad;color:#fff;padding:16px 32px;border-radius:8px;
                  text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
          📝 Completar formulario →
        </a>
      </div>
      <p style="color:rgba(255,255,255,0.3);font-size:0.75rem;text-align:center;margin-top:-8px">
        ⏰ Link válido por 48 horas
      </p>`;
  } else {
    // Dominio → mensaje de entrega
    actionBlock = `
      <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:16px;margin:20px 0">
        <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;margin:0">
          ${cfg.deliveryMsg}<br/>
          Si tienes consultas escríbenos por WhatsApp: +56 9 8130 7440
        </p>
      </div>`;
  }

  return LOGO + `
    <h1 style="font-size:1.3rem;font-weight:800;margin-bottom:8px">
      ¡Gracias por tu compra! 🎉
    </h1>
    <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:4px">
      <strong style="color:#fff">${cfg.name}</strong>
    </p>
    <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:24px">
      Pago de <strong style="color:#86efac">${cfg.price}</strong> confirmado ✅
    </p>
    ${actionBlock}
    <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:20px;
                margin-top:24px;font-size:0.78rem;color:rgba(255,255,255,0.3)">
      Orden: ${order} · contacto@vciso.cl · WhatsApp +56 9 8130 7440<br/>
      <a href="https://www.vciso.cl" style="color:rgba(255,255,255,0.3)">www.vciso.cl</a>
    </div>
  </div>`;
}

async function sendEmail(to, subject, html, resendKey) {
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
      subject,
      html,
    }),
  });
  return resp.json();
}

// ── Handler principal ────────────────────────────────────────────────────────
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

      // Genera token de acceso (para descarga o formulario)
      const accessToken = generateToken(product, email, '');

      console.log(`Producto: ${product}, email: ${email}`);

      try {
        const html    = buildEmail(SITE_URL, product, cfg, order, accessToken);
        const subject = `✅ ${cfg.name} — vCISO.cl`;
        const result  = await sendEmail(email, subject, html, RESEND_KEY);
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
