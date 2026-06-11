// api/upload-propuesta.js
// Recibe un archivo y lo sube a Vercel Blob
const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    console.log('BLOB TOKEN existe:', !!process.env.BLOB_READ_WRITE_TOKEN);
    // Vercel maneja multipart/form-data automáticamente
    // El archivo viene en req.body como Buffer cuando se usa formidable
    // Pero en Vercel serverless usamos el approach directo con streams
    
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    
    // Extraer el archivo del multipart manualmente
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    
    if (!boundary) return res.status(400).json({ error: 'No boundary' });
    
    const bodyStr = buffer.toString('binary');
    const parts = bodyStr.split('--' + boundary);
    
    let fileBuffer = null;
    let fileName   = 'propuesta.pdf';
    let mimeType   = 'application/pdf';
    let provNombre = '';
    
    for (const part of parts) {
      if (part.includes('Content-Disposition')) {
        if (part.includes('filename=')) {
          // Es el archivo
          const fnMatch = part.match(/filename="([^"]+)"/);
          if (fnMatch) fileName = fnMatch[1];
          const ctMatch = part.match(/Content-Type: ([^\r\n]+)/);
          if (ctMatch) mimeType = ctMatch[1].trim();
          
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const fileContent = part.substring(headerEnd + 4, part.length - 2);
            fileBuffer = Buffer.from(fileContent, 'binary');
          }
        } else if (part.includes('name="nombre"')) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            provNombre = part.substring(headerEnd + 4, part.length - 2).trim();
          }
        }
      }
    }
    
    if (!fileBuffer) return res.status(400).json({ error: 'No file found' });
    
    // Subir a Vercel Blob
    const timestamp = Date.now();
    const safeName  = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobName  = `propuestas/${timestamp}_${safeName}`;
    
    const blob = await put(blobName, fileBuffer, {
      access: 'public',
      contentType: mimeType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    console.log(`Archivo subido: ${blob.url}`);
    return res.json({ ok: true, url: blob.url, fileName });
    
  } catch(err) {
    console.error('upload-propuesta error:', err.message);
    return res.status(500).json({ error: 'Error subiendo archivo: ' + err.message });
  }
};
