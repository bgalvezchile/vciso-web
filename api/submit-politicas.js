// api/submit-politicas.js
// Recibe selección de políticas → Claude redacta cada una → genera Word(s) → envía email al cliente
const crypto = require('crypto');
const fetch  = require('node-fetch');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageBreak
} = require('docx');

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'vciso2026supersecreto';
const TOKEN_TTL       = 48 * 60 * 60 * 1000;

// ── Verificar token ────────────────────────────────────────────────────────
function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts   = decoded.split('|');
    if (parts.length < 4) return null;
    const sig      = parts.pop();
    const rest     = parts.join('|');
    const [product, email, timestamp] = parts;
    const expected = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(rest).digest('hex');
    if (sig !== expected) return null;
    if (Date.now() - parseInt(timestamp) > TOKEN_TTL) return null;
    return { product, email };
  } catch(e) { return null; }
}

// ── Colores Word ───────────────────────────────────────────────────────────
const NAVY    = "0D1F3C";
const BLUE    = "1E4FAD";
const ORANGE  = "E85D26";
const WHITE   = "FFFFFF";
const GRAY_BG = "F1F5F9";
const GRAY_TX = "475569";

// ── Helpers Word ───────────────────────────────────────────────────────────
const bdr  = (c="CCCCCC") => ({ style: BorderStyle.SINGLE, size: 1, color: c });
const bdrs = (c="CCCCCC") => ({ top:bdr(c), bottom:bdr(c), left:bdr(c), right:bdr(c) });

const cell = (children, opts={}) => new TableCell({
  borders: bdrs(opts.bc || "CCCCCC"),
  width: { size: opts.w || 4680, type: WidthType.DXA },
  shading: opts.bg ? { fill: opts.bg, type: ShadingType.CLEAR } : undefined,
  margins: { top: 100, bottom: 100, left: 160, right: 160 },
  verticalAlign: opts.va || VerticalAlign.CENTER,
  children,
});

const p = (text, opts={}) => new Paragraph({
  alignment: opts.align || AlignmentType.LEFT,
  spacing: { before: opts.sb||0, after: opts.sa||80 },
  children: [new TextRun({
    text, bold:opts.bold||false, italics:opts.italic||false,
    size:opts.size||20, color:opts.color||"000000", font:"Arial"
  })]
});

const p2 = (runs, opts={}) => new Paragraph({
  alignment: opts.align || AlignmentType.LEFT,
  spacing: { before:opts.sb||0, after:opts.sa||80 },
  children: runs,
});

const t = (text, opts={}) => new TextRun({
  text, bold:opts.bold||false, italics:opts.italic||false,
  size:opts.size||20, color:opts.color||"000000", font:"Arial"
});

const empty = () => new Paragraph({ children:[new TextRun({ text:"" })] });

// ── Nombres de políticas ──────────────────────────────────────────────────
const POLICY_NAMES = {
  uso_aceptable:       "Política de Uso Aceptable de Recursos TI",
  contrasenas:         "Política de Contraseñas e Identidad Digital",
  byod:                "Política de Dispositivos Móviles y BYOD",
  respaldos:           "Política de Respaldos y Recuperación de Información",
  datos_personales:    "Política de Protección de Datos Personales",
  acceso_remoto:       "Política de Acceso Remoto y Teletrabajo",
  proveedores:         "Política de Gestión de Proveedores TI",
  clasificacion_info:  "Política de Clasificación de Información",
  respuesta_incidentes:"Política de Respuesta a Incidentes de Seguridad",
  redes_sociales:      "Política de Uso de Redes Sociales",
  uso_ia:              "Política de Uso de Inteligencia Artificial",
};

const POLICY_CODES = {
  uso_aceptable:       "POL-TI-001",
  contrasenas:         "POL-TI-002",
  byod:                "POL-TI-003",
  respaldos:           "POL-TI-004",
  datos_personales:    "POL-TI-005",
  acceso_remoto:       "POL-TI-006",
  proveedores:         "POL-TI-007",
  clasificacion_info:  "POL-TI-008",
  respuesta_incidentes:"POL-TI-009",
  redes_sociales:      "POL-TI-010",
  uso_ia:              "POL-TI-011",
};

