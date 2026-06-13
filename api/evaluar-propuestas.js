// api/evaluar-propuestas.js
// Descarga propuestas desde Blob, Claude las analiza, genera Word, envía email, limpia Blob
const crypto = require('crypto');
const fetch  = require('node-fetch');
const { del } = require('@vercel/blob');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageBreak
} = require('docx');

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

// ── Colores Word ──────────────────────────────────────────────────────────
const NAVY    = "0D1F3C";
const BLUE    = "1E4FAD";
const ORANGE  = "E85D26";
const WHITE   = "FFFFFF";
const GRAY_BG = "F1F5F9";
const GRAY_TX = "475569";
const RED_BG  = "FEF2F2";
const RED_TX  = "DC2626";
const YLW_BG  = "FFFBEB";
const YLW_TX  = "D97706";
const GRN_BG  = "F0FDF4";
const GRN_TX  = "16A34A";

const bdr  = (c="CCCCCC") => ({ style: BorderStyle.SINGLE, size: 1, color: c });
const bdrs = (c="CCCCCC") => ({ top:bdr(c), bottom:bdr(c), left:bdr(c), right:bdr(c) });

const cell = (children, opts={}) => new TableCell({
  borders: bdrs(opts.bc || "CCCCCC"),
  width: { size: opts.w || 2340, type: WidthType.DXA },
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

// ── Descargar y convertir archivo a texto ─────────────────────────────────
async function extraerTexto(blobUrl, fileName) {
  const resp = await fetch(blobUrl);
  if (!resp.ok) throw new Error('Error descargando blob: ' + resp.status);
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Para PDF y Word, enviamos como base64 a Claude directamente
  const base64 = buffer.toString('base64');
  const isPdf  = fileName.toLowerCase().endsWith('.pdf');
  const isDocx = fileName.toLowerCase().endsWith('.docx') || fileName.toLowerCase().endsWith('.doc');
  const mimeType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  console.log('Archivo:', fileName, 'isPdf:', isPdf, 'isDocx:', isDocx, 'size:', buffer.length);
  
  return { base64, mimeType, isPdf };
}

// ── Buscar información del proveedor en internet ──────────────────────────
async function buscarProveedor(nombre, web, categoria) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  
  const query = web ? `${nombre} ${web}` : `${nombre} empresa proveedor`;
  
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: 'Eres un analista que busca información sobre proveedores y empresas. Respondes SOLO en JSON válido.',
      messages: [{
        role: 'user',
        content: `Busca información sobre la empresa o persona "${nombre}" que es proveedor de servicios en la categoría: "${categoria || 'servicios generales'}". ${web ? 'Sitio web: ' + web : ''}
Si no encuentras información específica de esta empresa, indica que no hay datos disponibles.
Devuelve SOLO este JSON:
{
  "existe": true/false,
  "descripcion": "breve descripción de la empresa y sus productos/servicios",
  "antiguedad": "años en el mercado aproximados o 'desconocido'",
  "presencia_web": "descripción de su presencia web y redes sociales",
  "referencias": "clientes o casos de uso conocidos o 'No encontrado'",
  "alertas": "problemas, quejas, noticias negativas o 'Sin alertas identificadas'",
  "calificacion_externa": número del 1 al 5 basado en la información encontrada
}`
      }],
    }),
  });
  
  const data = await resp.json();
  const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  
  try {
    const clean = texto.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
    return JSON.parse(clean);
  } catch(e) {
    return {
      existe: true,
      descripcion: 'No se encontró información suficiente en internet.',
      antiguedad: 'Desconocido',
      presencia_web: 'No verificada',
      referencias: 'No encontrado',
      alertas: 'Sin alertas identificadas',
      calificacion_externa: 3,
    };
  }
}

