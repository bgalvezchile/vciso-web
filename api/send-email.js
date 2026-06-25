const crypto = require('crypto');
const fetch  = require('node-fetch');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso-download-secret-2026';

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const { email, product, order, amount } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const SITE_URL   = process.env.SITE_URL || 'https://www.vciso.cl';
  const FROM       = 'vCISO.cl <contacto@vciso.cl>';

  // Generar token de descarga con email del comprador (para watermark)
  const downloadToken = generateDownloadToken(product || 'ebook', email);
  const downloadUrl   = `${SITE_URL}/api/get-download?token=${downloadToken}`;

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
          El PDF incluye tu email como marca de agua personal.
        </p>
        <div style="text-align:center;margin:32px 0">
          <a href="${downloadUrl}"
             style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                    text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
            📥 Descargar mi Manual PDF
          </a>
        </div>
        <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:14px;
                    font-size:0.8rem;color:rgba(255,255,255,0.4)">
          ⏰ Link válido por 48 horas · Orden: ${order || 'N/A'}<br/>
          ¿Necesitas otro link? contacto@vciso.cl · WhatsApp +56 9 8130 7440
        </div></div>`,
    },
    diagnostico: {
      subject: '✅ Diagnóstico Express recibido — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! En proceso 🔍</h1>
        <p style="color:rgba(255,255,255,0.7)">
          Recibimos tu pago de <strong>$89.000 CLP</strong>.<br/>
          Tu informe llegará en las próximas <strong>48 horas hábiles</strong> una vez que completes el formulario.
        </p>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35);margin-top:20px">
          Orden: ${order || 'N/A'} · WhatsApp: +56 9 8130 7440
        </p></div>`,
    },
    politicas: {
      subject: '📋 Tus Políticas TI en proceso — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! 📋</h1>
        <p style="color:rgba(255,255,255,0.7)">
          Recibimos tu pago de <strong>$49.900 CLP</strong>.<br/>
          Tus políticas personalizadas llegarán en menos de 3 minutos.
        </p>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35);margin-top:20px">
          Orden: ${order || 'N/A'} · contacto@vciso.cl
        </p></div>`,
    },
  };

  const tmpl = templates[product] || templates.ebook;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM,
        to:      [email],
        bcc:     ['contacto@vciso.cl'],
        subject: tmpl.subject,
        html:    tmpl.html,
      }),
    });
    const data = await resp.json();
    if (data.id) return res.json({ ok: true, emailId: data.id });
    throw new Error(JSON.stringify(data));
  } catch (err) {
    console.error('send-email error:', err.message);
    return res.status(500).json({ error: 'Error enviando email' });
  }
};
