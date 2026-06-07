const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const { email, product, order, amount } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const SITE_URL   = process.env.SITE_URL || 'https://www.vciso.cl';
  const FROM       = 'vCISO.cl <contacto@vciso.cl>';

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
          <a href="${SITE_URL}/public/downloads/manual-ciberseguridad-pymes.pdf"
             style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                    text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
            📥 Descargar Manual PDF
          </a>
        </div>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35)">
          Orden: ${order || 'N/A'}<br/>
          ¿Problemas? contacto@vciso.cl · WhatsApp +56 9 8451 5075
        </p></div>`,
    },
    diagnostico: {
      subject: '✅ Diagnóstico Express recibido — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! En proceso 🔍</h1>
        <p style="color:rgba(255,255,255,0.7);margin-bottom:16px">
          Recibimos tu pago de <strong>$79.000 CLP</strong>.<br/>
          Tu informe llegará en las próximas <strong>24 horas hábiles</strong>.
        </p>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35)">
          Orden: ${order || 'N/A'} · WhatsApp: +56 9 8451 5075
        </p></div>`,
    },
    politicas: {
      subject: '📋 Tus Políticas TI en proceso — vCISO.cl',
      html: base + `
        <h1 style="font-size:1.3rem;margin-bottom:12px">¡Pago confirmado! Generando políticas 📋</h1>
        <p style="color:rgba(255,255,255,0.7);margin-bottom:16px">
          Recibimos tu pago de <strong>$29.000 CLP</strong>.<br/>
          Tus políticas personalizadas llegarán pronto a este email.
        </p>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.35)">
          Orden: ${order || 'N/A'} · contacto@vciso.cl
        </p></div>`,
    },
  };

  const tmpl = templates[product] || templates.ebook;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
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
