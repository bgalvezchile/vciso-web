// api/submit-ley21719.js
const crypto = require('crypto');
const fetch  = require('node-fetch');
const PDFDocument = require('pdfkit');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';
const TOKEN_TTL       = 48 * 60 * 60 * 1000;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length < 4) return null;
    const sig      = parts.pop();
    const rest     = parts.join('|');
    const expected = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(rest).digest('hex');
    if (sig !== expected) return null;
    if (Date.now() - parseInt(parts[2]) > TOKEN_TTL) return null;
    return { product: parts[0], email: parts[1] };
  } catch(e) { return null; }
}

// ── MOTOR DE SCORING ─────────────────────────────────────────────────────────
function calcularScoring(r) {
  // Cada dimensión puntúa 0-100
  // Pesos por respuesta definidos por importancia regulatoria

  // 1. BASES DE LICITUD (P4, P4A, P5, P5A, P6, P6A)
  let licitud = 0;
  const s4  = {activo:100, mixto:60, implicito:20, informal:0};
  const s4a = {no:100, si_autorizado:90, nosabe:20, si_sin_mecanismo:0};
  const s5  = {si_completo:100, parcial:40, no:0};
  const s5a = {si_actualizada:100, sin_web:80, si_desactualizada:40, no:0};
  const s6  = {no:100, si_consentimiento:80, nosabe:20, si_sin_consentimiento:0};
  const s6a = {si_criterio:100, generalmente:60, no_evaluado:20, exceso:0};
  licitud = Math.round(
    (s4[r.p4]||0)*0.25 + (s4a[r.p4a]||0)*0.10 + (s5[r.p5]||0)*0.20 +
    (s5a[r.p5a]||0)*0.15 + (s6[r.p6]||0)*0.15 + (s6a[r.p6a]||0)*0.15
  );

  // 2. DERECHOS DE TITULARES (P11, P12, P13)
  const s11 = {si:100, podria:40, no:0};
  const s12 = {si:100, parcial:40, no:0};
  const s13 = {si_ambos:100, canal_sin_proc:40, no:0};
  const derechos = Math.round((s11[r.p11]||0)*0.35 + (s12[r.p12]||0)*0.30 + (s13[r.p13]||0)*0.35);

  // 3. INVENTARIO Y GOBERNANZA (P3, P7, P7A, P8, P8A, P9, P10, P18, P18A, P19)
  const s3   = {si_formal:100, si_informal:50, no:0};
  const s7   = {todos:100, algunos:50, nosabe:10, no:0};
  const s7a  = (() => {
    // Si usa servicios cloud sin saber = riesgo; si no usa = ok; si usa pero no sabe condiciones = riesgo
    if (!r.p7a || r.p7a.length === 0) return 80;
    if (r.p7a.includes('nosabe')) return 10;
    return 60; // usa servicios cloud (transferencia internacional implícita)
  })();
  const s8   = {si_actualizado:100, informal:40, no:0};
  const s8a  = {todos:100, algunos:50, nosabe:10, no:0};
  const s9   = {si:100, parcial:40, no:0};
  const s10  = {si:100, parcial:50, indefinido:10, no:0};
  const s18  = {si_actualizada:100, si_desactualizada:40, no:0};
  const s18a = {documentado_implementado:100, documentado_no_implementado:50, informal:20, no_existe:0};
  const s19  = {si:100, informal:40, no:0};

  const inventario = Math.round(
    (s3[r.p3]||0)*0.08 + (s7[r.p7]||0)*0.12 + s7a*0.08 +
    (s8[r.p8]||0)*0.15 + (s8a[r.p8a]||0)*0.12 + (s9[r.p9]||0)*0.10 +
    (s10[r.p10]||0)*0.10 + (s18[r.p18]||0)*0.10 + (s18a[r.p18a]||0)*0.10 + (s19[r.p19]||0)*0.05
  );

  // 4. SEGURIDAD TÉCNICA (P14, P14A, P15, P16, P16A, P17)
  const medidas = r.p14 || [];
  const s14 = medidas.includes('ninguna') ? 0 :
    Math.min(100, medidas.filter(m => m !== 'ninguna').length * 17);
  const s14a = {si_formal:100, si_informal:50, no:0};
  const s15  = {si:100, parcial:40, no:0};
  const s16  = {si:100, informal:30, no:0};
  const s16a = {no:100, si_gestionado:70, nosabe:20, si_sin_gestion:0};
  const s17  = {si_formal:100, informal:40, no:0};

  const seguridad = Math.round(
    s14*0.25 + (s14a[r.p14a]||0)*0.10 + (s15[r.p15]||0)*0.20 +
    (s16[r.p16]||0)*0.25 + (s16a[r.p16a]||0)*0.10 + (s17[r.p17]||0)*0.10
  );

  // 5. RIESGO REGULATORIO (síntesis + contexto)
  const promedio = Math.round((licitud + derechos + inventario + seguridad) / 4);
  // Penalizaciones por factores de riesgo elevado
  let penalizacion = 0;
  if ((r.p1||[]).includes('sensibles')) penalizacion += 10;
  if ((r.p1||[]).includes('menores') && r.p4a !== 'si_autorizado') penalizacion += 10;
  if (r.p2 === 'mas5000') penalizacion += 5;
  if (r.p16a === 'si_sin_gestion') penalizacion += 10;
  if (r.p16a === 'nosabe') penalizacion += 5;
  const riesgoReg = Math.max(0, promedio - penalizacion);

  const global = Math.round((licitud*0.22 + derechos*0.20 + inventario*0.25 + seguridad*0.20 + riesgoReg*0.13));

  return { licitud, derechos, inventario, seguridad, riesgoReg, global };
}

