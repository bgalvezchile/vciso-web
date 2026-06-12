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


// ── ANÁLISIS CLAUDE ───────────────────────────────────────────────────────────
async function analizarConClaude(datos, respuestas, scores) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const madurez = nivelMadurez(scores.global);

  // Preparar resumen de respuestas en lenguaje natural
  const resumen = `
Empresa: ${datos.empresa} (${datos.rubro || 'PYME'})

MÓDULO 1 — IDENTIFICACIÓN:
- Tipos de datos: ${(respuestas.p1||[]).join(', ')}
- Volumen de personas: ${respuestas.p2 || 'no indicado'}
- Responsable definido: ${respuestas.p3 || 'no indicado'}

MÓDULO 2 — BASES DE LICITUD:
- Mecanismo recopilación: ${respuestas.p4 || 'no indicado'}
- Datos de menores: ${respuestas.p4a || 'no indicado'}
- Informa a titulares: ${respuestas.p5 || 'no indicado'}
- Política de privacidad web: ${respuestas.p5a || 'no indicado'}
- Uso para otros fines: ${respuestas.p6 || 'no indicado'}
- Minimización de datos: ${respuestas.p6a || 'no indicado'}

MÓDULO 3 — INVENTARIO Y FLUJO:
- Cláusulas en contratos proveedores: ${respuestas.p7 || 'no indicado'}
- Servicios cloud usados: ${(respuestas.p7a||[]).join(', ') || 'ninguno'}
- Inventario de datos: ${respuestas.p8 || 'no indicado'}
- Proveedores con acceso identificados: ${respuestas.p8a || 'no indicado'}
- Mapa de sistemas: ${respuestas.p9 || 'no indicado'}
- Política de retención: ${respuestas.p10 || 'no indicado'}

MÓDULO 4 — DERECHOS DE TITULARES:
- Capacidad responder solicitudes (30 días): ${respuestas.p11 || 'no indicado'}
- Capacidad eliminar datos: ${respuestas.p12 || 'no indicado'}
- Canal y procedimiento ARCO: ${respuestas.p13 || 'no indicado'}

MÓDULO 5 — SEGURIDAD:
- Medidas implementadas: ${(respuestas.p14||[]).join(', ') || 'ninguna'}
- Clasificación información: ${respuestas.p14a || 'no indicado'}
- Control de accesos: ${respuestas.p15 || 'no indicado'}
- Procedimiento incidentes: ${respuestas.p16 || 'no indicado'}
- Historial incidentes: ${respuestas.p16a || 'no indicado'}
- Capacitación equipo: ${respuestas.p17 || 'no indicado'}

MÓDULO 6 — GOBERNANZA:
- Política privacidad interna: ${respuestas.p18 || 'no indicado'}
- Nivel documentación: ${respuestas.p18a || 'no indicado'}
- Evaluación de riesgos: ${respuestas.p19 || 'no indicado'}

PUNTAJES CALCULADOS:
- Bases de licitud: ${scores.licitud}/100
- Derechos de titulares: ${scores.derechos}/100
- Inventario y gobernanza: ${scores.inventario}/100
- Seguridad técnica: ${scores.seguridad}/100
- Riesgo regulatorio: ${scores.riesgoReg}/100
- GLOBAL: ${scores.global}/100 — ${madurez.nivel}
`;

  const prompt = `Acabas de revisar el cuestionario de diagnóstico de cumplimiento Ley 21.719 completado por la siguiente empresa. Como abogado especialista en la ley Y experto en TI y ciberseguridad, genera un diagnóstico profesional, preciso y útil.

RESPUESTAS DEL CUESTIONARIO:
${resumen}

Genera un diagnóstico de evaluación profesional con la siguiente estructura exacta en JSON:

{
  "resumen_ejecutivo": "Párrafo de 3-4 oraciones que resume el estado general de la empresa respecto a la Ley 21.719. Usa lenguaje directo y comprensible para un gerente de PYME. Menciona el nivel global (${madurez.nivel}) y las áreas más críticas.",
  
  "dimensiones": [
    {
      "nombre": "Bases de licitud y consentimiento",
      "puntaje": ${scores.licitud},
      "nivel": "${nivelMadurez(scores.licitud).nivel}",
      "analisis": "2-3 oraciones analizando específicamente qué hace bien y qué le falta a esta empresa en materia de consentimiento, deber de información y minimización de datos. Menciona aspectos concretos de sus respuestas. Sin jerga legal excesiva."
    },
    {
      "nombre": "Derechos de los titulares",
      "puntaje": ${scores.derechos},
      "nivel": "${nivelMadurez(scores.derechos).nivel}",
      "analisis": "2-3 oraciones sobre su capacidad de responder solicitudes de acceso, rectificación y eliminación. Menciona el plazo de 30 días que exige la ley de forma simple."
    },
    {
      "nombre": "Inventario y gobernanza de datos",
      "puntaje": ${scores.inventario},
      "nivel": "${nivelMadurez(scores.inventario).nivel}",
      "analisis": "2-3 oraciones sobre si la empresa sabe qué datos tiene, dónde están y quién los accede. Si usa servicios en la nube, menciona la implicancia de transferencias internacionales de forma simple."
    },
    {
      "nombre": "Seguridad técnica",
      "puntaje": ${scores.seguridad},
      "nivel": "${nivelMadurez(scores.seguridad).nivel}",
      "analisis": "2-3 oraciones sobre las medidas de protección que tiene y las que le faltan. Menciona si tiene o no protocolo de respuesta ante incidentes y la obligación de notificar a la Agencia en 72 horas cuando corresponda."
    },
    {
      "nombre": "Riesgo regulatorio",
      "puntaje": ${scores.riesgoReg},
      "nivel": "${nivelMadurez(scores.riesgoReg).nivel}",
      "analisis": "2-3 oraciones sobre el nivel de exposición regulatoria considerando el tipo de datos que maneja, el volumen y las brechas detectadas. Menciona que la Agencia de Protección de Datos comenzará a fiscalizar en diciembre 2026."
    }
  ],
  
  "hallazgos_criticos": [
    "Hallazgo crítico 1 — máximo 2 oraciones, lenguaje simple, describe el problema concreto",
    "Hallazgo crítico 2",
    "Hallazgo crítico 3"
  ],
  
  "aspectos_positivos": [
    "Aspecto positivo 1 — qué está haciendo bien la empresa",
    "Aspecto positivo 2"
  ],
  
  "conclusion": "Párrafo final de 2-3 oraciones. Resume el nivel de cumplimiento actual, menciona el plazo de diciembre 2026 y recomienda buscar asesoría especializada para implementar las mejoras necesarias. Tono profesional pero accesible."
}

REGLAS IMPORTANTES:
- Usa lenguaje claro para un dueño de PYME, no para un abogado
- Sé específico con las respuestas del cuestionario, no genérico
- No inventes información que no esté en las respuestas
- Si la empresa tiene aspectos positivos, reconócelos
- Los hallazgos críticos deben ser los más importantes, no todos los problemas
- Máximo 3 hallazgos críticos y 3 aspectos positivos
- Responde SOLO con el JSON, sin texto adicional ni markdown`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: `Eres un profesional con doble especialización: abogado experto en la Ley N° 21.719 de Protección de Datos Personales de Chile y sus normas complementarias, Y experto en tecnologías de la información y ciberseguridad con experiencia práctica en PYMEs chilenas.

Tu rol es evaluar el nivel de cumplimiento de una PYME con la Ley 21.719, combinando el análisis legal del articulado con la perspectiva técnica de cómo se implementan los controles en la práctica.

Principios que guían tu evaluación:
- La Ley 21.719 fue publicada el 13 de diciembre de 2024 y entra en vigencia el 1 de diciembre de 2026
- La Agencia de Protección de Datos Personales (APDP) fiscalizará y sancionará desde esa fecha
- Las PYMEs tienen las mismas obligaciones que las grandes empresas, pero reciben amonestación escrita en su primera infracción leve
- El principio de accountability exige poder DEMOSTRAR el cumplimiento, no solo cumplirlo
- Desde la perspectiva técnica, evalúas si los controles declarados son suficientes y coherentes
- Usas lenguaje accesible para un gerente de PYME, sin perder precisión legal ni técnica
- Eres objetivo: reconoces lo que está bien y señalas lo que falta

Respondes SOLO en JSON válido, sin texto adicional ni markdown.`,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await resp.json();
  if (!data.content || !data.content[0]) throw new Error('Claude no generó análisis');
  
  const texto = data.content[0].text.trim();
  const clean = texto.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
  return JSON.parse(clean);
}

