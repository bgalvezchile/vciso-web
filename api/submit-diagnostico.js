// api/submit-diagnostico.js
// Recibe formulario → llama Claude API → genera Word → envía por email
const crypto = require('crypto');
const fetch  = require('node-fetch');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageBreak, Header, Footer
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
  } catch (e) { return null; }
}

// ── Colores Word ───────────────────────────────────────────────────────────
const NAVY   = "0D1F3C";
const BLUE   = "1E4FAD";
const ORANGE = "E85D26";
const WHITE  = "FFFFFF";
const GRAY_BG= "F1F5F9";
const GRAY_TX= "475569";
const RED_BG = "FEF2F2";
const RED_TX = "DC2626";
const YLW_BG = "FFFBEB";
const YLW_TX = "D97706";
const GRN_BG = "F0FDF4";
const GRN_TX = "16A34A";

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
  border: opts.border || undefined,
  shading: opts.bg ? { fill:opts.bg, type:ShadingType.CLEAR } : undefined,
  children: runs,
});

const t = (text, opts={}) => new TextRun({
  text, bold:opts.bold||false, italics:opts.italic||false,
  size:opts.size||20, color:opts.color||"000000", font:"Arial"
});

const empty = () => new Paragraph({ children:[new TextRun({ text:"" })] });

const nivelMadurez = pct =>
  pct >= 75 ? { nivel:"AVANZADO",   color:GRN_TX, bg:GRN_BG } :
  pct >= 50 ? { nivel:"INTERMEDIO", color:YLW_TX, bg:YLW_BG } :
  pct >= 25 ? { nivel:"BÁSICO",     color:YLW_TX, bg:YLW_BG } :
              { nivel:"CRÍTICO",    color:RED_TX, bg:RED_BG  };

const nivelQ = pts =>
  pts >= 3 ? { txt:"Bueno",     bg:GRN_BG, color:GRN_TX } :
  pts >= 1 ? { txt:"Mejorable", bg:YLW_BG, color:YLW_TX } :
             { txt:"Crítico",   bg:RED_BG, color:RED_TX  };

// ── Áreas y preguntas ──────────────────────────────────────────────────────
const AREAS = [
  { id:"accesos",   label:"Accesos y Contraseñas",   emoji:"🔐", qs:["q1","q2","q3","q4"],      max:12 },
  { id:"equipos",   label:"Equipos y Red",            emoji:"💻", qs:["q5","q6","q7","q8"],      max:12 },
  { id:"datos",     label:"Datos e Información",      emoji:"💾", qs:["q9","q10","q11","q12"],   max:12 },
  { id:"amenazas",  label:"Amenazas y Proveedores",   emoji:"🎯", qs:["q13","q14","q15","q16"],  max:12 },
  { id:"normativa", label:"Normativa y Continuidad",  emoji:"📋", qs:["q17","q18","q19","q20","q21"], max:15 },
];

const PREGUNTAS = {
  q1: "¿Usan doble factor de autenticación (2FA)?",
  q2: "¿Qué pasa con los accesos cuando un empleado se va?",
  q3: "¿Tienen política de contraseñas definida?",
  q4: "¿Usan gestor de contraseñas corporativo?",
  q5: "¿Cómo son los computadores del equipo de trabajo?",
  q6: "¿El Wi-Fi es el mismo para empleados y visitas?",
  q7: "¿Los empleados usan celular personal para acceder a sistemas?",
  q8: "¿Tienen inventario de equipos y software?",
  q9: "¿Tienen respaldos automáticos de información crítica?",
  q10:"¿Han probado restaurar desde el respaldo?",
  q11:"¿Los computadores tienen antivirus activo?",
  q12:"¿Con qué frecuencia actualizan sistemas y aplicaciones?",
  q13:"¿Han recibido intentos de phishing o fraude digital?",
  q14:"¿El proveedor TI tiene acceso controlado?",
  q15:"¿Han tenido incidentes de seguridad en los últimos 2 años?",
  q16:"¿Tienen plan de respuesta ante ransomware?",
  q17:"¿Tienen políticas de seguridad documentadas?",
  q18:"¿Manejan datos personales con controles formales?",
  q19:"¿Los empleados reciben capacitación en ciberseguridad?",
  q20:"¿Cuánto impacto tendría una interrupción de un día?",
  q21:"¿Tienen seguro de ciberriesgo?",
};