// ── Evaluar propuesta con Claude ──────────────────────────────────────────
async function evaluarPropuesta(nombre, fileData, producto, contexto, ponderaciones, infoExterna, datos = {}) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  
  const messages = [{
    role: 'user',
    content: [
      {
        type: fileData.isPdf ? 'document' : 'document',
        source: {
          type: 'base64',
          media_type: fileData.mimeType,
          data: fileData.base64,
        }
      },
      {
        type: 'text',
        text: `Eres un consultor experto en evaluación de proveedores tecnológicos. Analiza esta propuesta del proveedor "${nombre}" para: "${producto}".

Contexto adicional del cliente: ${contexto || 'No proporcionado'}

Ponderaciones del proceso:
- Aspectos Funcionales: ${datos.ponderaciones?.funcional || ponderaciones.funcional || 50}%
- Aspectos Comerciales: ${ponderaciones.comercial}%
- Aspectos Empresariales: ${ponderaciones.empresarial}%

Información externa encontrada sobre el proveedor:
- Descripción: ${infoExterna.descripcion}
- Antigüedad: ${infoExterna.antiguedad}
- Referencias: ${infoExterna.referencias}
- Alertas: ${infoExterna.alertas}

Evalúa la propuesta y devuelve SOLO este JSON (sin markdown):
{
  "resumen_propuesta": "Resumen de 2-3 oraciones sobre lo que ofrece esta propuesta",
  "aspectos_funcionales": {
    "calidad_solucion": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "capacidad_tecnica": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "calidad_certificada": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "adaptacion": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "plazos": {"puntaje": 1-5, "justificacion": "1-2 oraciones"}
  },
  "aspectos_comerciales": {
    "precios": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "condiciones_pago": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "postventa": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "garantias": {"puntaje": 1-5, "justificacion": "1-2 oraciones"}
  },
  "aspectos_empresariales": {
    "estabilidad": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "proximidad": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "entendimiento": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "importancia_cliente": {"puntaje": 1-5, "justificacion": "1-2 oraciones"},
    "referencias": {"puntaje": 1-5, "justificacion": "1-2 oraciones"}
  },
  "fortalezas": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],
  "debilidades": ["debilidad 1", "debilidad 2"],
  "informacion_no_incluida": ["dato importante que no aparece en la propuesta"]
}`
      }
    ]
  }];
  
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `Eres un consultor senior con doble especialización en tecnologías de la información y ciberseguridad, con experiencia evaluando propuestas tecnológicas para PYMEs chilenas.
Tu rol es actuar como la segunda opinión independiente del cliente antes de que contrate tecnología.
Evalúas propuestas tecnológicas con criterio experto: consideras aspectos técnicos reales (arquitectura, integraciones, seguridad, escalabilidad), comerciales (precio justo de mercado, condiciones, garantías) y empresariales (solidez del proveedor, referencias, soporte postventa).
Usas escala 1-5: 1=Muy deficiente, 2=Deficiente, 3=Aceptable, 4=Bueno, 5=Excelente.
Eres objetivo y honesto: si una propuesta es mala, lo dices claramente con fundamento.
Adaptas los criterios al tipo específico de solución tecnológica evaluada.
Respondes SOLO en JSON válido sin markdown.`,
      messages,
    }),
  });
  
  const data = await resp.json();
  if (!data.content || !data.content[0]) throw new Error(`Claude no evaluó ${nombre}`);
  
  const texto = data.content[0].text.trim();
  const clean = texto.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
  return JSON.parse(clean);
}

// ── Calcular puntaje ponderado ─────────────────────────────────────────────
function calcularPuntaje(evaluacion, ponderaciones) {
  const wT = (ponderaciones.funcional || ponderaciones.tecnico || 50) / 100;
  const wC = ponderaciones.comercial / 100;
  const wE = ponderaciones.empresarial / 100;
  
  const t = evaluacion.aspectos_funcionales || evaluacion.aspectos_tecnicos;
  const c = evaluacion.aspectos_comerciales;
  const e = evaluacion.aspectos_empresariales;
  
  // Promedio por área
  const promT = (t.calidad_solucion.puntaje + t.capacidad_tecnica.puntaje + t.calidad_certificada.puntaje + t.adaptacion.puntaje + t.plazos.puntaje) / 5;
  const promC = (c.precios.puntaje + c.condiciones_pago.puntaje + c.postventa.puntaje + c.garantias.puntaje) / 4;
  const promE = (e.estabilidad.puntaje + e.proximidad.puntaje + e.entendimiento.puntaje + e.importancia_cliente.puntaje + e.referencias.puntaje) / 5;
  
  const total = (promT * wT + promC * wC + promE * wE);
  
  return { total: Math.round(total * 100) / 100, promT, promC, promE };
}