// ── GENERAR PDF ───────────────────────────────────────────────────────────────
function generarPDF(datos, scores, analisis) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 0,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `Diagnóstico Ley 21.719 — ${datos.empresa}`,
          Author: 'vCISO.cl',
          Subject: 'Diagnóstico de Cumplimiento Ley 21.719',
        }
      });

      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end',  () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Constantes
      const PW = 595, PH = 842;
      const ML = 56, MR = 56, MT = 56;
      const CW = PW - ML - MR; // 483
      const NAVY   = '#0D1F3C';
      const BLUE   = '#1E4FAD';
      const ORANGE = '#E85D26';
      const WHITE  = '#FFFFFF';
      const LGRAY  = '#F1F5F9';
      const MGRAY  = '#94A3B8';
      const DGRAY  = '#334155';
      const fecha  = new Date().toLocaleDateString('es-CL', {year:'numeric',month:'long',day:'numeric'});
      const madurez = nivelMadurez(scores.global);

      const COLOR_NIVEL = scores.global >= 80 ? '#16A34A' :
                          scores.global >= 60 ? '#D97706' :
                          scores.global >= 40 ? '#EA580C' : '#DC2626';
      const BG_NIVEL    = scores.global >= 80 ? '#F0FDF4' :
                          scores.global >= 60 ? '#FFFBEB' :
                          scores.global >= 40 ? '#FFF7ED' : '#FEF2F2';

      function colorDim(p) {
        return p >= 80 ? '#16A34A' : p >= 60 ? '#D97706' : p >= 40 ? '#EA580C' : '#DC2626';
      }
      function bgDim(p) {
        return p >= 80 ? '#F0FDF4' : p >= 60 ? '#FFFBEB' : p >= 40 ? '#FFF7ED' : '#FEF2F2';
      }
      function nivelTexto(p) {
        return p >= 80 ? 'Alto cumplimiento' : p >= 60 ? 'Cumplimiento parcial' : p >= 40 ? 'Riesgo relevante' : 'Riesgo critico';
      }

      // ── PORTADA ──────────────────────────────────────────────────────────────
      // Fondo azul marino completo
      doc.rect(0, 0, PW, PH).fill(NAVY);

      // Franja naranja izquierda
      doc.rect(0, 0, 6, PH).fill(ORANGE);

      // Logo superior
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(32)
        .text('vCISO', ML, 60, {continued:true})
        .fillColor(ORANGE).text('.cl');

      doc.fillColor('#94A3B8').font('Helvetica').fontSize(10)
        .text('Servicios profesionales para PYMEs chilenas', ML, 100);

      // Línea separadora
      doc.rect(ML, 120, CW, 1).fill(ORANGE);

      // Título del documento
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(10)
        .text('INFORME DE', ML, 160)
        .fillColor(WHITE).font('Helvetica-Bold').fontSize(26)
        .text('DIAGNOSTICO DE CUMPLIMIENTO', ML, 178)
        .fillColor(ORANGE).font('Helvetica-Bold').fontSize(18)
        .text('Ley N° 21.719 — Proteccion de Datos Personales', ML, 212);

      // Recuadro empresa
      doc.rect(ML, 270, CW, 100).fill('rgba(255,255,255,0.06)').stroke('rgba(255,255,255,0.12)');
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(9).text('EMPRESA EVALUADA', ML + 20, 286);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20).text(datos.empresa, ML + 20, 302);
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(10)
        .text(`${datos.rubro || 'PYME'}   |   Fecha: ${fecha}`, ML + 20, 330)
        .text('Elaborado por: vCISO.cl — Equipo de consultoria', ML + 20, 348);

      // Recuadro puntaje global
      doc.rect(ML, 400, CW, 130).fill('rgba(255,255,255,0.04)').stroke(COLOR_NIVEL);
      doc.rect(ML, 400, 6, 130).fill(COLOR_NIVEL);

      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
        .text('RESULTADO GLOBAL', ML + 24, 418);

      // Puntaje grande
      doc.fillColor(COLOR_NIVEL).font('Helvetica-Bold').fontSize(64)
        .text(`${scores.global}`, ML + 24, 432);
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(14)
        .text('/ 100', ML + 24 + (scores.global >= 100 ? 80 : scores.global >= 10 ? 56 : 36), 462);

      doc.fillColor(COLOR_NIVEL).font('Helvetica-Bold').fontSize(16)
        .text(madurez.nivel, ML + 160, 444);
      doc.fillColor(WHITE).font('Helvetica').fontSize(10)
        .text(madurez.desc, ML + 160, 466, {width: CW - 200});

      // Tabla resumen puntajes en portada
      doc.rect(ML, 552, CW, 24).fill('rgba(255,255,255,0.1)');
      doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(8)
        .text('DIMENSION', ML + 10, 560)
        .text('PUNTAJE', ML + 280, 560)
        .text('NIVEL', ML + 340, 560);

      const dimsPorAtda = [
        ['Bases de licitud y consentimiento', scores.licitud],
        ['Derechos de los titulares', scores.derechos],
        ['Inventario y gobernanza', scores.inventario],
        ['Seguridad tecnica', scores.seguridad],
        ['Riesgo regulatorio', scores.riesgoReg],
      ];

      let py = 580;
      dimsPorAtda.forEach(([nombre, puntaje], i) => {
        if (i % 2 === 0) doc.rect(ML, py - 4, CW, 20).fill('rgba(255,255,255,0.03)');
        const c = colorDim(puntaje);
        doc.fillColor(WHITE).font('Helvetica').fontSize(9).text(nombre, ML + 10, py);
        doc.fillColor(c).font('Helvetica-Bold').fontSize(9).text(`${puntaje}/100`, ML + 280, py);
        doc.fillColor(c).font('Helvetica').fontSize(9).text(nivelTexto(puntaje), ML + 340, py);
        py += 20;
      });

      // Pie de portada
      doc.rect(ML, 800, CW, 1).fill('rgba(255,255,255,0.15)');
      doc.fillColor('#475569').font('Helvetica').fontSize(8)
        .text('Documento confidencial — Uso exclusivo de ' + datos.empresa + ' — vCISO.cl', ML, 812, {width:CW, align:'center'});

      // ── PÁGINA 2: RESUMEN EJECUTIVO + EVALUACIÓN POR DIMENSIÓN ──────────────
      doc.addPage({margin:0, size:'A4'});

      // Header de página
      doc.rect(0, 0, PW, 52).fill(NAVY);
      doc.rect(0, 0, 6, 52).fill(ORANGE);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
        .fillColor('#94A3B8').font('Helvetica').fontSize(9)
        .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);

      let y = 72;

      // Sección: Resumen Ejecutivo
      doc.rect(ML, y, CW, 26).fill(NAVY);
      doc.rect(ML, y, 4, 26).fill(ORANGE);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
        .text('1. Resumen Ejecutivo', ML + 14, y + 7);
      y += 34;

      // Caja de resumen
      const resText = analisis.resumen_ejecutivo || '';
      const resH = doc.heightOfString(resText, {width: CW - 32, fontSize:10}) + 24;
      doc.rect(ML, y, CW, resH).fill(BG_NIVEL).stroke(COLOR_NIVEL);
      doc.rect(ML, y, 4, resH).fill(COLOR_NIVEL);
      doc.fillColor(DGRAY).font('Helvetica').fontSize(10)
        .text(resText, ML + 16, y + 12, {width: CW - 32, lineGap: 3});
      y += resH + 20;

      // Sección: Evaluación por Dimensión
      doc.rect(ML, y, CW, 26).fill(NAVY);
      doc.rect(ML, y, 4, 26).fill(ORANGE);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
        .text('2. Evaluacion por Dimension', ML + 14, y + 7);
      y += 34;

      const dimensiones = analisis.dimensiones || [];
      dimensiones.forEach((d, idx) => {
        const cDim = colorDim(d.puntaje);
        const bgDimColor = bgDim(d.puntaje);
        const analisisText = d.analisis || '';
        const analisisH = doc.heightOfString(analisisText, {width: CW - 32, fontSize: 9.5}) + 16;
        const totalH = 52 + analisisH;

        if (y + totalH > PH - 60) {
          // Nueva página con header
          doc.addPage({margin:0, size:'A4'});
          doc.rect(0, 0, PW, 52).fill(NAVY);
          doc.rect(0, 0, 6, 52).fill(ORANGE);
          doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
            .fillColor('#94A3B8').font('Helvetica').fontSize(9)
            .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
          y = 72;
        }

        // Header dimensión
        doc.rect(ML, y, CW, 30).fill(cDim);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11)
          .text(d.nombre, ML + 14, y + 5, {width: CW - 120, continued: false});
        // Puntaje y nivel a la derecha
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11)
          .text(`${d.puntaje}/100`, ML + CW - 100, y + 5, {width: 90, align:'right'});
        doc.fillColor('rgba(255,255,255,0.8)').font('Helvetica').fontSize(8)
          .text(nivelTexto(d.puntaje), ML + CW - 120, y + 19, {width: 110, align:'right'});
        y += 30;

        // Barra de progreso
        doc.rect(ML, y, CW, 8).fill('#E2E8F0');
        doc.rect(ML, y, CW * (d.puntaje / 100), 8).fill(cDim);
        y += 12;

        // Análisis narrativo
        doc.rect(ML, y, CW, analisisH).fill(bgDimColor);
        doc.rect(ML, y, 3, analisisH).fill(cDim);
        doc.fillColor(DGRAY).font('Helvetica').fontSize(9.5)
          .text(analisisText, ML + 14, y + 8, {width: CW - 28, lineGap: 3});
        y += analisisH + 14;
      });

      // Leyenda
      if (y + 30 > PH - 60) {
        doc.addPage({margin:0, size:'A4'});
        doc.rect(0, 0, PW, 52).fill(NAVY);
        doc.rect(0, 0, 6, 52).fill(ORANGE);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
          .fillColor('#94A3B8').font('Helvetica').fontSize(9)
          .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
        y = 72;
      }

      doc.rect(ML, y, CW, 22).fill(LGRAY).stroke('#CBD5E1');
      doc.fillColor(MGRAY).font('Helvetica').fontSize(8)
        .text('[VERDE] 80-100: Alto cumplimiento   [AMARILLO] 60-79: Cumplimiento parcial   [NARANJA] 40-59: Riesgo relevante   [ROJO] 0-39: Riesgo critico', ML + 10, y + 7, {width: CW - 20});
      y += 32;

      // ── PÁGINA 3: HALLAZGOS + CONCLUSION + CONTEXTO ─────────────────────────
      if (y + 60 > PH - 60) {
        doc.addPage({margin:0, size:'A4'});
        doc.rect(0, 0, PW, 52).fill(NAVY);
        doc.rect(0, 0, 6, 52).fill(ORANGE);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
          .fillColor('#94A3B8').font('Helvetica').fontSize(9)
          .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
        y = 72;
      }

      // Sección: Hallazgos
      doc.rect(ML, y, CW, 26).fill(NAVY);
      doc.rect(ML, y, 4, 26).fill(ORANGE);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
        .text('3. Hallazgos y Aspectos Destacados', ML + 14, y + 7);
      y += 34;

      // Hallazgos críticos
      const hallazgos = analisis.hallazgos_criticos || [];
      if (hallazgos.length) {
        doc.rect(ML, y, CW, 22).fill('#DC2626');
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
          .text('ASPECTOS QUE REQUIEREN ATENCION URGENTE', ML + 14, y + 6);
        y += 26;

        hallazgos.forEach((h, i) => {
          if (y + 50 > PH - 60) {
            doc.addPage({margin:0, size:'A4'});
            doc.rect(0, 0, PW, 52).fill(NAVY);
            doc.rect(0, 0, 6, 52).fill(ORANGE);
            doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
              .fillColor('#94A3B8').font('Helvetica').fontSize(9)
              .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
            y = 72;
          }
          const hh = doc.heightOfString(h, {width: CW - 44, fontSize: 9.5}) + 18;
          doc.rect(ML, y, CW, hh).fill(i % 2 === 0 ? '#FEF2F2' : '#FFF5F5').stroke('#FECACA');
          doc.rect(ML, y, 4, hh).fill('#DC2626');
          doc.fillColor('#DC2626').font('Helvetica-Bold').fontSize(10).text(`${i+1}.`, ML + 10, y + hh/2 - 5);
          doc.fillColor(DGRAY).font('Helvetica').fontSize(9.5)
            .text(h, ML + 26, y + 9, {width: CW - 44, lineGap: 2});
          y += hh + 4;
        });
        y += 10;
      }

      // Aspectos positivos
      const positivos = analisis.aspectos_positivos || [];
      if (positivos.length) {
        if (y + 50 > PH - 60) {
          doc.addPage({margin:0, size:'A4'});
          doc.rect(0, 0, PW, 52).fill(NAVY);
          doc.rect(0, 0, 6, 52).fill(ORANGE);
          doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
            .fillColor('#94A3B8').font('Helvetica').fontSize(9)
            .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
          y = 72;
        }
        doc.rect(ML, y, CW, 22).fill('#16A34A');
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10)
          .text('ASPECTOS POSITIVOS IDENTIFICADOS', ML + 14, y + 6);
        y += 26;

        positivos.forEach((p, i) => {
          const ph = doc.heightOfString(p, {width: CW - 44, fontSize: 9.5}) + 18;
          doc.rect(ML, y, CW, ph).fill(i % 2 === 0 ? '#F0FDF4' : '#F7FEF9').stroke('#BBF7D0');
          doc.rect(ML, y, 4, ph).fill('#16A34A');
          doc.fillColor('#16A34A').font('Helvetica-Bold').fontSize(12).text('OK', ML + 8, y + ph/2 - 6);
          doc.fillColor(DGRAY).font('Helvetica').fontSize(9.5)
            .text(p, ML + 28, y + 9, {width: CW - 44, lineGap: 2});
          y += ph + 4;
        });
        y += 10;
      }

      // Conclusión
      if (y + 80 > PH - 60) {
        doc.addPage({margin:0, size:'A4'});
        doc.rect(0, 0, PW, 52).fill(NAVY);
        doc.rect(0, 0, 6, 52).fill(ORANGE);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
          .fillColor('#94A3B8').font('Helvetica').fontSize(9)
          .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
        y = 72;
      }

      doc.rect(ML, y, CW, 26).fill(NAVY);
      doc.rect(ML, y, 4, 26).fill(ORANGE);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
        .text('4. Conclusion', ML + 14, y + 7);
      y += 34;

      const concText = analisis.conclusion || '';
      const concH = doc.heightOfString(concText, {width: CW - 32, fontSize: 10}) + 24;
      doc.rect(ML, y, CW, concH).fill('#EFF6FF').stroke('#BFDBFE');
      doc.rect(ML, y, 4, concH).fill(BLUE);
      doc.fillColor(DGRAY).font('Helvetica').fontSize(10)
        .text(concText, ML + 16, y + 12, {width: CW - 32, lineGap: 3});
      y += concH + 20;

      // Contexto regulatorio
      if (y + 120 > PH - 60) {
        doc.addPage({margin:0, size:'A4'});
        doc.rect(0, 0, PW, 52).fill(NAVY);
        doc.rect(0, 0, 6, 52).fill(ORANGE);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
          .fillColor('#94A3B8').font('Helvetica').fontSize(9)
          .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
        y = 72;
      }

      doc.rect(ML, y, CW, 26).fill(NAVY);
      doc.rect(ML, y, 4, 26).fill(ORANGE);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
        .text('5. Contexto Regulatorio', ML + 14, y + 7);
      y += 34;

      doc.rect(ML, y, CW, 100).fill('#EFF6FF').stroke('#BFDBFE');
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10)
        .text('Ley N° 21.719 — Proteccion de Datos Personales', ML + 14, y + 10);
      doc.fillColor(DGRAY).font('Helvetica').fontSize(9)
        .text('Publicada el 13 de diciembre de 2024. Entra en plena vigencia el 1 de diciembre de 2026.', ML + 14, y + 26, {width: CW - 28})
        .text('Crea la Agencia de Proteccion de Datos Personales (APDP) con facultades sancionatorias:', ML + 14, y + 42, {width: CW - 28})
        .text('- Infracciones leves: hasta 100 UTM (~$7,5 millones CLP)', ML + 20, y + 56)
        .text('- Infracciones graves: hasta 1.000 UTM (~$75 millones CLP)', ML + 20, y + 68)
        .text('- Infracciones gravisimas: hasta 5.000 UTM (~$375 millones CLP) o 2% de los ingresos anuales', ML + 20, y + 80);
      y += 110;

      // Recomendación de asesoría
      if (y + 60 > PH - 80) {
        doc.addPage({margin:0, size:'A4'});
        doc.rect(0, 0, PW, 52).fill(NAVY);
        doc.rect(0, 0, 6, 52).fill(ORANGE);
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('vCISO.cl', ML, 14)
          .fillColor('#94A3B8').font('Helvetica').fontSize(9)
          .text(`Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}`, ML, 32);
        y = 72;
      }

      doc.rect(ML, y, CW, 52).fill('#F0FDF4').stroke('#BBF7D0');
      doc.rect(ML, y, 4, 52).fill('#16A34A');
      doc.fillColor('#15803D').font('Helvetica-Bold').fontSize(10).text('Recomendacion', ML + 14, y + 8);
      doc.fillColor(DGRAY).font('Helvetica').fontSize(9)
        .text('Para implementar los cambios necesarios, recomendamos contar con el apoyo de un asesor especializado en proteccion de datos personales y ciberseguridad. Un profesional puede acompanar la adecuacion documental, tecnica y legal requerida por la Ley 21.719 antes de diciembre 2026.', ML + 14, y + 24, {width: CW - 28});
      y += 62;

      // Aviso legal
      if (y + 70 > PH - 40) {
        doc.addPage({margin:0, size:'A4'});
        doc.rect(0, 0, PW, 52).fill(NAVY);
        doc.rect(0, 0, 6, 52).fill(ORANGE);
        y = 72;
      }

      doc.rect(ML, y, CW, 68).fill(LGRAY).stroke('#CBD5E1');
      doc.fillColor(MGRAY).font('Helvetica-Bold').fontSize(8).text('AVISO LEGAL', ML + 14, y + 10);
      doc.fillColor(MGRAY).font('Helvetica').fontSize(7.5)
        .text('Este diagnostico constituye una evaluacion preliminar basada exclusivamente en las respuestas proporcionadas por la organizacion. No constituye una auditoria legal, tecnica ni certificacion de cumplimiento de la Ley N° 21.719. Los puntajes y recomendaciones tienen caracter orientativo. Para efectos de cumplimiento formal, se recomienda consultar con un abogado especializado. vCISO.cl no asume responsabilidad por las decisiones adoptadas en base a este informe.', ML + 14, y + 24, {width: CW - 28});
      y += 78;

      // ── FOOTERS EN TODAS LAS PÁGINAS ────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // No poner footer en portada (página 0)
        if (i === range.start) continue;
        doc.rect(0, PH - 28, PW, 28).fill('#080F1E');
        doc.rect(0, PH - 28, 6, 28).fill(ORANGE);
        doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
          .text(
            `Diagnostico Ley 21.719  |  ${datos.empresa}  |  ${fecha}  |  Confidencial  |  vCISO.cl`,
            ML, PH - 18, {width: CW - 60, align: 'left'}
          )
          .text(`Pag. ${i - range.start + 1}`, ML + CW - 40, PH - 18, {width: 50, align: 'right'});
      }

      doc.end();
    } catch(err) { reject(err); }
  });
}

