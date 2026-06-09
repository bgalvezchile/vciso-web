// api/submit-dominio.js
// Recibe datos del análisis de dominio y notifica a vCISO.cl
const crypto = require('crypto');
const fetch  = require('node-fetch');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';
const TOKEN_TTL       = 48 * 60 * 60 * 1000;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length < 4) return null;
    const sig      = parts.pop();
    const rest     = parts.join('|');
    const [product, email, timestamp] = parts;
    const expected = crypto
      .createHmac('sha256', DOWNLOAD_SECRET)
      .update(rest)
      .digest('hex');
    if (sig !== expected) return null;
    if (Date.now() - parseInt(timestamp) > TOKEN_TTL) return null;
    return { product, email };
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { token, dominio, empresa, contacto, email } = req.body || {};

  const info = token ? verifyToken(token) : null;
  if (!info) return res.status(403).json({ error: 'Token inválido o expirado' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const date = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;
                background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
      <div style="font-size:1.6rem;font-weight:900;margin-bottom:4px">
        v<span style="color:#f47c47">CISO</span>.cl
      </div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.3);margin-bottom:28px;
                  text-transform:uppercase;letter-spacing:0.06em">
        Nuevo análisis de dominio · ${date}
      </div>
      <h2 style="font-size:1.2rem;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px">
        🌐 Análisis de Dominio — <span style="color:#f47c47">${dominio || '—'}</span>
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5);width:120px">Dominio</td>
            <td style="padding:6px 8px;color:#fff;font-weight:700">${dominio || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Empresa</td>
            <td style="padding:6px 8px;color:#fff">${empresa || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Contacto</td>
            <td style="padding:6px 8px;color:#fff">${contacto || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Email</td>
            <td style="padding:6px 8px;color:#fff">${email || info.email}</td></tr>
      </table>
      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;
                  font-size:0.75rem;color:rgba(255,255,255,0.3)">
        Pago verificado · $49.000 CLP · vCISO.cl
      </div>
    </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'vCISO.cl <contacto@vciso.cl>',
        to:      ['contacto@vciso.cl'],
        subject: `🌐 Análisis Dominio — ${dominio || info.email}`,
        html,
      }),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('submit-dominio error:', err.message);
    return res.status(500).json({ error: 'Error enviando datos' });
  }
};
