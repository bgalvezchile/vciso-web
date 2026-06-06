
// Envío de email con Resend (free tier: 3.000 emails/mes)
// npm install resend

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, product, order, amount } = req.body;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = 'contacto@vciso.cl';

  const templates = {
    ebook: {
      subject: '📥 Tu Manual de Ciberseguridad para PYMEs — vCISO.cl',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
          <div style="text-align:center;margin-bottom:32px">
            <div style="font-size:2rem;font-weight:900;letter-spacing:-0.02em">v<span style="color:#f47c47">CISO</span>.cl</div>
          </div>
          <h1 style="font-size:1.4rem;margin-bottom:16px">¡Gracias por tu compra! 🎉</h1>
          <p style="color:rgba(255,255,255,0.7);margin-bottom:24px">
            Tu pago de <strong>$5.000 CLP</strong> fue confirmado. Aquí está tu descarga:
          </p>
          <div style="text-align:center;margin:32px 0">
            <a href="${process.env.SITE_URL}/downloads/manual-ciberseguridad-pymes.pdf"
               style="background:#e85d26;color:#fff;padding:16px 32px;border-radius:8px;
                      text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
              📥 Descargar Manual PDF
            </a>
          </div>
          <p style="font-size:0.82rem;color:rgba(255,255,255,0.4)">
            Orden: ${order} · Si tienes problemas, escríbenos a contacto@vciso.cl
          </p>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0"/>
          <p style="font-size:0.75rem;color:rgba(255,255,255,0.3);text-align:center">
            vCISO.cl · Santiago, Chile · contacto@vciso.cl
          </p>
        </div>`,
    },
    diagnostico: {
      subject: '✅ Diagnóstico Express recibido — vCISO.cl',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
          <div style="text-align:center;margin-bottom:32px">
            <div style="font-size:2rem;font-weight:900">v<span style="color:#f47c47">CISO</span>.cl</div>
          </div>
          <h1 style="font-size:1.4rem;margin-bottom:16px">¡Pago confirmado! Tu diagnóstico está en proceso 🔍</h1>
          <p style="color:rgba(255,255,255,0.7);margin-bottom:16px">
            Recibimos tu pago de <strong>$79.000 CLP</strong>.
            Recibirás tu informe ejecutivo en las próximas <strong>24 horas hábiles</strong>.
          </p>
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                      border-radius:10px;padding:20px;margin:24px 0">
            <p style="margin:0;font-size:0.9rem">
              📋 <strong>Próximos pasos:</strong><br/><br/>
              1. Revisaremos tu formulario completado<br/>
              2. Analizaremos tu dominio y postura de seguridad<br/>
              3. Generaremos tu informe personalizado<br/>
              4. Te lo enviaremos a este email antes de 24 horas
            </p>
          </div>
          <p style="font-size:0.82rem;color:rgba(255,255,255,0.4)">
            Orden: ${order} · ¿Dudas? WhatsApp: +56 9 8451 5075
          </p>
        </div>`,
    },
    politicas: {
      subject: '📋 Tus Políticas TI están listas — vCISO.cl',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
          <div style="text-align:center;margin-bottom:32px">
            <div style="font-size:2rem;font-weight:900">v<span style="color:#f47c47">CISO</span>.cl</div>
          </div>
          <h1 style="font-size:1.4rem;margin-bottom:16px">¡Pago confirmado! Generando tus políticas 📋</h1>
          <p style="color:rgba(255,255,255,0.7);margin-bottom:16px">
            Recibimos tu pago de <strong>$29.000 CLP</strong>.
            Tus políticas personalizadas llegarán en los próximos minutos.
          </p>
          <p style="font-size:0.82rem;color:rgba(255,255,255,0.4)">
            Orden: ${order} · ¿Dudas? contacto@vciso.cl
          </p>
        </div>`,
    },
  };

  const tmpl = templates[product] || templates.ebook;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `vCISO.cl <${FROM_EMAIL}>`,
        to: [email],
        bcc: [FROM_EMAIL],  // copia siempre a ti
        subject: tmpl.subject,
        html: tmpl.html,
      }),
    });

    const data = await resp.json();
    if (data.id) {
      return res.json({ ok: true, emailId: data.id });
    } else {
      throw new Error(JSON.stringify(data));
    }
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: 'Error enviando email' });
  }
};