module.exports

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
    const madurez = nivelMadurez(scores.global);

    console.log(`Scores: global=${scores.global}, nivel=${madurez.nivel}`);

    // 2. Análisis con Claude
    console.log('Llamando a Claude para análisis...');
    const analisis = await analizarConClaude({ empresa, rubro }, respuestas, scores);
    console.log('Análisis Claude completado');

    // 3. Generar PDF
    const pdfBuffer  = await generarPDF({ empresa, rubro, email }, scores, analisis);
    const pdfBase64  = pdfBuffer.toString('base64');
    const nombrePDF  = `Diagnostico_Ley21719_${empresa.replace(/[^a-zA-Z0-9]/g,'_')}_vCISO.pdf`;

    // 3. Email al cliente
    const colorNivel = scores.global >= 80 ? '#22c55e' : scores.global >= 60 ? '#f59e0b' : scores.global >= 40 ? '#f97316' : '#ef4444';
    
    const resumenEjecutivo = analisis.resumen_ejecutivo || '';
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
      <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:16px">
        Hola <strong style="color:#fff">${empresa}</strong>, adjunto encontrarás tu informe PDF de cumplimiento con la Ley 21.719.
      </p>
      <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:14px;margin-bottom:16px;font-size:0.85rem;color:rgba(255,255,255,0.7);line-height:1.6;border-left:3px solid ${colorNivel};">
        ${resumenEjecutivo}
      </div>
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
