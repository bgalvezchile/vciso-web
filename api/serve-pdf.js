const crypto   = require('crypto');
const fetch    = require('node-fetch');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';
const TOKEN_TTL       = 48 * 60 * 60 * 1000;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length < 3) return null;
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
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;
        background:#0d1f3c;color:#fff">
        <h2>⛔ Link inválido o expirado</h2>
        <p>Este link de descarga ha expirado o no es válido.</p>
        <p>Escríbenos a <a href="mailto:contacto@vciso.cl"
           style="color:#f47c47">contacto@vciso.cl</a>
           o por WhatsApp al +56 9 8130 7440</p>
      </body></html>`);
  }

  const PDF_URL = process.env.PDF_EBOOK_URL;
  if (!PDF_URL) return res.status(500).json({ error: 'PDF no configurado' });

  try {
    // 1. Descargar PDF original desde Google Drive
    const pdfResp   = await fetch(PDF_URL);
    const pdfBuffer = await pdfResp.buffer();

    // 2. Cargar con pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const font   = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const pages  = pdfDoc.getPages();

    // Watermark text: si hay empresa usamos nombre de empresa, sino email
    const watermarkLabel = info.empresa
      ? `Uso exclusivo para ${info.empresa}`
      : `Documento para uso exclusivo de ${info.email}`;

    const fontSize   = 8;
    const colorGray  = rgb(0.55, 0.55, 0.55);
    const colorDiag  = rgb(0.75, 0.75, 0.75);

    // 3. Marca de agua en cada página
    pages.forEach(page => {
      const { width, height } = page.getSize();

      // Línea inferior centrada
      const textWidth = font.widthOfTextAtSize(watermarkLabel, fontSize);
      page.drawText(watermarkLabel, {
        x:       (width - textWidth) / 2,
        y:       18,
        size:    fontSize,
        font,
        color:   colorGray,
        opacity: 0.45,
      });

      // Marca diagonal central
      page.drawText(watermarkLabel, {
        x:       width  / 2 - 200,
        y:       height / 2 - 10,
        size:    11,
        font,
        color:   colorDiag,
        opacity: 0.12,
        rotate:  { type: 'degrees', angle: 35 },
      });
    });

    // 4. Nombre de archivo personalizado
    const safeName = info.empresa
      ? info.empresa.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, '').trim().substring(0, 30)
      : 'manual';
    const filename = `manual-ciberseguridad-${safeName}.pdf`
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
      .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o')
      .replace(/[úùü]/g,'u').replace(/ñ/g,'n');

    // 5. Entregar PDF
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type',           'application/pdf');
    res.setHeader('Content-Disposition',    `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',         pdfBytes.length);
    res.setHeader('Cache-Control',          'no-store, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('serve-pdf error:', err.message);
    return res.status(500).json({ error: 'Error generando PDF' });
  }
};
