const crypto = require('crypto');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';
const TOKEN_TTL       = 48 * 60 * 60 * 1000;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length < 4) return null;
    const sig      = parts.pop();
    const rest     = parts.join('|');
    const [product, email, timestamp, empresa] = parts;
    const expected = crypto
      .createHmac('sha256', DOWNLOAD_SECRET)
      .update(rest)
      .digest('hex');
    if (sig !== expected) return null;
    if (Date.now() - parseInt(timestamp) > TOKEN_TTL) return null;
    return { product, email, empresa: empresa || null };
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  const token = req.query.token;
  const info  = token ? verifyToken(token) : null;

  if (!info) {
    return res.status(403).send(`
      <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
      <title>Link inválido — vCISO.cl</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px;
        background:#0d1f3c;color:#fff">
        <h2>⏰ Link expirado o inválido</h2>
        <p style="color:rgba(255,255,255,0.65)">
          Este link ha expirado (válido por 48 horas) o no es válido.
        </p>
        <p>Escríbenos a <a href="mailto:contacto@vciso.cl"
           style="color:#f47c47">contacto@vciso.cl</a>
           o al WhatsApp +56 9 8130 7440 y te enviamos uno nuevo.</p>
        <a href="/"
           style="display:inline-block;margin-top:24px;background:#e85d26;color:#fff;
                  padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">
          Volver al inicio
        </a>
      </body></html>`);
  }

  const watermarkLabel = info.empresa
    ? `Uso exclusivo para ${info.empresa}`
    : `Documento para uso exclusivo de ${info.email}`;

  return res.send(`
    <!DOCTYPE html><html lang="es">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>Descargando tu Manual — vCISO.cl</title>
      <style>
        body { font-family:sans-serif; background:#0d1f3c; color:#fff;
               display:flex; align-items:center; justify-content:center;
               min-height:100vh; padding:24px; margin:0; }
        .card { max-width:480px; width:100%; text-align:center;
                background:rgba(255,255,255,0.05);
                border:1px solid rgba(255,255,255,0.1);
                border-radius:16px; padding:48px 32px; }
        .logo { font-size:1.8rem; font-weight:900; margin-bottom:28px; }
        .logo span { color:#f47c47; }
        h1 { font-size:1.4rem; margin-bottom:12px; }
        p  { color:rgba(255,255,255,0.65); margin-bottom:8px; }
        .wm-tag { background:rgba(232,93,38,0.15); border:1px solid rgba(232,93,38,0.3);
                  color:#f9a97a; padding:6px 14px; border-radius:20px;
                  font-size:0.82rem; display:inline-block; margin:12px 0 24px; }
        .btn { display:inline-block; background:#e85d26; color:#fff;
               padding:16px 32px; border-radius:8px; text-decoration:none;
               font-weight:700; font-size:1rem; }
        .btn:hover { background:#f47c47; }
        .note { font-size:0.75rem; color:rgba(255,255,255,0.3); margin-top:20px; }
        .spinner { display:inline-block; width:20px; height:20px;
                   border:2px solid rgba(255,255,255,0.3); border-top-color:#fff;
                   border-radius:50%; animation:spin 0.7s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">v<span>CISO</span>.cl</div>
        <div style="font-size:3rem;margin-bottom:16px">📥</div>
        <h1>¡Tu descarga está lista!</h1>
        <p>Manual de Ciberseguridad para PYMEs — Edición 2026</p>
        <div class="wm-tag">🔒 ${watermarkLabel}</div>
        <p style="font-size:0.85rem">
          El PDF incluye marca de agua personalizada en cada página.
        </p>
        <div style="margin:28px 0">
          <a href="/api/serve-pdf?token=${token}" class="btn" id="dlBtn">
            📥 Descargar PDF ahora
          </a>
        </div>
        <div id="loading" style="display:none">
          <span class="spinner"></span>
          <span style="margin-left:10px;font-size:0.9rem">Generando tu PDF personalizado...</span>
        </div>
        <p class="note">
          ⏰ Link válido por 48 horas · PDF protegido con marca de agua<br/>
          ¿Problemas? contacto@vciso.cl · WhatsApp +56 9 8130 7440
        </p>
      </div>
      <script>
        document.getElementById('dlBtn').addEventListener('click', function() {
          document.getElementById('loading').style.display = 'block';
          setTimeout(() => { document.getElementById('loading').style.display = 'none'; }, 5000);
        });
        setTimeout(() => { document.getElementById('dlBtn').click(); }, 1200);
      </script>
    </body>
    </html>`);
};