// ── Generar Word del informe ──────────────────────────────────────────────
async function generarWordInforme(datos, resultados) {
  const fecha = new Date().toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' });
  const children = [];
  
  // ── PORTADA ──
  children.push(p2([
    t("v",{bold:true,size:64,color:NAVY}),
    t("CISO",{bold:true,size:64,color:ORANGE}),
    t(".cl",{bold:true,size:64,color:NAVY}),
  ],{align:AlignmentType.CENTER,sb:800,sa:80}));
  
  children.push(p("Servicios profesionales para PYMEs chilenas",{align:AlignmentType.CENTER,size:18,color:GRAY_TX,sa:200}));
  children.push(p2([],{sb:80,sa:80,border:{bottom:{style:BorderStyle.SINGLE,size:8,color:ORANGE,space:1}}}));
  children.push(p("INFORME DE EVALUACIÓN COMPARATIVA DE PROVEEDORES",{align:AlignmentType.CENTER,bold:true,size:32,color:NAVY,sb:300,sa:120}));
  children.push(p(datos.empresa,{align:AlignmentType.CENTER,size:24,color:GRAY_TX,sa:80}));
  children.push(p(datos.producto,{align:AlignmentType.CENTER,size:22,color:NAVY,sa:400}));
  
  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[2500,6860],
    rows:[
      ["Empresa",    datos.empresa],
      ["Producto/Servicio evaluado", datos.producto],
      ["N° de propuestas", `${resultados.length} propuestas evaluadas`],
      ["Criterio funcional", `${datos.ponderaciones.funcional || datos.ponderaciones.tecnico || 50}%`],
      ["Criterio comercial", `${datos.ponderaciones.comercial}%`],
      ["Criterio empresarial", `${datos.ponderaciones.empresarial}%`],
      ["Fecha de evaluación", fecha],
      ["Elaborado por", "vCISO.cl — Equipo de consultoría"],
    ].map(([label,value]) => new TableRow({children:[
      cell([p(label,{bold:true,size:18,color:WHITE})],{w:2500,bg:NAVY,bc:NAVY}),
      cell([p(value,{size:18})],{w:6860,bg:GRAY_BG}),
    ]}))
  }));
  
  children.push(empty());
  children.push(p("Documento confidencial — Uso exclusivo de " + datos.empresa,{align:AlignmentType.CENTER,size:16,color:GRAY_TX,sb:300}));
  children.push(new Paragraph({children:[new PageBreak()]}));
  
  // ── RESUMEN EJECUTIVO ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{before:240,after:160},
    children:[t("1. Resumen Ejecutivo",{bold:true,size:30,color:NAVY})]
  }));
  
  // Tabla de ranking
  const sorted = [...resultados].sort((a,b) => b.puntajes.total - a.puntajes.total);
  
  children.push(p("La siguiente tabla muestra el ranking final de proveedores según los criterios ponderados definidos para este proceso:",{size:20,color:GRAY_TX,sa:160}));
  
  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[540,2500,1560,1560,1560,1680],
    rows:[
      new TableRow({children:[
        cell([p("#",{bold:true,size:18,color:WHITE,align:AlignmentType.CENTER})],{w:540,bg:NAVY}),
        cell([p("Proveedor",{bold:true,size:18,color:WHITE})],{w:2500,bg:NAVY}),
        cell([p(`Funcional\n${datos.ponderaciones.funcional || datos.ponderaciones.tecnico || 50}%`,{bold:true,size:17,color:WHITE,align:AlignmentType.CENTER})],{w:1560,bg:NAVY}),
        cell([p(`Comercial\n${datos.ponderaciones.comercial}%`,{bold:true,size:17,color:WHITE,align:AlignmentType.CENTER})],{w:1560,bg:NAVY}),
        cell([p(`Empresarial\n${datos.ponderaciones.empresarial}%`,{bold:true,size:17,color:WHITE,align:AlignmentType.CENTER})],{w:1560,bg:NAVY}),
        cell([p("Puntaje\nTotal",{bold:true,size:18,color:WHITE,align:AlignmentType.CENTER})],{w:1680,bg:ORANGE}),
      ]}),
      ...sorted.map((r,i) => {
        const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
        const rowBg = i===0?GRN_BG:i%2===0?GRAY_BG:WHITE;
        return new TableRow({children:[
          cell([p(`${i+1}`,{bold:true,size:20,align:AlignmentType.CENTER,color:NAVY})],{w:540,bg:rowBg}),
          cell([p(`${medal} ${r.nombre}`,{bold:i===0,size:19,color:NAVY})],{w:2500,bg:rowBg}),
          cell([p(r.puntajes.promT.toFixed(2),{size:19,align:AlignmentType.CENTER})],{w:1560,bg:rowBg}),
          cell([p(r.puntajes.promC.toFixed(2),{size:19,align:AlignmentType.CENTER})],{w:1560,bg:rowBg}),
          cell([p(r.puntajes.promE.toFixed(2),{size:19,align:AlignmentType.CENTER})],{w:1560,bg:rowBg}),
          cell([p(r.puntajes.total.toFixed(2),{bold:true,size:20,align:AlignmentType.CENTER,color:i===0?GRN_TX:NAVY})],{w:1680,bg:i===0?GRN_BG:rowBg}),
        ]});
      }),
    ]
  }));
  
  children.push(empty());
  
  // Recomendación
  const ganador = sorted[0];
  children.push(new Table({
    width:{size:9360,type:WidthType.DXA},
    columnWidths:[9360],
    rows:[new TableRow({children:[
      cell([
        p("&#127942; PROVEEDOR RECOMENDADO",{bold:true,size:22,color:GRN_TX,sa:80}),
        p2([t(ganador.nombre,{bold:true,size:26,color:NAVY})],{sb:40,sa:80}),
        p(`Puntaje total: ${ganador.puntajes.total.toFixed(2)} / 5.00`,{size:20,color:GRAY_TX}),
      ],{w:9360,bg:GRN_BG,bc:"BBF7D0"}),
    ]})]
  }));
  
  children.push(empty());
  children.push(new Paragraph({children:[new PageBreak()]}));
  
  // ── EVALUACIÓN POR PROVEEDOR ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{before:240,after:160},
    children:[t("2. Evaluación Detallada por Proveedor",{bold:true,size:30,color:NAVY})]
  }));
  
  for (const r of sorted) {
    const ev = r.evaluacion;
    const posicion = sorted.indexOf(r) + 1;
    
    children.push(new Paragraph({
      heading:HeadingLevel.HEADING_2,
      spacing:{before:280,after:120},
      children:[t(`${posicion}° lugar — ${r.nombre}  (${r.puntajes.total.toFixed(2)}/5.00)`,{bold:true,size:26,color:NAVY})]
    }));
    
    children.push(p(ev.resumen_propuesta,{size:20,color:GRAY_TX,sa:120}));
    
    // Tabla de puntajes detallados
    const criterios = [
      ...Object.entries(ev.aspectos_funcionales || ev.aspectos_tecnicos || {}).map(([k,v]) => ({area:"Funcional",criterio:k.replace(/_/g,' '),puntaje:v.puntaje,just:v.justificacion})),
      ...Object.entries(ev.aspectos_comerciales).map(([k,v]) => ({area:"Comercial",criterio:k.replace(/_/g,' '),puntaje:v.puntaje,just:v.justificacion})),
      ...Object.entries(ev.aspectos_empresariales).map(([k,v]) => ({area:"Empresarial",criterio:k.replace(/_/g,' '),puntaje:v.puntaje,just:v.justificacion})),
    ];
    
    children.push(new Table({
      width:{size:9360,type:WidthType.DXA},
      columnWidths:[1400,2200,720,5040],
      rows:[
        new TableRow({children:[
          cell([p("Área",{bold:true,size:17,color:WHITE})],{w:1400,bg:BLUE}),
          cell([p("Criterio",{bold:true,size:17,color:WHITE})],{w:2200,bg:BLUE}),
          cell([p("Pts",{bold:true,size:17,color:WHITE,align:AlignmentType.CENTER})],{w:720,bg:BLUE}),
          cell([p("Justificación",{bold:true,size:17,color:WHITE})],{w:5040,bg:BLUE}),
        ]}),
        ...criterios.map((c,i) => {
          const ptsBg = c.puntaje>=4?GRN_BG:c.puntaje>=3?YLW_BG:RED_BG;
          const ptsTx = c.puntaje>=4?GRN_TX:c.puntaje>=3?YLW_TX:RED_TX;
          return new TableRow({children:[
            cell([p(c.area,{size:16,color:GRAY_TX})],{w:1400,bg:i%2===0?GRAY_BG:WHITE}),
            cell([p(c.criterio,{size:17,color:NAVY})],{w:2200,bg:i%2===0?GRAY_BG:WHITE}),
            cell([p(String(c.puntaje),{bold:true,size:18,align:AlignmentType.CENTER,color:ptsTx})],{w:720,bg:ptsBg}),
            cell([p(c.just,{size:17,color:GRAY_TX,italic:true})],{w:5040,bg:i%2===0?GRAY_BG:WHITE}),
          ]});
        }),
      ]
    }));
    
    children.push(empty());
    
    // Fortalezas y debilidades
    children.push(new Table({
      width:{size:9360,type:WidthType.DXA},
      columnWidths:[4680,4680],
      rows:[new TableRow({children:[
        cell([
          p("✅ Fortalezas",{bold:true,size:19,color:GRN_TX,sa:80}),
          ...(ev.fortalezas||[]).map(f => p("• " + f,{size:18,color:GRAY_TX,sa:40})),
        ],{w:4680,bg:GRN_BG,bc:"BBF7D0"}),
        cell([
          p("⚠️ Debilidades / Puntos a mejorar",{bold:true,size:19,color:YLW_TX,sa:80}),
          ...(ev.debilidades||[]).map(d => p("• " + d,{size:18,color:GRAY_TX,sa:40})),
          ...(ev.informacion_no_incluida?.length ? [
            p("ℹ️ Información no incluida en la propuesta:",{bold:true,size:17,color:NAVY,sb:80,sa:40}),
            ...(ev.informacion_no_incluida||[]).map(d => p("• " + d,{size:17,color:GRAY_TX,italic:true,sa:30})),
          ] : []),
        ],{w:4680,bg:YLW_BG,bc:"FCD34D"}),
      ]})]
    }));
    
    children.push(empty());
    
    // Info externa del proveedor
    const ext = r.infoExterna;
    if (ext) {
      children.push(p("Información verificada externamente:",{bold:true,size:19,color:NAVY,sb:100,sa:80}));
      children.push(new Table({
        width:{size:9360,type:WidthType.DXA},
        columnWidths:[2500,6860],
        rows:[
          ["Descripción",    ext.descripcion],
          ["Antigüedad",     ext.antiguedad],
          ["Presencia web",  ext.presencia_web],
          ["Referencias",    ext.referencias],
          ["Alertas",        ext.alertas],
          ["Calificación externa", `${ext.calificacion_externa}/5`],
        ].map(([label,value],i) => new TableRow({children:[
          cell([p(label,{bold:true,size:17,color:NAVY})],{w:2500,bg:i%2===0?GRAY_BG:WHITE}),
          cell([p(value,{size:17,color:GRAY_TX})],{w:6860,bg:i%2===0?GRAY_BG:WHITE}),
        ]}))
      }));
    }
    
    children.push(empty());
    children.push(new Paragraph({children:[new PageBreak()]}));
  }
  
  // ── CONCLUSIÓN ──
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{before:240,after:160},
    children:[t("3. Conclusión y Recomendación Final",{bold:true,size:30,color:NAVY})]
  }));
  
  children.push(p(`Basándose en el análisis comparativo de las ${resultados.length} propuestas recibidas para "${datos.producto}", el proveedor con mejor evaluación global es ${ganador.nombre}, con un puntaje ponderado de ${ganador.puntajes.total.toFixed(2)} sobre 5.00.`,{size:20,color:GRAY_TX,sa:120}));
  
  children.push(p(`Esta evaluación consideró los criterios definidos para el proceso: ${datos.ponderaciones.funcional || datos.ponderaciones.tecnico || 50}% aspectos funcionales, ${datos.ponderaciones.comercial}% aspectos comerciales y ${datos.ponderaciones.empresarial}% aspectos empresariales. Los puntajes reflejan el análisis del contenido de cada propuesta y la información externa verificada sobre cada proveedor.`,{size:20,color:GRAY_TX,sa:120}));
  
  children.push(p("Se recomienda revisar este informe en conjunto con el equipo decisor antes de formalizar la contratación, y solicitar referencias directas al proveedor seleccionado.",{size:20,color:GRAY_TX,sa:200}));
  
  children.push(empty());
  
  // Aviso legal
  children.push(new Paragraph({children:[new PageBreak()]}));
  children.push(new Paragraph({
    heading:HeadingLevel.HEADING_1,
    spacing:{before:240,after:160},
    children:[t("4. Aviso Legal",{bold:true,size:30,color:NAVY})]
  }));
  
  const disclaimerTextos = [
    ["Naturaleza del servicio.", "Este informe fue elaborado por vCISO.cl como herramienta de apoyo al proceso de evaluación de proveedores. Los puntajes y conclusiones se basan exclusivamente en el contenido de las propuestas proporcionadas por el cliente e información de acceso público en internet."],
    ["Limitación de responsabilidad.", "vCISO.cl no garantiza la exactitud de la información externa consultada ni la vigencia de la misma. La decisión final de contratación es de exclusiva responsabilidad de la organización. vCISO.cl no asume responsabilidad por los resultados de la contratación."],
    ["Confidencialidad.", "El contenido de las propuestas evaluadas es tratado con estricta confidencialidad. Los archivos son eliminados automáticamente de nuestros servidores una vez generado el informe."],
    ["No constituye asesoría legal.", "Este informe no reemplaza la revisión legal de contratos ni la asesoría jurídica especializada. Se recomienda consultar con un abogado antes de formalizar cualquier contratación significativa."],
  ];
  
  disclaimerTextos.forEach(([titulo,texto]) => {
    children.push(p2([
      t(titulo + "  ",{bold:true,size:19,color:NAVY}),
      t(texto,{size:19,color:GRAY_TX}),
    ],{sb:80,sa:80}));
  });
  
  children.push(empty());
  children.push(p(`Informe elaborado por vCISO.cl · ${fecha} · Confidencial — Para uso exclusivo de ${datos.empresa}`,{size:16,color:GRAY_TX,align:AlignmentType.CENTER}));
  
  // ── Generar documento ──
  const doc = new Document({
    styles:{
      default:{document:{run:{font:"Arial",size:20}}},
      paragraphStyles:[
        {id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,
          run:{size:30,bold:true,font:"Arial",color:NAVY},
          paragraph:{spacing:{before:240,after:160},outlineLevel:0,
            border:{bottom:{style:BorderStyle.SINGLE,size:6,color:ORANGE,space:4}}}},
        {id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,
          run:{size:26,bold:true,font:"Arial",color:NAVY},
          paragraph:{spacing:{before:200,after:100},outlineLevel:1}},
      ]
    },
    sections:[{
      properties:{page:{size:{width:11906,height:16838},margin:{top:1080,right:1260,bottom:1080,left:1260}}},
      children,
    }]
  });
  
  return Packer.toBuffer(doc);
}

