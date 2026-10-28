"use strict";

/**
 * Módulo de captura de fotografías.
 *
 * Usa campos <input type="file" accept="image/*">. En el celular, el atributo
 * capture="environment" pide la cámara posterior; sin él se elige de la galería.
 * Este enfoque no necesita HTTPS ni permisos especiales de cámara: el propio
 * navegador/sistema operativo gestiona el permiso y la captura.
 *
 * Cada imagen elegida se normaliza antes de guardarse:
 *   - se corrige la orientación EXIF (las fotos del celular salen derechas),
 *   - se reduce a un máximo de LADO_MAX píxeles por lado (el Word pesa menos),
 *   - se guarda siempre como JPEG dentro de un Blob.
 */
const Captura = (() => {
  const LADO_MAX = 2000;
  const CALIDAD_JPEG = 0.9;

  /**
   * Conecta un <input type="file"> con dos funciones de respuesta.
   * - alSeleccionar(archivos): el usuario eligió uno o más archivos.
   * - alCancelar(): el usuario cerró la cámara/selector sin elegir nada.
   */
  function conectarEntrada(input, { alSeleccionar, alCancelar }) {
    input.addEventListener("change", () => {
      const archivos = Array.from(input.files || []);
      input.value = ""; // permite volver a elegir el mismo archivo
      if (archivos.length === 0) {
        alCancelar();
      } else {
        alSeleccionar(archivos);
      }
    });
    // Los navegadores modernos disparan "cancel" cuando se cierra el selector.
    input.addEventListener("cancel", () => alCancelar());
  }

  /** Decodifica el archivo respetando la orientación EXIF. */
  async function decodificar(archivo) {
    if (typeof createImageBitmap === "function") {
      try {
        const mapa = await createImageBitmap(archivo, { imageOrientation: "from-image" });
        return { fuente: mapa, ancho: mapa.width, alto: mapa.height, liberar: () => mapa.close() };
      } catch (_) {
        /* se intenta con <img> */
      }
    }
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    try {
      await new Promise((resolve, reject) => {
        imagen.onload = resolve;
        imagen.onerror = () => reject(new Error("el archivo no es una imagen válida o su formato no es compatible"));
        imagen.src = url;
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    return {
      fuente: imagen,
      ancho: imagen.naturalWidth,
      alto: imagen.naturalHeight,
      liberar: () => URL.revokeObjectURL(url),
    };
  }

  /**
   * Convierte el archivo elegido en { blob, ancho, alto } listo para guardar.
   * Lanza un Error con mensaje legible si no se puede procesar.
   */
  async function prepararImagen(archivo) {
    if (archivo.type && !archivo.type.startsWith("image/")) {
      throw new Error("el archivo no es una imagen");
    }
    const origen = await decodificar(archivo);
    try {
      if (!origen.ancho || !origen.alto) throw new Error("la imagen está vacía");
      const escala = Math.min(1, LADO_MAX / Math.max(origen.ancho, origen.alto));
      const ancho = Math.max(1, Math.round(origen.ancho * escala));
      const alto = Math.max(1, Math.round(origen.alto * escala));

      const lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;
      const ctx = lienzo.getContext("2d");
      ctx.fillStyle = "#ffffff"; // fondo blanco por si la imagen tiene transparencia
      ctx.fillRect(0, 0, ancho, alto);
      ctx.drawImage(origen.fuente, 0, 0, ancho, alto);

      const blob = await new Promise((resolve, reject) => {
        lienzo.toBlob(
          (resultado) => (resultado ? resolve(resultado) : reject(new Error("no se pudo codificar la imagen"))),
          "image/jpeg",
          CALIDAD_JPEG
        );
      });
      lienzo.width = 0;
      lienzo.height = 0;
      return { blob, ancho, alto };
    } finally {
      origen.liberar();
    }
  }

  return { conectarEntrada, prepararImagen, LADO_MAX };
})();