function nivelMadurez(puntaje) {
  if (puntaje >= 80) return { nivel: 'Alto cumplimiento', color: 'verde', emoji: '🟢', desc: 'Controles implementados y con evidencia suficiente.' };
  if (puntaje >= 60) return { nivel: 'Cumplimiento parcial', color: 'amarillo', emoji: '🟡', desc: 'Controles existentes pero requieren formalización.' };
  if (puntaje >= 40) return { nivel: 'Riesgo relevante', color: 'naranja', emoji: '🟠', desc: 'Existen brechas significativas que deben atenderse.' };
  return { nivel: 'Riesgo crítico', color: 'rojo', emoji: '🔴', desc: 'Posible incumplimiento de obligaciones esenciales.' };
}

// ── DETECTAR RIESGOS PRIORITARIOS ─────────────────────────────────────────────
function detectarRiesgos(r, scores) {
  const riesgos = [];
  
  if (!r.p8 || r.p8 === 'no') riesgos.push({ prioridad: 'ALTA', texto: 'No existe un inventario de datos personales (Registro de Actividades de Tratamiento)', articulo: 'Art. 14 ter' });
  if (!r.p13 || r.p13 === 'no') riesgos.push({ prioridad: 'ALTA', texto: 'No existe canal ni procedimiento para atender derechos de los titulares (acceso, rectificación, eliminación)', articulo: 'Art. 15-22' });
  if (!r.p5 || r.p5 === 'no') riesgos.push({ prioridad: 'ALTA', texto: 'No se informa adecuadamente a los titulares sobre el tratamiento de sus datos', articulo: 'Art. 14' });
  if (!r.p5a || r.p5a === 'no') riesgos.push({ prioridad: 'ALTA', texto: 'El sitio web no cuenta con Política de Privacidad publicada', articulo: 'Art. 14' });
  if ((r.p1||[]).includes('menores') && r.p4a === 'si_sin_mecanismo') riesgos.push({ prioridad: 'ALTA', texto: 'Se tratan datos de menores sin mecanismo formal de autorización parental', articulo: 'Art. 16' });
  if ((r.p1||[]).includes('sensibles') && (!r.p4 || r.p4 === 'informal' || r.p4 === 'implicito')) riesgos.push({ prioridad: 'ALTA', texto: 'Se tratan datos sensibles sin consentimiento explícito verificable', articulo: 'Art. 16' });
  if (!r.p16 || r.p16 === 'no') riesgos.push({ prioridad: 'ALTA', texto: 'No existe procedimiento de gestión de incidentes ni plan de notificación de brechas (plazo legal: 72 horas)', articulo: 'Art. 49-55' });
  
  if (!r.p10 || r.p10 === 'no' || r.p10 === 'indefinido') riesgos.push({ prioridad: 'MEDIA', texto: 'No hay política de retención y eliminación de datos personales', articulo: 'Art. 14 bis' });
  if (!r.p7 || r.p7 === 'no' || r.p7 === 'nosabe') riesgos.push({ prioridad: 'MEDIA', texto: 'Los contratos con proveedores que acceden a datos no incluyen cláusulas de protección', articulo: 'Art. 14 quáter' });
  if ((r.p7a||[]).length > 0 && !(r.p7a||[]).includes('nosabe')) riesgos.push({ prioridad: 'MEDIA', texto: 'Uso de servicios en la nube implica transferencias internacionales de datos que deben ser evaluadas', articulo: 'Art. 27-30' });
  if (!r.p4 || r.p4 === 'implicito' || r.p4 === 'informal') riesgos.push({ prioridad: 'MEDIA', texto: 'El mecanismo de recopilación de datos no garantiza consentimiento válido (libre, específico e inequívoco)', articulo: 'Art. 12-13' });
  if (!r.p18a || r.p18a === 'no_existe' || r.p18a === 'informal') riesgos.push({ prioridad: 'MEDIA', texto: 'La documentación de controles es insuficiente para demostrar cumplimiento ante una fiscalización', articulo: 'Art. 37 (accountability)' });
  
  if (!r.p17 || r.p17 === 'no') riesgos.push({ prioridad: 'BAJA', texto: 'No se realizan capacitaciones en protección de datos para el equipo', articulo: 'Art. 37' });
  if (!r.p14a || r.p14a === 'no') riesgos.push({ prioridad: 'BAJA', texto: 'No existe clasificación de información por nivel de sensibilidad', articulo: 'Art. 14 bis' });
  if (!r.p19 || r.p19 === 'no') riesgos.push({ prioridad: 'BAJA', texto: 'No se han evaluado los riesgos del tratamiento de datos', articulo: 'Art. 14 bis' });

  return riesgos.slice(0, 10); // máximo 10 riesgos
}