// ── Llamar a Claude para generar políticas (en lotes de 5-6) ─────────────────
async function generarLotePoliticas(politicas, datos, contexto) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const todosContextos = Object.entries(contexto)
    .filter(([, v]) => v && (typeof v === 'string' ? v.trim() : v.length > 0))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n') || 'Sin contexto adicional';

  const listaPoliticas = politicas.map(k => `- ${k}: ${POLICY_NAMES[k]}`).join('\n');

  const userPrompt = `Redacta las siguientes políticas de seguridad TI para la empresa indicada.

## DATOS DE LA EMPRESA
- Empresa: ${datos.empresa}
- Rubro: ${datos.rubro}
- Empleados: ${datos.empleados}
- Modalidad: ${datos.modalidad}
- Área TI: ${datos.deptTI}
- Plataforma tecnológica: ${datos.plataforma}
- Tipo de equipos: ${datos.equipos}

## POLÍTICAS A REDACTAR
${listaPoliticas}

## CONTEXTO ESPECÍFICO DEL CLIENTE
${todosContextos}

## INSTRUCCIONES
Redacta las políticas en un JSON con esta estructura exacta (solo JSON válido, sin markdown):

{
  "politicas": {
    "clave_politica": {
      "objetivo": "2-3 oraciones contextualizadas a la empresa.",
      "alcance": "2-3 oraciones sobre a quiénes aplica y qué cubre.",
      "definiciones": [
        {"termino": "Término", "definicion": "Definición clara en lenguaje no técnico"}
      ],
      "responsabilidades": [
        {"rol": "Gerencia", "responsabilidad": "Descripción concreta"},
        {"rol": "Empleados", "responsabilidad": "Descripción concreta"},
        {"rol": "Área TI / Proveedor TI", "responsabilidad": "Descripción concreta"}
      ],
      "lineamientos": [
        {"titulo": "Título descriptivo", "contenido": "3-4 oraciones con reglas concretas y específicas para esta empresa."}
      ],
      "sanciones": "Párrafo sobre consecuencias del incumplimiento.",
      "revision": "Párrafo sobre revisión anual."
    }
  }
}

REGLAS ESTRICTAS:
- Exactamente 5 lineamientos por política. Concretos y específicos para ${datos.empresa}.
- Exactamente 4 definiciones por política en lenguaje no técnico.
- Adaptar TODO al contexto: rubro (${datos.rubro}), ${datos.empleados} empleados, modalidad (${datos.modalidad}).
- Para datos_personales: mencionar Ley 21.719 y Agencia de Protección de Datos Personales.
- NUNCA mencionar IA ni Claude. La empresa que elabora es vCISO.cl.
- Tono profesional, constructivo, no alarmista.
- Las claves del JSON deben ser EXACTAMENTE: ${politicas.map(k => '"'+k+'"').join(', ')}.
- Devolver SOLO el JSON válido, sin texto adicional ni markdown.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 16000,
      system: `Eres un consultor senior en ciberseguridad especializado en PYMEs chilenas. Elaboras políticas de seguridad TI profesionales basadas en ISO 27002:2022.