// ── Handler principal ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, empresa, email, producto, contexto, ponderaciones, proveedores, categoria, empleados } = req.body || {};

  const info = token ? verifyToken(token) : null;
  if (!info) return res.status(403).json({ error: 'Token inválido o expirado' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const fecha      = new Date().toLocaleString('es-CL', { timeZone:'America/Santiago' });
  const emailDest  = email || info.email;

  console.log(`Evaluando ${proveedores?.length} propuestas para ${empresa}`);

  const blobUrls = proveedores.map(p => p.blobUrl);

  try {
    // 1. Buscar info externa de cada proveedor
    console.log('Buscando información externa de proveedores...');
    const infoExterna = {};
    for (const prov of proveedores) {
      console.log(`Buscando: ${prov.nombre}`);
      infoExterna[prov.nombre] = await buscarProveedor(prov.nombre, prov.web, categoria);
    }

    // 2. Descargar y evaluar cada propuesta
    console.log('Evaluando propuestas...');
    const resultados = [];
    for (const prov of proveedores) {
      console.log(`Evaluando: ${prov.nombre}`);
      const fileData   = await extraerTexto(prov.blobUrl, prov.fileName);
      const evaluacion = await evaluarPropuesta(
        prov.nombre, fileData, producto, contexto,
        ponderaciones, infoExterna[prov.nombre],
        { empresa, categoria: categoria || 'General', empleados: empleados || '' }
      );
      const puntajes = calcularPuntaje(evaluacion, ponderaciones);
      resultados.push({
        nombre:       prov.nombre,
        evaluacion,
        puntajes,
        infoExterna: infoExterna[prov.nombre],
      });
    }

    // 3. Generar Word
    console.log('Generando informe Word...');
    const wordBuffer = await generarWordInforme(
      { empresa, producto, contexto, ponderaciones, categoria: categoria || 'General', empleados: empleados || '' },
      resultados
    );
    const wordBase64 = wordBuffer.toString('base64');
    const nombreArchivo = `Evaluacion_Proveedores_${empresa.replace(/[^a-zA-Z0-9]/g,'_')}_vCISO.docx`;

    // 4. Enviar email
    console.log('Enviando email...');
    const sorted = [...resultados].sort((a,b) => b.puntajes.total - a.puntajes.total);
    const ganador = sorted[0];

    const rankingHTML = sorted.map((r,i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:0.9rem;color:rgba(255,255,255,0.8);">
          ${i===0?'🥇':i===1?'🥈':'🥉'} <strong style="color:#fff">${r.nombre}</strong>
        </div>
        <div style="font-size:1rem;font-weight:800;color:${i===0?'#86efac':'#94a3b8'};">${r.puntajes.total.toFixed(2)}/5.00</div>
      </div>`
    ).join('');

    const htmlEmail = `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;background:#0d1f3c;color:#fff;padding:40px;border-radius:12px">
      <div style="font-size:1.6rem;font-weight:900;margin-bottom:4px">v<span style="color:#f47c47">CISO</span>.cl</div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.3);margin-bottom:28px;text-transform:uppercase;letter-spacing:0.06em">Evaluación de Proveedores · ${fecha}</div>

      <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:8px">&#127942; Tu informe de evaluación está listo</h2>
      <p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:24px">
        Hola <strong style="color:#fff">${empresa}</strong>, adjunto encontrarás el informe comparativo de las ${proveedores.length} propuestas evaluadas para <strong style="color:#fff">${producto}</strong>.
      </p>

      <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:20px;margin-bottom:24px">
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">Ranking de proveedores</div>
        ${rankingHTML}
        <div style="margin-top:16px;padding:12px;background:rgba(34,197,94,0.1);border-radius:8px;border:1px solid rgba(34,197,94,0.3);">
          <div style="font-size:0.82rem;color:#86efac;font-weight:700;">&#127942; Proveedor recomendado: ${ganador.nombre}</div>
          <div style="font-size:0.78rem;color:rgba(255,255,255,0.5);margin-top:4px;">Puntaje: ${ganador.puntajes.total.toFixed(2)}/5.00</div>
        </div>
      </div>

      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:14px;margin-bottom:24px;text-align:center">
        <div style="font-size:0.88rem;color:#86efac;font-weight:700;">&#128196; Informe Word adjunto — ${nombreArchivo}</div>
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-top:4px;">Incluye evaluación detallada, ranking, verificación externa y recomendación</div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;font-size:0.72rem;color:rgba(255,255,255,0.25);line-height:1.7">
        <strong style="color:rgba(255,255,255,0.4)">Aviso:</strong> Este informe fue elaborado por vCISO.cl como herramienta de apoyo. Los puntajes se basan en el contenido de las propuestas e información pública. La decisión final de contratación es responsabilidad exclusiva de la organización. Los archivos subidos han sido eliminados de nuestros servidores.
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
        to: [emailDest],
        bcc: ['contacto@vciso.cl'],
        subject: `📊 Evaluación de Proveedores — ${producto} | ${empresa} | vCISO.cl`,
        html: htmlEmail,
        attachments: [{ filename: nombreArchivo, content: wordBase64 }],
      }),
    });

    // 5. Eliminar archivos del Blob
    console.log('Eliminando archivos del Blob...');
    for (const url of blobUrls) {
      try { await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch(e) { console.error('Error eliminando:', e.message); }
    }

    console.log('Proceso completado exitosamente');
    return res.json({ ok: true });

  } catch(err) {
    console.error('evaluar-propuestas error:', err.message, err.stack);
    // Intentar limpiar archivos aunque haya error
    for (const url of blobUrls) {
      try { await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch(e) {}
    }
    return res.status(500).json({ error: 'Error procesando evaluación' });
  }
};
