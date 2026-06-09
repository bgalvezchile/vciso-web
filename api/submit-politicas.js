// api/submit-politicas.js
// Recibe los datos del generador de políticas y notifica a vCISO.cl
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

  const { token, empresa, rut, rubro, ciudad, empleados, vigencia,
          repLegal, repCargo, tiResp, tiCargo, politicasSeleccionadas } = req.body || {};

  const info = token ? verifyToken(token) : null;
  if (!info) return res.status(403).json({ error: 'Token inválido o expirado' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const date = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const politicasHTML = Array.isArray(politicasSeleccionadas)
    ? politicasSeleccionadas.map(p =>
        `<li style="color:rgba(255,255,255,0.7);padding:3px 0">✅ ${p}</li>`
      ).join('')
    : '<li style="color:rgba(255,255,255,0.4)">No especificadas</li>';

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;
                background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
      <div style="font-size:1.6rem;font-weight:900;margin-bottom:4px">
        v<span style="color:#f47c47">CISO</span>.cl
      </div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.3);margin-bottom:28px;
                  text-transform:uppercase;letter-spacing:0.06em">
        Nuevas políticas generadas · ${date}
      </div>

      <h2 style="font-size:1.2rem;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px">
        📋 Políticas TI — <span style="color:#f47c47">${empresa || 'Sin nombre'}</span>
      </h2>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5);width:140px">Empresa</td>
            <td style="padding:6px 8px;color:#fff;font-weight:700">${empresa || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">RUT</td>
            <td style="padding:6px 8px;color:#fff">${rut || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Rubro</td>
            <td style="padding:6px 8px;color:#fff">${rubro || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Ciudad</td>
            <td style="padding:6px 8px;color:#fff">${ciudad || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Empleados</td>
            <td style="padding:6px 8px;color:#fff">${empleados || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Vigencia</td>
            <td style="padding:6px 8px;color:#fff">${vigencia || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Rep. Legal</td>
            <td style="padding:6px 8px;color:#fff">${repLegal || '—'} · ${repCargo || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Resp. TI</td>
            <td style="padding:6px 8px;color:#fff">${tiResp || '—'} · ${tiCargo || '—'}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Email pago</td>
            <td style="padding:6px 8px;color:#fff">${info.email}</td></tr>
      </table>

      <h3 style="font-size:0.85rem;color:rgba(255,255,255,0.5);margin-bottom:10px;
                 text-transform:uppercase;letter-spacing:0.05em">Políticas seleccionadas</h3>
      <ul style="margin:0 0 24px 0;padding-left:0;list-style:none">
        ${politicasHTML}
      </ul>

      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;
                  font-size:0.75rem;color:rgba(255,255,255,0.3)">
        Token de pago verificado · vCISO.cl · contacto@vciso.cl
      </div>
    </div>`;

  try {
    const result = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'vCISO.cl <contacto@vciso.cl>',
        to:      ['contacto@vciso.cl'],
        subject: `📋 Políticas TI generadas — ${empresa || info.email}`,
        html,
      }),
    });
    const data = await result.json();
    console.log('submit-politicas email:', JSON.stringify(data));
    return res.json({ ok: true });
  } catch (err) {
    console.error('submit-politicas error:', err.message);
    return res.status(500).json({ error: 'Error enviando datos' });
  }
};