REGLAS: Español chileno formal. Lenguaje claro para empleados sin conocimientos técnicos. Políticas concretas y proporcionales al tamaño de la empresa. NUNCA mencionar Claude ni IA. La empresa que elabora es vCISO.cl. Devolver SOLO JSON válido sin markdown.`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await resp.json();
  if (!data.content || !data.content[0]) throw new Error('Claude no respondió');

  const texto = data.content[0].text.trim();
  const clean = texto.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
  const parsed = JSON.parse(clean);
  return parsed.politicas || parsed;
}

async function generarTodasPoliticas(politicas, datos, contexto) {
  // Dividir en dos lotes para evitar timeout
  const mitad = Math.ceil(politicas.length / 2);
  const lote1 = politicas.slice(0, mitad);
  const lote2 = politicas.slice(mitad);

  console.log(`Lote 1: ${lote1.join(', ')}`);
  const resultado1 = await generarLotePoliticas(lote1, datos, contexto);

  let resultado2 = {};
  if (lote2.length > 0) {
    console.log(`Lote 2: ${lote2.join(', ')}`);
    resultado2 = await generarLotePoliticas(lote2, datos, contexto);
  }

  return { ...resultado1, ...resultado2 };
}

// ── Generar Word de UNA política ──────────────────────────────────────────
async function generarWordPolitica(polKey, datos, contenido) {
  const polName = POLICY_NAMES[polKey];
  const polCode = POLICY_CODES[polKey];
  const fecha   = new Date().toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' });
  const fechaRevision = new Date(Date.now() + 365*24*60*60*1000).toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' });

  const children = [];

  // ── ENCABEZADO ──
  children.push(p2([
    t("v", {bold:true, size:52, color:NAVY}),
    t("CISO", {bold:true, size:52, color:ORANGE}),
    t(".cl", {bold:true, size:52, color:NAVY}),
  ], { align:AlignmentType.CENTER, sb:400, sa:80 }));

  children.push(p("Ciberseguridad para PYMEs chilenas", {
    align:AlignmentType.CENTER, size:18, color:GRAY_TX, sa:60
  }));

  children.push(p2([], {
    sb:100, sa:100,
    border:{ bottom:{ style:BorderStyle.SINGLE, size:8, color:ORANGE, space:1 } }
  }));

  children.push(p(polName, {
    align:AlignmentType.CENTER, bold:true, size:32, color:NAVY, sb:280, sa:120
  }));

  children.push(p(datos.empresa, {
    align:AlignmentType.CENTER, size:22, color:GRAY_TX, sa:400
  }));

  // ── TABLA CONTROL DE VERSIONES ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before:200, after:120 },
    children: [t("Control de Versiones", {bold:true, size:24, color:NAVY})]
  }));

  children.push(new Table({
    width: { size:9360, type:WidthType.DXA },
    columnWidths: [2340, 3510, 3510],
    rows: [
      new TableRow({ children: [
        cell([p("Campo", {bold:true, size:18, color:WHITE})], {w:2340, bg:NAVY}),
        cell([p("Información", {bold:true, size:18, color:WHITE})], {w:3510, bg:NAVY}),
        cell([p("Observaciones", {bold:true, size:18, color:WHITE})], {w:3510, bg:NAVY}),
      ]}),
      ...[
        ["Nombre del documento", polName, ""],
        ["Código",               polCode, ""],
        ["Versión",              "1.0",   "Primera emisión"],
        ["Fecha de emisión",     fecha,   ""],
        ["Elaborado por",        "vCISO.cl", "www.vciso.cl"],
        ["Revisado por",         "_______________________", "Completar antes de implementar"],
        ["Aprobado por",         "_______________________", "Completar antes de implementar"],
        ["Cargo aprobador",      "_______________________", ""],
        ["Próxima revisión",     fechaRevision, "Revisión anual obligatoria"],
        ["Clasificación",        "Confidencial — Uso Interno", ""],
      ].map(([campo, info, obs], i) => new TableRow({ children: [
        cell([p(campo, {bold:true, size:17, color:NAVY})], {w:2340, bg:i%2===0?GRAY_BG:"F8FAFC"}),
        cell([p(info,  {size:17})],                         {w:3510, bg:i%2===0?GRAY_BG:"F8FAFC"}),
        cell([p(obs,   {size:16, color:GRAY_TX, italic:!obs.startsWith('_')})], {w:3510, bg:i%2===0?GRAY_BG:"F8FAFC"}),
      ]})),
    ]
  }));

  children.push(empty());
  children.push(new Paragraph({ children:[new PageBreak()] }));

  // ── SECCIÓN 1: OBJETIVO ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("1. Objetivo", {bold:true, size:28, color:NAVY})]
  }));
  children.push(p(contenido.objetivo, {size:20, color:GRAY_TX, sa:120}));

  // ── SECCIÓN 2: ALCANCE ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("2. Alcance", {bold:true, size:28, color:NAVY})]
  }));
  children.push(p(contenido.alcance, {size:20, color:GRAY_TX, sa:120}));

  // ── SECCIÓN 3: DEFINICIONES ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("3. Definiciones", {bold:true, size:28, color:NAVY})]
  }));

  children.push(new Table({
    width: { size:9360, type:WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: [
      new TableRow({ children: [
        cell([p("Término", {bold:true, size:18, color:WHITE})], {w:2800, bg:NAVY}),
        cell([p("Definición", {bold:true, size:18, color:WHITE})], {w:6560, bg:NAVY}),
      ]}),
      ...(contenido.definiciones||[]).map((def, i) => new TableRow({ children: [
        cell([p(def.termino, {bold:true, size:18, color:NAVY})], {w:2800, bg:i%2===0?GRAY_BG:"FFFFFF"}),
        cell([p(def.definicion, {size:18, color:GRAY_TX})],       {w:6560, bg:i%2===0?GRAY_BG:"FFFFFF"}),
      ]})),
    ]
  }));
  children.push(empty());

  // ── SECCIÓN 4: RESPONSABILIDADES ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("4. Responsabilidades", {bold:true, size:28, color:NAVY})]
  }));

  children.push(new Table({
    width: { size:9360, type:WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: [
      new TableRow({ children: [
        cell([p("Rol", {bold:true, size:18, color:WHITE})], {w:2800, bg:NAVY}),
        cell([p("Responsabilidad", {bold:true, size:18, color:WHITE})], {w:6560, bg:NAVY}),
      ]}),
      ...(contenido.responsabilidades||[]).map((resp, i) => new TableRow({ children: [
        cell([p(resp.rol, {bold:true, size:18, color:NAVY})],       {w:2800, bg:i%2===0?GRAY_BG:"FFFFFF"}),
        cell([p(resp.responsabilidad, {size:18, color:GRAY_TX})],   {w:6560, bg:i%2===0?GRAY_BG:"FFFFFF"}),
      ]})),
    ]
  }));
  children.push(empty());

  // ── SECCIÓN 5: POLÍTICA / LINEAMIENTOS ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("5. Lineamientos de la Política", {bold:true, size:28, color:NAVY})]
  }));

  (contenido.lineamientos||[]).forEach((lin, i) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before:180, after:80 },
      children: [t(`5.${i+1} ${lin.titulo}`, {bold:true, size:22, color:NAVY})]
    }));
    children.push(p(lin.contenido, {size:20, color:GRAY_TX, sa:120}));
  });

  // ── SECCIÓN 6: SANCIONES ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("6. Sanciones por Incumplimiento", {bold:true, size:28, color:NAVY})]
  }));
  children.push(p(contenido.sanciones, {size:20, color:GRAY_TX, sa:120}));

  // ── SECCIÓN 7: REVISIÓN ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("7. Revisión y Actualización", {bold:true, size:28, color:NAVY})]
  }));
  children.push(p(contenido.revision, {size:20, color:GRAY_TX, sa:120}));

  // ── FIRMA DE CONOCIMIENTO ──
  children.push(empty());
  children.push(new Paragraph({ children:[new PageBreak()] }));

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before:240, after:160 },
    children: [t("8. Constancia de Conocimiento", {bold:true, size:28, color:NAVY})]
  }));

  children.push(p("El personal indicado a continuación declara haber leído, comprendido y aceptado los lineamientos establecidos en esta política:",
    {size:20, color:GRAY_TX, sa:160}));

  children.push(new Table({
    width: { size:9360, type:WidthType.DXA },
    columnWidths: [2800, 2400, 1760, 2400],
    rows: [
      new TableRow({ children: [
        cell([p("Nombre completo", {bold:true, size:17, color:WHITE})], {w:2800, bg:NAVY}),
        cell([p("Cargo", {bold:true, size:17, color:WHITE})],           {w:2400, bg:NAVY}),
        cell([p("Fecha", {bold:true, size:17, color:WHITE})],           {w:1760, bg:NAVY}),
        cell([p("Firma", {bold:true, size:17, color:WHITE})],           {w:2400, bg:NAVY}),
      ]}),
      ...[1,2,3,4,5].map(n => new TableRow({ children: [
        cell([p("", {size:18})], {w:2800, bg:n%2===0?GRAY_BG:"FFFFFF"}),
        cell([p("", {size:18})], {w:2400, bg:n%2===0?GRAY_BG:"FFFFFF"}),
        cell([p("", {size:18})], {w:1760, bg:n%2===0?GRAY_BG:"FFFFFF"}),
        cell([p("", {size:18})], {w:2400, bg:n%2===0?GRAY_BG:"FFFFFF"}),
      ]})),
    ]
  }));

  children.push(empty());
  children.push(p(`Documento elaborado por vCISO.cl · ${fecha} · Confidencial — Uso interno de ${datos.empresa}`,
    {size:16, color:GRAY_TX, align:AlignmentType.CENTER, sb:200}));

  // ── Generar ──
  const doc = new Document({
    styles:{
      default:{ document:{ run:{ font:"Arial", size:20 } } },
      paragraphStyles:[
        { id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:28, bold:true, font:"Arial", color:NAVY },
          paragraph:{ spacing:{ before:240, after:160 }, outlineLevel:0,
            border:{ bottom:{ style:BorderStyle.SINGLE, size:4, color:ORANGE, space:4 } } } },
        { id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:22, bold:true, font:"Arial", color:NAVY },
          paragraph:{ spacing:{ before:180, after:80 }, outlineLevel:1 } },
      ]
    },
    sections:[{
      properties:{
        page:{
          size:{ width:11906, height:16838 },
          margin:{ top:1080, right:1260, bottom:1080, left:1260 }
        }
      },
      children,
    }]
  });

  return Packer.toBuffer(doc);
}

// ── Generar Word único con todas las políticas ────────────────────────────
async function generarWordUnificado(politicasContenido, datos) {
  const fecha = new Date().toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' });
  const children = [];

  // Portada del documento unificado
  children.push(p2([
    t("v", {bold:true, size:64, color:NAVY}),
    t("CISO", {bold:true, size:64, color:ORANGE}),
    t(".cl", {bold:true, size:64, color:NAVY}),
  ], { align:AlignmentType.CENTER, sb:1000, sa:80 }));

  children.push(p("Ciberseguridad para PYMEs chilenas", {align:AlignmentType.CENTER, size:20, color:GRAY_TX, sa:200}));

  children.push(p2([], { sb:100, sa:100,
    border:{ bottom:{ style:BorderStyle.SINGLE, size:8, color:ORANGE, space:1 } }
  }));

  children.push(p("MANUAL DE POLÍTICAS DE SEGURIDAD TI", {
    align:AlignmentType.CENTER, bold:true, size:36, color:NAVY, sb:400, sa:120
  }));
  children.push(p(datos.empresa, {align:AlignmentType.CENTER, size:26, color:GRAY_TX, sa:80}));
  children.push(p(fecha, {align:AlignmentType.CENTER, size:20, color:GRAY_TX, sa:400}));

  // Índice de políticas
  children.push(new Paragraph({ children:[new PageBreak()] }));
  children.push(p("Índice de Políticas", {bold:true, size:28, color:NAVY, sb:200, sa:160}));

  politicasContenido.forEach(({polKey}, i) => {
    children.push(p(`${i+1}. ${POLICY_NAMES[polKey]}   (${POLICY_CODES[polKey]})`,
      {size:19, color:GRAY_TX, sb:40, sa:40}));
  });

  // Cada política
  politicasContenido.forEach(({polKey, contenido}) => {
    children.push(new Paragraph({ children:[new PageBreak()] }));

    const polName = POLICY_NAMES[polKey];
    const polCode = POLICY_CODES[polKey];
    const fechaRevision = new Date(Date.now() + 365*24*60*60*1000)
      .toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' });

    // Encabezado de política
    children.push(p2([
      t(polName, {bold:true, size:30, color:NAVY}),
    ], { sb:200, sa:80,
      border:{ bottom:{ style:BorderStyle.SINGLE, size:6, color:ORANGE, space:4 } }
    }));
    children.push(empty());

    // Control versiones (compacto)
    children.push(new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [2340, 3510, 3510],
      rows: [
        new TableRow({ children: [
          cell([p("Campo", {bold:true, size:17, color:WHITE})], {w:2340, bg:NAVY}),
          cell([p("Información", {bold:true, size:17, color:WHITE})], {w:3510, bg:NAVY}),
          cell([p("Observaciones", {bold:true, size:17, color:WHITE})], {w:3510, bg:NAVY}),
        ]}),
        ...[
          ["Código", polCode, ""],
          ["Versión", "1.0", "Primera emisión"],
          ["Fecha de emisión", fecha, ""],
          ["Elaborado por", "vCISO.cl", ""],
          ["Revisado por", "_______________________", "Completar antes de implementar"],
          ["Aprobado por", "_______________________", "Completar antes de implementar"],
          ["Próxima revisión", fechaRevision, "Revisión anual"],
          ["Clasificación", "Confidencial — Uso Interno", ""],
        ].map(([campo, info, obs], i) => new TableRow({ children: [
          cell([p(campo, {bold:true, size:17, color:NAVY})], {w:2340, bg:i%2===0?GRAY_BG:"F8FAFC"}),
          cell([p(info,  {size:17})],                         {w:3510, bg:i%2===0?GRAY_BG:"F8FAFC"}),
          cell([p(obs,   {size:16, color:GRAY_TX, italic:true})], {w:3510, bg:i%2===0?GRAY_BG:"F8FAFC"}),
        ]})),
      ]
    }));
    children.push(empty());

    // Secciones
    const secciones = [
      ["1. Objetivo",                   contenido.objetivo],
      ["2. Alcance",                    contenido.alcance],
      ["6. Sanciones por Incumplimiento", contenido.sanciones],
      ["7. Revisión y Actualización",   contenido.revision],
    ];

    // Definiciones
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before:200, after:100 },
      children: [t("3. Definiciones", {bold:true, size:22, color:NAVY})]
    }));
    children.push(new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        new TableRow({ children: [
          cell([p("Término", {bold:true, size:17, color:WHITE})], {w:2800, bg:NAVY}),
          cell([p("Definición", {bold:true, size:17, color:WHITE})], {w:6560, bg:NAVY}),
        ]}),
        ...(contenido.definiciones||[]).map((def, i) => new TableRow({ children: [
          cell([p(def.termino, {bold:true, size:17, color:NAVY})], {w:2800, bg:i%2===0?GRAY_BG:"FFFFFF"}),
          cell([p(def.definicion, {size:17, color:GRAY_TX})],       {w:6560, bg:i%2===0?GRAY_BG:"FFFFFF"}),
        ]})),
      ]
    }));
    children.push(empty());

    // Responsabilidades
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before:200, after:100 },
      children: [t("4. Responsabilidades", {bold:true, size:22, color:NAVY})]
    }));
    children.push(new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        new TableRow({ children: [
          cell([p("Rol", {bold:true, size:17, color:WHITE})], {w:2800, bg:NAVY}),
          cell([p("Responsabilidad", {bold:true, size:17, color:WHITE})], {w:6560, bg:NAVY}),
        ]}),
        ...(contenido.responsabilidades||[]).map((resp, i) => new TableRow({ children: [
          cell([p(resp.rol, {bold:true, size:17, color:NAVY})],       {w:2800, bg:i%2===0?GRAY_BG:"FFFFFF"}),
          cell([p(resp.responsabilidad, {size:17, color:GRAY_TX})],   {w:6560, bg:i%2===0?GRAY_BG:"FFFFFF"}),
        ]})),
      ]
    }));
    children.push(empty());

    // Lineamientos
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before:200, after:100 },
      children: [t("5. Lineamientos de la Política", {bold:true, size:22, color:NAVY})]
    }));
    (contenido.lineamientos||[]).forEach((lin, i) => {
      children.push(p2([t(`5.${i+1} ${lin.titulo}`, {bold:true, size:20, color:NAVY})],
        {sb:120, sa:60}));
      children.push(p(lin.contenido, {size:19, color:GRAY_TX, sa:100}));
    });

    // Objetivo, sanciones, revisión
    secciones.slice(0,2).forEach(([titulo, texto]) => {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before:200, after:100 },
        children: [t(titulo, {bold:true, size:22, color:NAVY})]
      }));
      children.push(p(texto, {size:20, color:GRAY_TX, sa:120}));
    });
    secciones.slice(2).forEach(([titulo, texto]) => {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before:200, after:100 },
        children: [t(titulo, {bold:true, size:22, color:NAVY})]
      }));
      children.push(p(texto, {size:20, color:GRAY_TX, sa:120}));
    });

    // Firma de conocimiento
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before:200, after:100 },
      children: [t("8. Constancia de Conocimiento", {bold:true, size:22, color:NAVY})]
    }));
    children.push(new Table({
      width: { size:9360, type:WidthType.DXA },
      columnWidths: [2800, 2400, 1760, 2400],
      rows: [
        new TableRow({ children: [
          cell([p("Nombre completo", {bold:true, size:17, color:WHITE})], {w:2800, bg:NAVY}),
          cell([p("Cargo", {bold:true, size:17, color:WHITE})],           {w:2400, bg:NAVY}),
          cell([p("Fecha", {bold:true, size:17, color:WHITE})],           {w:1760, bg:NAVY}),
          cell([p("Firma", {bold:true, size:17, color:WHITE})],           {w:2400, bg:NAVY}),
        ]}),
        ...[1,2,3].map(n => new TableRow({ children: [
          cell([p("", {size:18})], {w:2800, bg:n%2===0?GRAY_BG:"FFFFFF"}),
          cell([p("", {size:18})], {w:2400, bg:n%2===0?GRAY_BG:"FFFFFF"}),
          cell([p("", {size:18})], {w:1760, bg:n%2===0?GRAY_BG:"FFFFFF"}),
          cell([p("", {size:18})], {w:2400, bg:n%2===0?GRAY_BG:"FFFFFF"}),
        ]})),
      ]
    }));
    children.push(empty());
  });

  const doc = new Document({
    styles:{
      default:{ document:{ run:{ font:"Arial", size:20 } } },
      paragraphStyles:[
        { id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:28, bold:true, font:"Arial", color:NAVY },
          paragraph:{ spacing:{ before:240, after:160 }, outlineLevel:0,
            border:{ bottom:{ style:BorderStyle.SINGLE, size:4, color:ORANGE, space:4 } } } },
        { id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:22, bold:true, font:"Arial", color:NAVY },
          paragraph:{ spacing:{ before:180, after:80 }, outlineLevel:1 } },
      ]
    },
    sections:[{
      properties:{ page:{ size:{ width:11906, height:16838 }, margin:{ top:1080, right:1260, bottom:1080, left:1260 } } },
      children,
    }]
  });

  return Packer.toBuffer(doc);
}

// ── Handler principal ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { token, datos, politicas, formato, contexto } = req.body || {};

  // Validar token
  const info = token ? verifyToken(token) : null;
  if (!info) return res.status(403).json({ error: 'Token inválido o expirado' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const fecha      = new Date().toLocaleString('es-CL', { timeZone:'America/Santiago' });
  const emailCliente = datos?.email || info.email;

  console.log(`Generando ${politicas?.length} políticas para ${datos?.empresa}`);

  try {
    // 1. Generar TODAS las políticas en una sola llamada a Claude
    console.log(`Generando ${politicas.length} políticas en una sola llamada...`);
    let todasPoliticas = {};
    try {
      todasPoliticas = await generarTodasPoliticas(politicas, datos, contexto || {});
      console.log('Claude respondió OK. Políticas generadas:', Object.keys(todasPoliticas).length);
    } catch(e) {
      console.error('Error generando políticas:', e.message);
    }

    // Armar array con contenido o fallback
    const politicasContenido = politicas.map(polKey => ({
      polKey,
      contenido: todasPoliticas[polKey] || {
        objetivo: `Esta política establece los lineamientos de ${POLICY_NAMES[polKey]} para ${datos.empresa}.`,
        alcance: `Aplica a todos los empleados, contratistas y proveedores de ${datos.empresa}.`,
        definiciones: [{termino:"Recurso TI", definicion:"Cualquier sistema, equipo o plataforma tecnológica utilizada en la organización."}],
        responsabilidades: [
          {rol:"Gerencia", responsabilidad:"Aprobar y respaldar esta política."},
          {rol:"Empleados", responsabilidad:"Conocer y cumplir esta política."},
          {rol:"Área TI / Proveedor TI", responsabilidad:"Implementar y controlar el cumplimiento."},
        ],
        lineamientos: [{titulo:"Lineamiento general", contenido:"Esta política será detallada según las necesidades específicas de la organización."}],
        sanciones: "El incumplimiento podrá resultar en medidas disciplinarias según la gravedad de la falta.",
        revision: "Esta política será revisada anualmente o ante cambios significativos.",
      }
    }));

    // 2. Generar Word(s)
    const adjuntos = [];

    if (formato === 'separado') {
      // Un Word por política
      for (const { polKey, contenido } of politicasContenido) {
        console.log(`Generando Word separado: ${polKey}`);
        const buffer = await generarWordPolitica(polKey, datos, contenido);
        const nombre = `${POLICY_CODES[polKey]}_${datos.empresa.replace(/[^a-zA-Z0-9]/g,'_')}.docx`;
        adjuntos.push({ filename: nombre, content: buffer.toString('base64') });
      }
    } else {
      // Un solo Word con todas
      console.log('Generando Word unificado...');
      const buffer = await generarWordUnificado(politicasContenido, datos);
      const nombre = `Politicas_Seguridad_TI_${datos.empresa.replace(/[^a-zA-Z0-9]/g,'_')}.docx`;
      adjuntos.push({ filename: nombre, content: buffer.toString('base64') });
    }

    // 3. Enviar email al CLIENTE
    const listaHTML = politicasContenido.map(({polKey}) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:0.88rem;color:rgba(255,255,255,0.8);">
        &#9989; ${POLICY_NAMES[polKey]}
      </div>`
    ).join('');

    const htmlCliente = `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
      <div style="font-size:1.6rem;font-weight:900;margin-bottom:4px">v<span style="color:#f47c47">CISO</span>.cl</div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.3);margin-bottom:28px;text-transform:uppercase;letter-spacing:0.06em">Políticas de Seguridad TI · ${fecha}</div>

      <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:8px">¡Tus políticas están listas! &#127881;</h2>
      <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:24px">
        Hola <strong style="color:#fff">${datos.nombre}</strong>, adjunto encontrarás las políticas de seguridad TI de <strong style="color:#fff">${datos.empresa}</strong>, redactadas según el estándar ISO 27002:2022.
      </p>

      <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:20px;margin-bottom:24px">
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">&#128203; Políticas incluidas</div>
        ${listaHTML}
      </div>

      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:16px;margin-bottom:24px">
        <p style="font-size:0.88rem;color:#86efac;font-weight:700;margin-bottom:8px">&#128196; Adjunto: ${formato === 'separado' ? politicasContenido.length + ' documentos Word separados' : '1 documento Word con todas las políticas'}</p>
        <p style="font-size:0.82rem;color:rgba(255,255,255,0.6);">Los documentos vienen en formato Word (.docx) para que puedas editarlos, completar el control de versiones y adaptarlos a tu empresa.</p>
      </div>

      <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:16px;margin-bottom:24px">
        <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);font-weight:700;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.04em">&#9888; Próximos pasos recomendados</div>
        <div style="font-size:0.85rem;color:rgba(255,255,255,0.7);line-height:1.7">
          <div>1. Completa los campos <strong>"Revisado por"</strong> y <strong>"Aprobado por"</strong> en el control de versiones de cada política.</div>
          <div>2. Comparte las políticas con tu equipo y solicita que cada persona las firme en la tabla de constancia.</div>
          <div>3. Guarda los documentos firmados en un lugar seguro y accesible para toda la organización.</div>
          <div>4. Agenda la próxima revisión anual en tu calendario.</div>
        </div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:20px;margin-top:8px;font-size:0.75rem;color:rgba(255,255,255,0.25);line-height:1.7">
        <strong style="color:rgba(255,255,255,0.4)">Aviso importante:</strong> Las políticas adjuntas han sido elaboradas por vCISO.cl como punto de partida profesional basado en ISO 27002:2022 y buenas prácticas de ciberseguridad. Constituyen una orientación general adaptada a la información proporcionada y no reemplazan una auditoría técnica, asesoría legal ni consultoría especializada. vCISO.cl no garantiza que estas políticas sean suficientes para cumplir con normativas específicas aplicables a su organización. Se recomienda revisarlas con su equipo directivo y, cuando corresponda, validarlas con asesoría legal especializada antes de su implementación formal. La responsabilidad de la implementación, comunicación y cumplimiento recae exclusivamente en la organización.
      </div>

      <div style="margin-top:16px;font-size:0.75rem;color:rgba(255,255,255,0.3)">
        contacto@vciso.cl · WhatsApp +56 9 8130 7440 · <a href="https://www.vciso.cl" style="color:rgba(255,255,255,0.3)">www.vciso.cl</a>
      </div>
    </div>`;

    const emailResult = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:        'vCISO.cl <contacto@vciso.cl>',
        to:          [emailCliente],
        bcc:         ['contacto@vciso.cl'],
        subject:     `📋 Tus Políticas de Seguridad TI — ${datos.empresa} | vCISO.cl`,
        html:        htmlCliente,
        attachments: adjuntos,
      }),
    });

    const emailData = await emailResult.json();
    console.log('Email enviado al cliente:', JSON.stringify(emailData));

    return res.json({ ok: true });

  } catch(err) {
    console.error('submit-politicas error:', err.message, err.stack);
    return res.status(500).json({ error: 'Error generando políticas' });
  }
};