// ── Llamar a Claude API ────────────────────────────────────────────────────
async function llamarClaude(datos, respuestas, puntaje, maxPuntaje, porcentaje, areas, comentario) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const resumenRespuestas = Object.entries(respuestas)
    .map(([q, pts]) => `- ${PREGUNTAS[q] || q}: ${pts} pts`)
    .join('\n');

  const resumenAreas = areas.map(a =>
    `- ${a.label}: ${a.obtenido}/${a.max} pts (${a.pct}%)`
  ).join('\n');

  const userPrompt = `
Analiza el siguiente diagnóstico de ciberseguridad y genera un informe profesional.

## DATOS DE LA EMPRESA
- Empresa: ${datos.empresa}
- Rubro: ${datos.rubro}
- Empleados: ${datos.empleados}
- Responsable TI: ${datos.deptTI || datos.deptTi || 'No especificado'}
- Presencia web: ${datos.web || 'No especificado'}
- Contacto: ${datos.nombre}, ${datos.cargo}

## PUNTAJE GLOBAL
${porcentaje}% — ${puntaje}/${maxPuntaje} puntos

## RESULTADOS POR ÁREA
${resumenAreas}

## RESPUESTAS DETALLADAS
${resumenRespuestas}

## COMENTARIO DEL CLIENTE
${comentario || 'Sin comentario adicional'}

---

Genera el informe en formato JSON con EXACTAMENTE esta estructura (sin markdown, sin texto extra, solo JSON válido):

{
  "resumen_ejecutivo": "3-4 párrafos analizando la situación global de la empresa, contextualizando al rubro y tamaño, mencionando el nivel de madurez y los principales riesgos identificados. Tono profesional pero comprensible para un dueño de PYME.",
  "analisis_contexto": "2-3 párrafos analizando el comentario del cliente y el contexto tecnológico específico de su empresa. Identifica patrones de riesgo particulares de su situación.",
  "hallazgos": [
    {
      "titulo": "Título corto del hallazgo",
      "prioridad": "ALTA|MEDIA|BAJA",
      "area": "nombre del área afectada",
      "situacion": "Descripción del problema específico en el contexto de ESTA empresa (1-2 oraciones)",
      "riesgo": "Qué puede pasar concretamente si no se corrige (1-2 oraciones)",
      "accion": "Pasos concretos y específicos para esta empresa (2-4 oraciones)",
      "plazo": "Esta semana|2 semanas|1 mes|2 meses|3 meses"
    }
  ],
  "fortalezas": [
    {
      "titulo": "Título de la fortaleza",
      "descripcion": "Descripción de qué están haciendo bien y cómo aprovecharlo (1-2 oraciones)"
    }
  ],
  "conclusion": "2-3 párrafos de conclusión con visión optimista pero realista, destacando que las mejoras son alcanzables, priorizando las acciones inmediatas y mencionando cómo vCISO.cl puede acompañar el proceso.",
  "nivel_urgencia_global": "CRÍTICO|ALTO|MEDIO|BAJO"
}

IMPORTANTE:
- Personaliza CADA hallazgo al contexto específico de ${datos.empresa} (rubro: ${datos.rubro}, ${datos.empleados} empleados)
- Solo incluye hallazgos para preguntas con 0-1 puntos
- Las fortalezas son para preguntas con 3 puntos
- Menciona la Ley 21.719 si hay riesgo de datos personales
- Alinea con NIST CSF v2.0 donde corresponda
- Máximo 6 hallazgos ALTA prioridad, 5 MEDIA, 3 BAJA
`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `Eres un experto en ciberseguridad con más de 20 años de experiencia, especializado en PYMEs chilenas. 
Tienes certificaciones en NIST CSF v2.0 e ISO 27001, y conocimiento profundo de la Ley 21.719 de Protección de Datos Personales de Chile.

Tu rol es analizar diagnósticos de ciberseguridad y generar informes profesionales, claros y accionables para dueños y gerentes de PYMEs que no son expertos en tecnología.

Principios que siempre sigues:
- Lenguaje profesional pero comprensible para alguien no técnico
- Cada hallazgo está contextualizado al rubro y tamaño específico de la empresa
- Las recomendaciones son concretas, con pasos específicos y plazos realistas
- Eres honesto sobre los riesgos sin alarmar innecesariamente
- Siempre hay un camino de mejora alcanzable
- Respondes SIEMPRE en español chileno formal
- Cuando generas JSON, devuelves SOLO el JSON válido, sin texto adicional, sin bloques markdown`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await resp.json();
  if (!data.content || !data.content[0]) throw new Error('Claude no respondió');

  const texto = data.content[0].text.trim();
  // Limpiar posibles bloques markdown
  const clean = texto.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
  return JSON.parse(clean);
}

