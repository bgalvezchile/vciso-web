const crypto   = require('crypto');
const fetch    = require('node-fetch');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso-download-secret-2026';
const TOKEN_TTL       = 48 * 60 * 60 * 1000;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length < 3) return null;
    const sig       = parts.pop();
    const rest      = parts.join('|');
    const [product, email, timestamp] = parts;
    const expected  = crypto
      .createHmac('sha256', DOWNLOAD_SECRET)
      .update(rest)
      .digest('hex');
    if (sig !== expected) return null;
    if (Date.now() - parseInt(timestamp) > TOKEN_TTL) return null;
    return { product, email };
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  const token = req.query.token;
  const info  = token ? verifyToken(token) : null;

  if (!info) {
    return res.status(403).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;
        background:#0d1f3c;color:#fff">
        <h2>⛔ Link inválido o expirado</h2>
        <p>Este link de descarga ha expirado o no es válido.</p>
        <p>Escríbenos a <a href="mailto:contacto@vciso.cl"
           style="color:#f47c47">contacto@vciso.cl</a></p>
      </body></html>`);
  }

  const PDF_URL = process.env.PDF_EBOOK_URL;
  if (!PDF_URL) return res.status(500).json({ error: 'PDF no configurado' });

  try {
    // 1. Descargar PDF original
    const pdfResp = await fetch(PDF_URL);
    const pdfBuffer = await pdfResp.buffer();

    // 2. Cargar con pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const font   = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const pages  = pdfDoc.getPages();

    const watermarkText = `Documento para uso exclusivo de ${info.email}`;
    const fontSize      = 8;
    const color         = rgb(0.55, 0.55, 0.55); // gris medio
    const opacity       = 0.45;

    // 3. Agregar marca en cada página
    pages.forEach(page => {
      const { width, height } = page.getSize();

      // Línea inferior centrada
      const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
      page.drawText(watermarkText, {
        x:        (width - textWidth) / 2,
        y:        18,
        size:     fontSize,
        font,
        color,
        opacity,
      });

      // Marca diagonal central (más visible, difícil de borrar)
      page.drawText(watermarkText, {
        x:        width / 2 - 180,
        y:        height / 2 - 10,
        size:     10,
        font,
        color:    rgb(0.75, 0.75, 0.75),
        opacity:  0.15,
        rotate:   { type: 'degrees', angle: 35 },
      });
    });

    // 4. Serializar y entregar
    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="manual-ciberseguridad-pymes.pdf"`);
    res.setHeader('Content-Length',      pdfBytes.length);
    res.setHeader('Cache-Control',       'no-store, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('serve-pdf error:', err.message);
    return res.status(500).json({ error: 'Error generando PDF' });
  }
};