// ── GENERAR PLAN DE ACCIÓN ────────────────────────────────────────────────────
function generarPlanAccion(riesgos, scores) {
  const altas  = riesgos.filter(r => r.prioridad === 'ALTA');
  const medias = riesgos.filter(r => r.prioridad === 'MEDIA');
  const bajas  = riesgos.filter(r => r.prioridad === 'BAJA');

  const plan30 = altas.map(r => r.texto);
  const plan60 = medias.map(r => r.texto);
  const plan90 = bajas.map(r => r.texto);

  return { plan30, plan60, plan90 };
}

// ── GENERAR PDF ───────────────────────────────────────────────────────────────
function generarPDF(datos, scores, riesgos, plan) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 60, size: 'A4', info: {
        Title: `Diagnóstico Ley 21.719 — ${datos.empresa}`,
        Author: 'vCISO.cl',
      }});
      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const W = 595 - 120; // ancho útil
      const NAVY  = '#0d1f3c';
      const BLUE  = '#1e4fad';
      const ORANGE= '#e85d26';
      const GRAY  = '#64748b';
      const BLACK = '#1e293b';
      const fecha = new Date().toLocaleDateString('es-CL', {year:'numeric',month:'long',day:'numeric'});
      const madurez = nivelMadurez(scores.global);

      const COLOR_NIVEL = scores.global >= 80 ? '#22c55e' : scores.global >= 60 ? '#f59e0b' : scores.global >= 40 ? '#f97316' : '#ef4444';

      // ── PORTADA ──
      doc.rect(0, 0, 595, 280).fill(NAVY);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(28).text('vCISO.cl', 60, 60);
      doc.fillColor(ORANGE).font('Helvetica').fontSize(11).text('Ciberseguridad para PYMEs chilenas', 60, 96);
      doc.moveTo(60, 116).lineTo(535, 116).strokeColor(ORANGE).lineWidth(2).stroke();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('DIAGNÓSTICO DE CUMPLIMIENTO', 60, 130);
      doc.fontSize(16).text('LEY N° 21.719 — PROTECCIÓN DE DATOS PERSONALES', 60, 158);
      doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(12)
        .text(datos.empresa, 60, 196)
        .text(datos.rubro || 'Empresa', 60, 214)
        .text(`Fecha: ${fecha}`, 60, 232);

      // Puntaje global en portada
      doc.roundedRect(60, 250, 475, 80, 8).fill('rgba(255,255,255,0.08)');
      doc.fillColor(COLOR_NIVEL).font('Helvetica-Bold').fontSize(36).text(`${scores.global}`, 80, 262);
      doc.fillColor('#ffffff').font('Helvetica').fontSize(11).text('/100', 80 + (scores.global >= 100 ? 58 : scores.global >= 10 ? 38 : 18), 275);
      doc.fillColor(COLOR_NIVEL).font('Helvetica-Bold').fontSize(14).text(madurez.nivel, 160, 262);
      doc.fillColor('rgba(255,255,255,0.65)').font('Helvetica').fontSize(10).text(madurez.desc, 160, 280);

      doc.addPage();

      // ── SECCIÓN 1: SCORING POR DIMENSIÓN ──
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('1. Evaluación por Dimensión', 60, 60);
      doc.moveTo(60, 82).lineTo(535, 82).strokeColor(ORANGE).lineWidth(1.5).stroke();

      const dimensiones = [
        { nombre: 'Bases de licitud y consentimiento', puntaje: scores.licitud },
        { nombre: 'Derechos de los titulares', puntaje: scores.derechos },
        { nombre: 'Inventario y gobernanza', puntaje: scores.inventario },
        { nombre: 'Seguridad técnica', puntaje: scores.seguridad },
        { nombre: 'Riesgo regulatorio', puntaje: scores.riesgoReg },
      ];

      let y = 100;
      dimensiones.forEach(d => {
        const nivel = nivelMadurez(d.puntaje);
        const barColor = d.puntaje >= 80 ? '#22c55e' : d.puntaje >= 60 ? '#f59e0b' : d.puntaje >= 40 ? '#f97316' : '#ef4444';
        
        doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(10).text(d.nombre, 60, y);
        doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(nivel.nivel, 300, y);
        doc.fillColor(barColor).font('Helvetica-Bold').fontSize(10).text(`${d.puntaje}/100`, 470, y);
        
        // Barra de progreso
        doc.rect(60, y + 14, W, 8).fill('#f1f5f9');
        doc.rect(60, y + 14, W * (d.puntaje / 100), 8).fill(barColor);
        
        y += 36;
      });

      // Leyenda
      y += 10;
      doc.rect(60, y, W, 36).fill('#f8fafc').stroke('#e2e8f0');
      doc.fillColor(GRAY).font('Helvetica').fontSize(8)
        .text('🟢 80-100: Alto cumplimiento   🟡 60-79: Cumplimiento parcial   🟠 40-59: Riesgo relevante   🔴 0-39: Riesgo crítico', 70, y + 14);

      // ── SECCIÓN 2: RIESGOS PRIORITARIOS ──
      y += 60;
      if (y > 680) { doc.addPage(); y = 60; }
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('2. Riesgos Prioritarios Detectados', 60, y);
      doc.moveTo(60, y + 22).lineTo(535, y + 22).strokeColor(ORANGE).lineWidth(1.5).stroke();
      y += 36;

      riesgos.forEach(r => {
        if (y > 720) { doc.addPage(); y = 60; }
        const prioColor = r.prioridad === 'ALTA' ? '#ef4444' : r.prioridad === 'MEDIA' ? '#f59e0b' : '#64748b';
        const prioText  = r.prioridad === 'ALTA' ? '● ALTA' : r.prioridad === 'MEDIA' ? '● MEDIA' : '● BAJA';
        
        doc.rect(60, y, W, 38).fill(r.prioridad === 'ALTA' ? '#fef2f2' : r.prioridad === 'MEDIA' ? '#fffbeb' : '#f8fafc').stroke('#e2e8f0');
        doc.fillColor(prioColor).font('Helvetica-Bold').fontSize(8).text(prioText, 70, y + 6);
        doc.fillColor(GRAY).fontSize(7).text(r.articulo, W - 10, y + 6, {align:'right'});
        doc.fillColor(BLACK).font('Helvetica').fontSize(9).text(r.texto, 70, y + 18, {width: W - 20});
        y += 46;
      });

      // ── SECCIÓN 3: PLAN DE ACCIÓN ──
      doc.addPage();
      y = 60;
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('3. Plan de Acción Recomendado', 60, y);
      doc.moveTo(60, y + 22).lineTo(535, y + 22).strokeColor(ORANGE).lineWidth(1.5).stroke();
      y += 40;

      const periodos = [
        { titulo: 'Primeros 30 días — Prioridad ALTA', items: plan.plan30, color: '#ef4444', bg: '#fef2f2' },
        { titulo: 'Días 31 a 60 — Prioridad MEDIA', items: plan.plan60, color: '#f59e0b', bg: '#fffbeb' },
        { titulo: 'Días 61 a 90 — Prioridad BAJA', items: plan.plan90, color: '#64748b', bg: '#f8fafc' },
      ];

      periodos.forEach(p => {
        if (!p.items.length) return;
        if (y > 680) { doc.addPage(); y = 60; }
        doc.rect(60, y, W, 22).fill(p.color).stroke();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(p.titulo, 70, y + 6);
        y += 28;
        p.items.forEach(item => {
          if (y > 720) { doc.addPage(); y = 60; }
          doc.rect(60, y, W, 26).fill(p.bg).stroke('#e2e8f0');
          doc.fillColor(BLACK).font('Helvetica').fontSize(9).text(`→  ${item}`, 70, y + 8, {width: W - 20});
          y += 30;
        });
        y += 12;
      });

      // ── SECCIÓN 4: CONTEXTO REGULATORIO ──
      if (y > 600) { doc.addPage(); y = 60; }
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text('4. Contexto Regulatorio', 60, y);
      doc.moveTo(60, y + 22).lineTo(535, y + 22).strokeColor(ORANGE).lineWidth(1.5).stroke();
      y += 36;

      doc.rect(60, y, W, 100).fill('#eff6ff').stroke('#bfdbfe');
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10).text('Ley N° 21.719 — Protección de Datos Personales', 70, y + 10);
      doc.fillColor(BLACK).font('Helvetica').fontSize(9)
        .text('Publicada el 13 de diciembre de 2024. Entra en plena vigencia el 1 de diciembre de 2026.', 70, y + 26, {width: W - 20})
        .text('Crea la Agencia de Protección de Datos Personales (APDP) con facultades sancionatorias:', 70, y + 42, {width: W - 20})
        .text('• Infracciones leves: hasta 100 UTM (~$7,5 millones)', 80, y + 56)
        .text('• Infracciones graves: hasta 1.000 UTM (~$75 millones)', 80, y + 68)
        .text('• Infracciones gravísimas: hasta 5.000 UTM (~$375 millones) o 2% de los ingresos anuales', 80, y + 80);
      y += 116;

      // Recomendación asesor
      if (y > 680) { doc.addPage(); y = 60; }
      doc.rect(60, y, W, 60).fill('#f0fdf4').stroke('#bbf7d0');
      doc.fillColor('#15803d').font('Helvetica-Bold').fontSize(10).text('Recomendación', 70, y + 10);
      doc.fillColor(BLACK).font('Helvetica').fontSize(9)
        .text('Para implementar las acciones identificadas en este diagnóstico, recomendamos contar con el apoyo de un asesor especializado en protección de datos personales y ciberseguridad. Un profesional puede acompañar la adecuación documental, técnica y legal requerida por la Ley 21.719.', 70, y + 24, {width: W - 20});
      y += 76;

      // ── AVISO LEGAL ──
      if (y > 680) { doc.addPage(); y = 60; }
      doc.rect(60, y, W, 70).fill('#f8fafc').stroke('#e2e8f0');
      doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(8).text('AVISO LEGAL', 70, y + 10);
      doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
        .text('Este diagnóstico constituye una evaluación preliminar basada exclusivamente en las respuestas proporcionadas por la organización. No constituye una auditoría legal, técnica ni certificación de cumplimiento de la Ley N° 21.719 de Protección de Datos Personales. Los puntajes y recomendaciones tienen carácter orientativo. Para efectos de cumplimiento formal, se recomienda consultar con un abogado especializado. vCISO.cl no asume responsabilidad por las decisiones adoptadas en base a este informe.', 70, y + 22, {width: W - 20});

      // Footer en cada página
      const totalPages = doc.bufferedPageRange().count + 1;
      for (let i = 0; i < doc._pageBuffer.length; i++) {
        doc.switchToPage(i);
        doc.fillColor(GRAY).font('Helvetica').fontSize(7)
          .text(`Diagnóstico Ley 21.719 · ${datos.empresa} · ${fecha} · Confidencial · vCISO.cl`, 60, 810, {width: W, align:'center'});
      }

      doc.end();
    } catch(err) { reject(err); }
  });
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, empresa, email, rubro, respuestas } = req.body || {};

  const info = token ? verifyToken(token) : null;
  if (!info) return res.status(403).json({ error: 'Token inválido o expirado' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const fecha = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  console.log(`Diagnóstico Ley 21.719 para: ${empresa}`);

  try {
    // 1. Calcular scoring
    const scores  = calcularScoring(respuestas);
    const riesgos = detectarRiesgos(respuestas, scores);
    const plan    = generarPlanAccion(riesgos, scores);
    const madurez = nivelMadurez(scores.global);

    console.log(`Scores: global=${scores.global}, nivel=${madurez.nivel}`);

    // 2. Generar PDF
    const pdfBuffer  = await generarPDF({ empresa, rubro, email }, scores, riesgos, plan);
    const pdfBase64  = pdfBuffer.toString('base64');
    const nombrePDF  = `Diagnostico_Ley21719_${empresa.replace(/[^a-zA-Z0-9]/g,'_')}_vCISO.pdf`;

    // 3. Email al cliente
    const colorNivel = scores.global >= 80 ? '#22c55e' : scores.global >= 60 ? '#f59e0b' : scores.global >= 40 ? '#f97316' : '#ef4444';
    
    const dimensionesHTML = [
      ['Bases de licitud', scores.licitud],
      ['Derechos de titulares', scores.derechos],
      ['Inventario y gobernanza', scores.inventario],
      ['Seguridad técnica', scores.seguridad],
      ['Riesgo regulatorio', scores.riesgoReg],
    ].map(([nombre, puntaje]) => {
      const color = puntaje >= 80 ? '#22c55e' : puntaje >= 60 ? '#f59e0b' : puntaje >= 40 ? '#f97316' : '#ef4444';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:0.85rem;color:rgba(255,255,255,0.75);">${nombre}</span>
        <span style="font-size:0.9rem;font-weight:700;color:${color};">${puntaje}/100</span>
      </div>`;
    }).join('');

    const htmlEmail = `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
      <div style="font-size:1.6rem;font-weight:900;margin-bottom:4px">v<span style="color:#f47c47">CISO</span>.cl</div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.3);margin-bottom:28px;text-transform:uppercase;letter-spacing:0.06em">Diagnóstico Ley 21.719 · ${fecha}</div>
      <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:8px">Tu diagnóstico de cumplimiento está listo</h2>
      <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:24px">
        Hola <strong style="color:#fff">${empresa}</strong>, adjunto encontrarás tu informe PDF de cumplimiento con la Ley 21.719.
      </p>
      <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:20px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:2.5rem;font-weight:900;color:${colorNivel};">${scores.global}</div>
          <div>
            <div style="font-size:1rem;font-weight:700;color:${colorNivel};">${madurez.nivel}</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);">Puntaje global / 100</div>
          </div>
        </div>
        ${dimensionesHTML}
      </div>
      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:14px;margin-bottom:24px;text-align:center">
        <div style="font-size:0.88rem;color:#86efac;font-weight:700;">📄 Informe PDF adjunto — ${nombrePDF}</div>
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-top:4px;">Incluye scoring detallado, riesgos prioritarios y plan de acción a 90 días</div>
      </div>
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:14px;margin-bottom:24px;">
        <div style="font-size:0.82rem;color:#fcd34d;font-weight:600;margin-bottom:6px;">⏰ Recuerda: plazo de adecuación</div>
        <div style="font-size:0.8rem;color:rgba(255,255,255,0.6);">La Ley 21.719 entra en plena vigencia el <strong style="color:#fff">1 de diciembre de 2026</strong>. Te recomendamos iniciar tu proceso de adecuación con anticipación.</div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;font-size:0.72rem;color:rgba(255,255,255,0.25);line-height:1.7">
        <strong style="color:rgba(255,255,255,0.4)">Aviso:</strong> Este diagnóstico es una evaluación preliminar orientativa. No constituye auditoría legal ni certificación de cumplimiento. Para implementación, consulta con un asesor especializado.
      </div>
      <div style="margin-top:12px;font-size:0.75rem;color:rgba(255,255,255,0.3)">
        contacto@vciso.cl · WhatsApp +56 9 8130 7440 · <a href="https://www.vciso.cl" style="color:rgba(255,255,255,0.3)">www.vciso.cl</a>
      </div>
    </div>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'vCISO.cl <contacto@vciso.cl>',
        to: [email],
        bcc: ['contacto@vciso.cl'],
        subject: `📊 Diagnóstico Ley 21.719 — ${empresa} — Puntaje: ${scores.global}/100 | vCISO.cl`,
        html: htmlEmail,
        attachments: [{ filename: nombrePDF, content: pdfBase64 }],
      }),
    });

    console.log('Email enviado con PDF adjunto');
    return res.json({ ok: true });

  } catch(err) {
    console.error('submit-ley21719 error:', err.message, err.stack);
    return res.status(500).json({ error: 'Error procesando diagnóstico' });
  }
};
