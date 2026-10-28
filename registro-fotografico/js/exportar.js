"use strict";

/**
 * Módulo de exportación a Word.
 *
 * Genera un .docx REAL (no un HTML renombrado) con la biblioteca "docx"
 * (js/vendor/docx.iife.js, licencia MIT, expone la variable global `docx`).
 *
 * Formato del anexo:
 *   - A4 vertical, márgenes de 2,54 cm (1440 twips).
 *   - Título, datos del proyecto y UNA tabla continua de dos columnas:
 *       fila 1: "FOTOGRAFÍAS DE FECHA ..."           (celda combinada)
 *       fila 2: imagen incrustada                     (celda combinada)
 *       fila 3: "Foto N.º 01" | descripción
 *       fila 4: imagen ... y así sucesivamente.
 *   - Dos fotografías por página; cada foto se mantiene junto a su descripción.
 *   - Poppins de 8 pt para etiquetas y descripciones.
 *   - La numeración sale del orden actual, no se escribe a mano.
 */
const Exportador = (() => {
  const FUENTE = "Poppins";
  const TAM_8PT = 16; // en medios puntos: 16 = 8 pt
  const TAM_TITULO = 24; // 12 pt

  // A4 en twips (1 cm ≈ 567 twips) y márgenes de 2,54 cm.
  const PAGINA = { ancho: 11906, alto: 16838 };
  const MARGEN = 1440;
  const ANCHO_UTIL = PAGINA.ancho - 2 * MARGEN; // 9026
  const COL_NUMERO = 1800; // columna estrecha (número de foto)
  const COL_DESCRIPCION = ANCHO_UTIL - COL_NUMERO;

  const FOTOS_POR_PAGINA = 2;

  // Caja máxima de cada imagen (en píxeles a 96 ppp, la unidad de docx).
  const cmAPx = (cm) => Math.round((cm / 2.54) * 96);
  const MAX_ANCHO_PX = cmAPx(14.5);
  const MAX_ALTO_PX = cmAPx(7.8);

  const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];

  /** "2026-10-27" -> "27 DE OCTUBRE DE 2026" (sin usar zonas horarias). */
  function fechaLarga(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    const mes = MESES[parseInt(m[2], 10) - 1];
    if (!mes) return "";
    return `${parseInt(m[3], 10)} de ${mes} de ${m[1]}`.toUpperCase();
  }

  /** "Foto N.º 01", "Foto N.º 02", ... */
  function etiquetaFoto(numero) {
    return `Foto N.\u00BA ${String(numero).padStart(2, "0")}`;
  }

  /** Ajusta (ancho, alto) a la caja máxima conservando la proporción. */
  function ajustarTamano(ancho, alto) {
    const factor = Math.min(MAX_ANCHO_PX / ancho, MAX_ALTO_PX / alto);
    return { width: Math.max(1, Math.round(ancho * factor)), height: Math.max(1, Math.round(alto * factor)) };
  }

  function nombreArchivo(proyecto) {
    const codigo = String(proyecto.codigo || "SIN_CODIGO")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `Anexo2_Registro_Fotografico_${codigo || "SIN_CODIGO"}.docx`;
  }

  /** Construye el objeto Document (sin empaquetarlo todavía). */
  async function construirDocumento(proyecto, fotos) {
    const {
      Document, Table, TableRow, TableCell, Paragraph, TextRun, ImageRun,
      WidthType, AlignmentType, BorderStyle, VerticalAlign, ShadingType,
      TableLayoutType, HeightRule,
    } = docx;

    const texto = (contenido, opciones = {}) =>
      new TextRun({ text: contenido, font: FUENTE, size: TAM_8PT, ...opciones });

    /** Párrafo con saltos de línea respetados. */
    const parrafoMultilinea = (contenido, opciones, propiedades = {}) => {
      const lineas = String(contenido).split(/\r?\n/);
      return new Paragraph({
        ...propiedades,
        children: lineas.map((linea, i) => texto(linea, { ...opciones, break: i > 0 ? 1 : undefined })),
      });
    };

    const linea = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const bordes = {
      top: linea, bottom: linea, left: linea, right: linea,
      insideHorizontal: linea, insideVertical: linea,
    };
    const margenes = { top: 80, bottom: 80, left: 120, right: 120 };

    // ----- Encabezado del documento -----
    const encabezado = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "ANEXO 2 REGISTRO FOTOGRÁFICO", font: FUENTE, size: TAM_TITULO, bold: true })],
      }),
      ...[
        ["Código", proyecto.codigo],
        ["Fiscalizador", proyecto.fiscalizador],
        ["Lugar", proyecto.lugar],
        ["Establecimiento", proyecto.establecimiento],
      ].map(
        ([etiqueta, valor]) =>
          new Paragraph({
            spacing: { after: 40 },
            children: [texto(`${etiqueta}: `, { bold: true }), texto(String(valor))],
          })
      ),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    ];

    // ----- Filas de la tabla continua -----
    const filas = [];

    filas.push(
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            columnSpan: 2,
            width: { size: ANCHO_UTIL, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "D9D9D9", color: "auto" },
            verticalAlign: VerticalAlign.CENTER,
            margins: margenes,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                keepNext: true,
                children: [texto(`FOTOGRAFÍAS DE FECHA ${fechaLarga(proyecto.fecha)}`, { bold: true })],
              }),
            ],
          }),
        ],
      })
    );

    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i];
      const datos = new Uint8Array(await foto.blob.arrayBuffer());
      const tamano = ajustarTamano(foto.ancho, foto.alto);
      const empiezaPagina = i > 0 && i % FOTOS_POR_PAGINA === 0;

      // Fila de imagen (ancho completo)
      filas.push(
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              columnSpan: 2,
              width: { size: ANCHO_UTIL, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 120, bottom: 120, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  keepNext: true, // la foto no se separa de su descripción
                  pageBreakBefore: empiezaPagina, // salto de página controlado
                  children: [
                    new ImageRun({
                      type: "jpg",
                      data: datos,
                      transformation: tamano,
                      altText: {
                        name: etiquetaFoto(i + 1),
                        title: etiquetaFoto(i + 1),
                        description: foto.descripcion || etiquetaFoto(i + 1),
                      },
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );

      // Fila de pie: número a la izquierda, descripción a la derecha
      filas.push(
        new TableRow({
          cantSplit: true,
          height: { value: 560, rule: HeightRule.ATLEAST },
          children: [
            new TableCell({
              width: { size: COL_NUMERO, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: margenes,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [texto(etiquetaFoto(i + 1), { bold: true })],
                }),
              ],
            }),
            new TableCell({
              width: { size: COL_DESCRIPCION, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: margenes,
              children: [parrafoMultilinea(foto.descripcion, {}, { alignment: AlignmentType.LEFT })],
            }),
          ],
        })
      );
    }

    const tabla = new Table({
      width: { size: ANCHO_UTIL, type: WidthType.DXA },
      columnWidths: [COL_NUMERO, COL_DESCRIPCION],
      layout: TableLayoutType.FIXED,
      borders: bordes,
      rows: filas,
    });

    return new Document({
      creator: String(proyecto.fiscalizador),
      title: `Anexo 2 Registro fotográfico - ${proyecto.codigo}`,
      description: "Anexo fotográfico generado con la aplicación de registro fotográfico",
      styles: { default: { document: { run: { font: FUENTE, size: TAM_8PT } } } },
      sections: [
        {
          properties: {
            page: {
              size: { width: PAGINA.ancho, height: PAGINA.alto },
              margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
            },
          },
          children: [...encabezado, tabla],
        },
      ],
    });
  }

  /** Genera el .docx y devuelve un Blob. */
  async function generar(proyecto, fotos) {
    if (typeof docx === "undefined") {
      throw new Error("No se cargó la biblioteca docx (js/vendor/docx.iife.js).");
    }
    const documento = await construirDocumento(proyecto, fotos);
    return docx.Packer.toBlob(documento);
  }

  /** Descarga un Blob como archivo. */
  function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return { generar, construirDocumento, descargar, nombreArchivo, fechaLarga, etiquetaFoto, ajustarTamano };
})();

// Permite probar el módulo desde Node (pruebas automáticas); en el navegador no hace nada.
if (typeof module !== "undefined" && module.exports) {
  module.exports = Exportador;
}