// ── Generar Word ───────────────────────────────────────────────────────────
async function generarWord(datos, respuestas, puntaje, maxPuntaje, porcentaje, areas, analisis) {
  const fecha   = new Date().toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' });
  const madurez = nivelMadurez(porcentaje);
  const children = [];

  // ── PORTADA ──
  children.push(p2([
    t("v",{bold:true,size:80,color:NAVY}),
    t("CISO",{bold:true,size:80,color:ORANGE}),
    t(".cl",{bold:true,size:80,color:NAVY}),
  ],{ align:AlignmentType.CENTER, sb:1440, sa:120 }));

  children.push(p("Ciberseguridad para PYMEs chilenas",{ align:AlignmentType.CENTER, color:GRAY_TX, size:22, sa:400 }));

  children.push(p2([],{
    sb:100, sa:100,
    border:{ bottom:{ style:BorderStyle.SINGLE, size:8, color:ORANGE, space:1 } }
  }));

  children.push(p("INFORME DE DIAGNÓSTICO EXPRESS",{ align:AlignmentType.CENTER, bold:true, size:44, color:NAVY, sb:400, sa:160 }));
  children.push(p("Diagnóstico de Ciberseguridad para PYMEs",{ align:AlignmentType.CENTER, size:26, color:GRAY_TX, sa:600 }));

  children.push(new Table({
    width:{ size:9360, type:WidthType.DXA },
    columnWidths:[2500,6860],
    rows:[
      ["Empresa",    datos.empresa],
      ["RUT",        datos.rut || "—"],
      ["Contacto",   `${datos.nombre} · ${datos.cargo}`],
      ["Email",      datos.email],
      ["Teléfono",   datos.telefono || "—"],
      ["Rubro",      datos.rubro],
      ["Empleados",  datos.empleados],
      ["Depto TI",   datos.deptTI || datos.deptTi || "—"],
      ["Fecha",      fecha],
    ].map(([label,value]) => new TableRow({ children:[
      cell([p(label,{bold:true,size:20,color:WHITE})],{w:2500,bg:NAVY,bc:NAVY}),
      cell([p(value,{size:20})],{w:6860,bg:GRAY_BG}),
    ]}))
  }));

  children.push(empty());
  children.push(p(`Documento confidencial — Preparado exclusivamente para ${datos.empresa}`,
    { align:AlignmentType.CENTER, size:17, color:GRAY_TX, sb:400 }));
  children.push(new Paragraph({ children:[new PageBreak()] }));

  // ── SECCIÓN 1: RESUMEN EJECUTIVO ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{ before:240, after:160 },
    children:[t("1. Resumen Ejecutivo",{bold:true,size:32,color:NAVY})]
  }));

  // Cuadro puntaje
  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[3120,6240],
    rows:[new TableRow({ children:[
      cell([
        p("MADUREZ GLOBAL",{bold:true,size:18,color:WHITE,sa:80}),
        p2([t(madurez.nivel,{bold:true,size:52,color:WHITE})],{sb:40,sa:40}),
        p(`${porcentaje}% · ${puntaje}/${maxPuntaje} puntos`,{size:20,color:WHITE}),
      ],{w:3120,bg:NAVY}),
      cell([
        p("Resumen del diagnóstico",{bold:true,size:21,color:NAVY,sa:120}),
        p(analisis.resumen_ejecutivo,{size:19,color:GRAY_TX}),
      ],{w:6240,bg:GRAY_BG}),
    ]})]
  }));

  children.push(empty());

  // Resumen por áreas
  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[3500,1860,1500,2500],
    rows:[
      new TableRow({ children:[
        cell([p("Área",{bold:true,size:19,color:WHITE})],{w:3500,bg:NAVY}),
        cell([p("Puntaje",{bold:true,size:19,color:WHITE,align:AlignmentType.CENTER})],{w:1860,bg:NAVY}),
        cell([p("%",{bold:true,size:19,color:WHITE,align:AlignmentType.CENTER})],{w:1500,bg:NAVY}),
        cell([p("Nivel",{bold:true,size:19,color:WHITE,align:AlignmentType.CENTER})],{w:2500,bg:NAVY}),
      ]}),
      ...areas.map(area=>{
        const m = nivelMadurez(area.pct);
        return new TableRow({ children:[
          cell([p(`${area.emoji||''} ${area.label}`,{size:19})],{w:3500,bg:GRAY_BG}),
          cell([p(`${area.obtenido}/${area.max}`,{size:19,bold:true,align:AlignmentType.CENTER})],{w:1860,bg:m.bg}),
          cell([p(`${area.pct}%`,{size:19,align:AlignmentType.CENTER,color:m.color})],{w:1500,bg:m.bg}),
          cell([p(m.nivel,{size:19,bold:true,align:AlignmentType.CENTER,color:m.color})],{w:2500,bg:m.bg}),
        ]});
      }),
    ]
  }));

  children.push(empty());

  // Comentario del cliente
  if (datos.comentario) {
    children.push(p2([
      t("Comentario del cliente:  ",{bold:true,size:20,color:YLW_TX}),
      t(`"${datos.comentario}"`,{italic:true,size:20,color:GRAY_TX}),
    ],{
      sb:120, sa:120, bg:YLW_BG,
      border:{ left:{ style:BorderStyle.SINGLE, size:16, color:YLW_TX, space:4 } }
    }));
    children.push(empty());
  }

  // Análisis contexto
  if (analisis.analisis_contexto) {
    children.push(p("Análisis del contexto tecnológico",{bold:true,size:22,color:NAVY,sb:160,sa:100}));
    children.push(p(analisis.analisis_contexto,{size:20,color:GRAY_TX}));
    children.push(empty());
  }

  children.push(new Paragraph({ children:[new PageBreak()] }));

  // ── SECCIÓN 2: RESULTADOS POR ÁREA ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{ before:240, after:160 },
    children:[t("2. Resultados por Área",{bold:true,size:32,color:NAVY})]
  }));

  AREAS.forEach(area=>{
    const areaData = areas.find(a=>a.id===area.id) || { obtenido:0, max:area.max, pct:0 };
    const m = nivelMadurez(areaData.pct);

    children.push(new Paragraph({
      heading:HeadingLevel.HEADING_2,
      spacing:{ before:280, after:100 },
      children:[t(`${area.emoji} ${area.label} — ${areaData.obtenido}/${area.max} pts (${areaData.pct}%)`,{bold:true,size:26,color:NAVY})]
    }));

    children.push(new Table({
      width:{size:9360,type:WidthType.DXA},
      columnWidths:[4200,2760,1200,1200],
      rows:[
        new TableRow({ children:[
          cell([p("Pregunta",{bold:true,size:18,color:WHITE})],{w:4200,bg:BLUE}),
          cell([p("Evaluación",{bold:true,size:18,color:WHITE})],{w:2760,bg:BLUE}),
          cell([p("Pts",{bold:true,size:18,color:WHITE,align:AlignmentType.CENTER})],{w:1200,bg:BLUE}),
          cell([p("Estado",{bold:true,size:18,color:WHITE,align:AlignmentType.CENTER})],{w:1200,bg:BLUE}),
        ]}),
        ...area.qs.map((q,i)=>{
          const pts = respuestas[q] !== undefined ? Number(respuestas[q]) : 0;
          const nv  = nivelQ(pts);
          const eval_txt = pts >= 3 ? "Óptimo" : pts >= 1 ? "Mejorable" : "Requiere atención";
          return new TableRow({ children:[
            cell([p(PREGUNTAS[q]||q,{size:18})],{w:4200,bg:i%2===0?GRAY_BG:WHITE}),
            cell([p(eval_txt,{size:18,italic:true,color:GRAY_TX})],{w:2760,bg:i%2===0?GRAY_BG:WHITE}),
            cell([p(`${pts}`,{size:18,bold:true,align:AlignmentType.CENTER})],{w:1200,bg:nv.bg}),
            cell([p(nv.txt,{size:17,bold:true,color:nv.color,align:AlignmentType.CENTER})],{w:1200,bg:nv.bg}),
          ]});
        }),
      ]
    }));
    children.push(empty());
  });

  children.push(new Paragraph({ children:[new PageBreak()] }));

  // ── SECCIÓN 3: HALLAZGOS Y PLAN DE ACCIÓN ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{ before:240, after:160 },
    children:[t("3. Hallazgos y Plan de Acción",{bold:true,size:32,color:NAVY})]
  }));
  children.push(p("Los siguientes hallazgos han sido identificados y priorizados por nuestro equipo basándose en las respuestas del diagnóstico.",
    {size:20,color:GRAY_TX,sa:200}));

  let numH = 0;
  for (const prioridad of ["ALTA","MEDIA","BAJA"]) {
    const grupo = (analisis.hallazgos||[]).filter(h=>h.prioridad===prioridad);
    if (!grupo.length) continue;

    const pColor = prioridad==="ALTA" ? RED_TX : prioridad==="MEDIA" ? YLW_TX : GRN_TX;
    const pBg    = prioridad==="ALTA" ? RED_BG : prioridad==="MEDIA" ? YLW_BG : GRN_BG;
    const pLabel = prioridad==="ALTA" ? "🔴  PRIORIDAD ALTA" : prioridad==="MEDIA" ? "🟡  PRIORIDAD MEDIA" : "🟢  PRIORIDAD BAJA";

    children.push(p2([t(pLabel,{bold:true,size:22,color:pColor})],{sb:280,sa:120,bg:pBg}));

    for (const h of grupo) {
      numH++;
      children.push(new Table({
        width:{size:9360,type:WidthType.DXA},
        columnWidths:[9360],
        rows:[new TableRow({ children:[
          cell([
            p2([
              t(`${numH}. `,{bold:true,size:21,color:pColor}),
              t(h.titulo,{bold:true,size:21,color:NAVY}),
            ],{sb:60,sa:80}),
            p2([t("Situación: ",{bold:true,size:19,color:NAVY}), t(h.situacion||'',{size:19,color:GRAY_TX})],{sa:80}),
            p2([t("Riesgo: ",{bold:true,size:19,color:pColor}), t(h.riesgo||'',{size:19,color:GRAY_TX})],{sa:80}),
            p2([t("Acción recomendada: ",{bold:true,size:19,color:NAVY}), t(h.accion||'',{size:19,color:GRAY_TX})],{sa:80}),
            p2([
              t("Plazo sugerido: ",{bold:true,size:19,color:NAVY}),
              t(h.plazo||'',{bold:true,size:19,color:pColor}),
              t("     Responsable: _______________________     ",{size:19,color:GRAY_TX}),
              t("☐ Completado",{size:19,color:GRAY_TX}),
            ],{sa:60}),
          ],{w:9360,bg:WHITE,bc:"E2E8F0"}),
        ]})]
      }));
      children.push(empty());
    }
  }

  children.push(new Paragraph({ children:[new PageBreak()] }));

  // ── SECCIÓN 4: FORTALEZAS ──
  if (analisis.fortalezas && analisis.fortalezas.length) {
    children.push(new Paragraph({
      heading:HeadingLevel.HEADING_1,
      spacing:{ before:240, after:160 },
      children:[t("4. Fortalezas Identificadas",{bold:true,size:32,color:NAVY})]
    }));

    for (const f of analisis.fortalezas) {
      children.push(new Table({
        width:{size:9360,type:WidthType.DXA},
        columnWidths:[9360],
        rows:[new TableRow({ children:[
          cell([
            p(`✅ ${f.titulo}`,{bold:true,size:20,color:GRN_TX,sa:60}),
            p(f.descripcion,{size:19,color:GRAY_TX}),
          ],{w:9360,bg:GRN_BG,bc:"BBF7D0"}),
        ]})]
      }));
      children.push(empty());
    }
    children.push(new Paragraph({ children:[new PageBreak()] }));
  }

  // ── SECCIÓN 5: CONCLUSIONES ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{ before:240, after:160 },
    children:[t("5. Conclusiones y Próximos Pasos",{bold:true,size:32,color:NAVY})]
  }));

  children.push(p(analisis.conclusion||'',{size:20,color:GRAY_TX,sa:200}));

  // Tabla hoja de ruta
  const hallazgosOrdenados = [...(analisis.hallazgos||[])]
    .sort((a,b) => {
      const ord = {ALTA:0,MEDIA:1,BAJA:2};
      return (ord[a.prioridad]||0) - (ord[b.prioridad]||0);
    })
    .slice(0,10);

  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[1600,5560,2200],
    rows:[
      new TableRow({ children:[
        cell([p("Plazo",{bold:true,size:19,color:WHITE,align:AlignmentType.CENTER})],{w:1600,bg:NAVY}),
        cell([p("Acción",{bold:true,size:19,color:WHITE})],{w:5560,bg:NAVY}),
        cell([p("Prioridad",{bold:true,size:19,color:WHITE,align:AlignmentType.CENTER})],{w:2200,bg:NAVY}),
      ]}),
      ...hallazgosOrdenados.map((h,i)=>{
        const pColor = h.prioridad==="ALTA" ? RED_TX : h.prioridad==="MEDIA" ? YLW_TX : GRN_TX;
        const pBg    = h.prioridad==="ALTA" ? RED_BG : h.prioridad==="MEDIA" ? YLW_BG : GRN_BG;
        return new TableRow({ children:[
          cell([p(h.plazo||'',{size:18,align:AlignmentType.CENTER,bold:true,color:BLUE})],{w:1600,bg:i%2===0?GRAY_BG:WHITE}),
          cell([p(h.titulo,{size:18})],{w:5560,bg:i%2===0?GRAY_BG:WHITE}),
          cell([p(h.prioridad,{size:18,bold:true,color:pColor,align:AlignmentType.CENTER})],{w:2200,bg:pBg}),
        ]});
      }),
    ]
  }));

  children.push(empty());
  children.push(empty());

  // CTA
  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[9360],
    rows:[new TableRow({ children:[
      cell([
        p("¿Necesitas ayuda para implementar estas mejoras?",{bold:true,size:22,color:WHITE,align:AlignmentType.CENTER,sa:120}),
        p("vCISO.cl actúa como tu CISO externo: acompañamiento continuo, sin contratos largos, a precio de PYME.",{size:20,color:"CCDDFF",align:AlignmentType.CENTER,sa:120}),
        p("📧 contacto@vciso.cl  ·  📱 +56 9 8130 7440  ·  🌐 www.vciso.cl",{size:20,color:WHITE,align:AlignmentType.CENTER,bold:true}),
      ],{w:9360,bg:NAVY}),
    ]})]
  }));

  children.push(empty());
  children.push(p(`Informe preparado por vCISO.cl · ${fecha} · Confidencial — Para uso exclusivo de ${datos.empresa}`,
    {size:16,color:GRAY_TX,align:AlignmentType.CENTER,sb:200}));

  // ── Generar documento ──
  const doc = new Document({
    styles:{
      default:{ document:{ run:{ font:"Arial", size:20 } } },
      paragraphStyles:[
        { id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:32, bold:true, font:"Arial", color:NAVY },
          paragraph:{ spacing:{ before:240, after:160 }, outlineLevel:0,
            border:{ bottom:{ style:BorderStyle.SINGLE, size:6, color:ORANGE, space:4 } } } },
        { id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:26, bold:true, font:"Arial", color:NAVY },
          paragraph:{ spacing:{ before:200, after:100 }, outlineLevel:1 } },
      ]
    },
    sections:[{
      properties:{
        page:{
          size:{ width:11906, height:16838 },
          margin:{ top:1080, right:1260, bottom:1080, left:1260 }
        }
      },
      headers:{
        default: new Header({ children:[
          new Paragraph({
            alignment:AlignmentType.RIGHT,
            border:{ bottom:{ style:BorderStyle.SINGLE, size:4, color:ORANGE, space:4 } },
            spacing:{ before:0, after:120 },
            children:[
              t("v",{bold:true,size:18,color:NAVY}),
              t("CISO",{bold:true,size:18,color:ORANGE}),
              t(`.cl  ·  Diagnóstico Express  ·  ${datos.empresa}  ·  ${fecha}`,{size:18,color:GRAY_TX}),
            ]
          })
        ]})
      },
      footers:{
        default: new Footer({ children:[
          new Paragraph({
            alignment:AlignmentType.CENTER,
            border:{ top:{ style:BorderStyle.SINGLE, size:4, color:"CCCCCC", space:4 } },
            spacing:{ before:80, after:0 },
            children:[t("Confidencial · vCISO.cl · contacto@vciso.cl · www.vciso.cl · +56 9 8130 7440",{size:16,color:GRAY_TX})]
          })
        ]})
      },
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

  const body = req.body || {};
  const { token, datos, respuestas, puntaje, maxPuntaje, porcentaje, areas } = body;

  // Validar token
  const info = token ? verifyToken(token) : null;
  if (!info) return res.status(403).json({ error: 'Token inválido o expirado' });

  const RESEND_KEY    = process.env.RESEND_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const date          = new Date().toLocaleString('es-CL', { timeZone:'America/Santiago' });

  // Compatibilidad con formulario anterior (campos planos)
  const datosNormalizados = datos || {
    empresa:   body.empresa,
    rut:       body.rut,
    nombre:    body.contacto || body.nombre,
    cargo:     body.cargo,
    email:     body.email || info.email,
    telefono:  body.telefono,
    rubro:     body.rubro,
    empleados: body.empleados,
    deptTI:    body.deptTi || body.deptTI,
    web:       body.web,
    comentario:body.comentario,
  };

  const respuestasNorm = respuestas || {};
  const puntajeNorm    = puntaje    || body.score || 0;
  const maxNorm        = maxPuntaje || 63;
  const pctNorm        = porcentaje || body.pct   || 0;
  const areasNorm      = areas      || AREAS.map(a=>({
    ...a,
    obtenido: a.qs.reduce((s,q)=> s + (Number(respuestasNorm[q])||0), 0),
    pct: Math.round((a.qs.reduce((s,q)=>s+(Number(respuestasNorm[q])||0),0) / a.max)*100),
  }));

  try {
    // 1. Llamar a Claude
    console.log('Llamando a Claude API...');
    let analisis;
    try {
      analisis = await llamarClaude(
        datosNormalizados, respuestasNorm, puntajeNorm, maxNorm, pctNorm,
        areasNorm, datosNormalizados.comentario
      );
      console.log('Claude respondió OK, nivel urgencia:', analisis.nivel_urgencia_global);
    } catch(claudeErr) {
      console.error('Error Claude API:', claudeErr.message);
      // Si Claude falla, continuar sin análisis IA (fallback)
      analisis = {
        resumen_ejecutivo: `${datosNormalizados.empresa} obtuvo un ${pctNorm}% de madurez en ciberseguridad (${puntajeNorm}/${maxNorm} puntos). El informe detallado será preparado manualmente por nuestro equipo.`,
        analisis_contexto: datosNormalizados.comentario || '',
        hallazgos: [],
        fortalezas: [],
        conclusion: 'Nuestro equipo revisará las respuestas y preparará un informe personalizado en las próximas 24 horas.',
        nivel_urgencia_global: 'PENDIENTE',
      };
    }

    // 2. Generar Word
    console.log('Generando Word...');
    const wordBuffer = await generarWord(
      datosNormalizados, respuestasNorm, puntajeNorm, maxNorm, pctNorm,
      areasNorm, analisis
    );
    const wordBase64 = wordBuffer.toString('base64');
    const nombreArchivo = `Diagnostico_${(datosNormalizados.empresa||'cliente').replace(/[^a-zA-Z0-9]/g,'_')}_vCISO.docx`;

    // 3. Enviar email con Word adjunto
    console.log('Enviando email con adjunto...');
    const madurez = nivelMadurez(pctNorm);

    const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;
                background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
      <div style="font-size:1.6rem;font-weight:900;margin-bottom:4px">
        v<span style="color:#f47c47">CISO</span>.cl
      </div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.3);margin-bottom:28px;
                  text-transform:uppercase;letter-spacing:0.06em">
        Nuevo diagnóstico recibido · ${date}
      </div>

      <h2 style="font-size:1.2rem;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px">
        🔍 Diagnóstico Express — <span style="color:#f47c47">${datosNormalizados.empresa}</span>
      </h2>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5);width:140px">Empresa</td>
            <td style="padding:6px 8px;color:#fff;font-weight:700">${datosNormalizados.empresa}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Contacto</td>
            <td style="padding:6px 8px;color:#fff">${datosNormalizados.nombre} · ${datosNormalizados.cargo}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Email cliente</td>
            <td style="padding:6px 8px;color:#fff">${datosNormalizados.email}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Rubro</td>
            <td style="padding:6px 8px;color:#fff">${datosNormalizados.rubro}</td></tr>
        <tr><td style="padding:6px 8px;color:rgba(255,255,255,0.5)">Empleados</td>
            <td style="padding:6px 8px;color:#fff">${datosNormalizados.empleados}</td></tr>
      </table>

      <div style="background:rgba(232,93,38,0.15);border:1px solid rgba(232,93,38,0.4);
                  border-radius:10px;padding:20px;margin-bottom:24px;text-align:center">
        <div style="font-size:2.2rem;font-weight:900;color:#f47c47">${pctNorm}%</div>
        <div style="font-size:1rem;font-weight:700;color:#fff;margin:4px 0">${madurez.nivel}</div>
        <div style="font-size:0.85rem;color:rgba(255,255,255,0.5)">${puntajeNorm}/${maxNorm} puntos · Urgencia: ${analisis.nivel_urgencia_global}</div>
      </div>

      <div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Hallazgos identificados por Claude</div>
        ${(analisis.hallazgos||[]).filter(h=>h.prioridad==='ALTA').map(h=>
          `<div style="font-size:0.85rem;color:#fca5a5;margin-bottom:4px">🔴 ${h.titulo}</div>`
        ).join('')}
        ${(analisis.hallazgos||[]).filter(h=>h.prioridad==='MEDIA').map(h=>
          `<div style="font-size:0.85rem;color:#fcd34d;margin-bottom:4px">🟡 ${h.titulo}</div>`
        ).join('')}
      </div>

      ${datosNormalizados.comentario ? `
      <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:14px;margin-bottom:20px">
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-bottom:6px">Comentario del cliente</div>
        <div style="color:rgba(255,255,255,0.7);font-size:0.88rem;font-style:italic">"${datosNormalizados.comentario}"</div>
      </div>` : ''}

      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);
                  border-radius:8px;padding:14px;margin-bottom:20px;text-align:center">
        <div style="font-size:0.88rem;color:#86efac;font-weight:700">
          📎 Informe Word adjunto — revisa, ajusta y envía al cliente
        </div>
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-top:4px">
          ${nombreArchivo}
        </div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;
                  font-size:0.75rem;color:rgba(255,255,255,0.3)">
        Generado automáticamente por Claude API · vCISO.cl · contacto@vciso.cl
      </div>
    </div>`;

    const emailResult = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:        'vCISO.cl <contacto@vciso.cl>',
        to:          ['contacto@vciso.cl'],
        subject:     `🔍 Diagnóstico listo — ${datosNormalizados.empresa} (${pctNorm}% · ${madurez.nivel})`,
        html,
        attachments: [{
          filename:    nombreArchivo,
          content:     wordBase64,
        }],
      }),
    });

    const emailData = await emailResult.json();
    console.log('Email enviado:', JSON.stringify(emailData));

    return res.json({ ok: true });

  } catch (err) {
    console.error('submit-diagnostico error:', err.message, err.stack);
    return res.status(500).json({ error: 'Error procesando diagnóstico' });
  }
};
