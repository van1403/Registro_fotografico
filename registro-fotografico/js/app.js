"use strict";

/**
 * Aplicación de registro fotográfico de fiscalización.
 *
 * Archivos:
 *   js/almacenamiento.js  -> IndexedDB (proyectos y fotos con su Blob)
 *   js/captura.js         -> selección/captura y preparación de imágenes
 *   js/exportar.js        -> generación del .docx
 *   js/app.js             -> este archivo: interfaz, eventos y validaciones
 *
 * Flujo general:
 *   1. Se crea/abre un proyecto (formulario de datos).
 *   2. Se toman o eligen fotos; cada una pasa por una vista previa de confirmación.
 *   3. En la galería se editan descripciones, se reordena y se elimina.
 *   4. La vista previa muestra la secuencia final y "Generar Word" descarga el .docx.
 */
(() => {
  // ================= Utilidades =================
  const $ = (selector, raiz = document) => raiz.querySelector(selector);
  const ULTIMO_PROYECTO = "rf_ultimo_proyecto";

  /** Crea un identificador único (funciona también en http, sin contexto seguro). */
  function nuevoId() {
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function hoyISO() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function formatearFechaHora(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  }

  function formatearTamano(bytes) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const numeroDosDigitos = (n) => String(n).padStart(2, "0");

  function recordarProyecto(id) {
    try {
      if (id) localStorage.setItem(ULTIMO_PROYECTO, id);
      else localStorage.removeItem(ULTIMO_PROYECTO);
    } catch (_) {
      /* almacenamiento no disponible: no es crítico */
    }
  }

  function recuperarUltimoProyecto() {
    try {
      return localStorage.getItem(ULTIMO_PROYECTO);
    } catch (_) {
      return null;
    }
  }

  // ================= Estado =================
  const estado = {
    proyecto: null, // proyecto abierto (o null si se está creando uno nuevo)
    fotos: [], // fotos del proyecto abierto, ya ordenadas
    pestana: "datos",
    formularioSucio: false,
    mostrarFaltantes: false,
    cola: [], // archivos pendientes de pasar por la vista previa
    procesando: false,
  };

  const urlsFotos = new Map(); // id de foto -> URL temporal SOLO para mostrar en pantalla
  const temporizadores = new Map(); // id de foto -> temporizador del guardado de descripción

  function urlDeFoto(foto) {
    if (!urlsFotos.has(foto.id)) urlsFotos.set(foto.id, URL.createObjectURL(foto.blob));
    return urlsFotos.get(foto.id);
  }

  function liberarUrl(id) {
    const url = urlsFotos.get(id);
    if (url) URL.revokeObjectURL(url);
    urlsFotos.delete(id);
  }

  function liberarTodasLasUrls() {
    urlsFotos.forEach((url) => URL.revokeObjectURL(url));
    urlsFotos.clear();
  }

  // ================= Mensajes y diálogos =================
  function avisar(mensaje, tipo = "ok") {
    const contenedor = $("#avisos");
    const nodo = document.createElement("div");
    nodo.className = `aviso ${tipo === "ok" ? "" : tipo}`.trim();
    nodo.textContent = mensaje;
    contenedor.appendChild(nodo);
    const duracion = tipo === "error" ? 7000 : 3500;
    setTimeout(() => nodo.remove(), duracion);
    nodo.addEventListener("click", () => nodo.remove());
  }

  /** Muestra un diálogo de confirmación. Devuelve una promesa con true/false. */
  function confirmar(mensaje, textoBoton = "Aceptar", titulo = "Confirmar") {
    return new Promise((resolve) => {
      const dialogo = $("#dlg-confirmar");
      $("#confirmar-titulo").textContent = titulo;
      $("#confirmar-texto").textContent = mensaje;
      $("#confirmar-ok").textContent = textoBoton;
      dialogo.returnValue = "";
      const alCerrar = () => {
        dialogo.removeEventListener("close", alCerrar);
        resolve(dialogo.returnValue === "ok");
      };
      dialogo.addEventListener("close", alCerrar);
      dialogo.showModal();
    });
  }

  /**
   * Muestra la imagen preparada y pide confirmación antes de guardarla.
   * Devuelve { accion: "guardar" | "cancelar" | "cancelar-todo", descripcion }.
   */
  function pedirVistaPrevia(imagen, restantes) {
    return new Promise((resolve) => {
      const dialogo = $("#dlg-previa");
      const img = $("#previa-img");
      const descripcion = $("#previa-desc");
      const url = URL.createObjectURL(imagen.blob);
      img.src = url;
      descripcion.value = "";
      $("#previa-info").textContent =
        `${imagen.ancho} × ${imagen.alto} px · ${formatearTamano(imagen.blob.size)}` +
        (restantes > 0 ? ` · ${restantes} más por revisar` : "");
      $("#previa-cancelar-todo").hidden = restantes === 0;
      dialogo.returnValue = "";

      const alCerrar = () => {
        dialogo.removeEventListener("close", alCerrar);
        URL.revokeObjectURL(url);
        img.removeAttribute("src");
        const valor = dialogo.returnValue;
        if (valor === "guardar") resolve({ accion: "guardar", descripcion: descripcion.value.trim() });
        else if (valor === "cancelar-todo") resolve({ accion: "cancelar-todo" });
        else resolve({ accion: "cancelar" }); // incluye la tecla Esc
      };
      dialogo.addEventListener("close", alCerrar);
      dialogo.showModal();
    });
  }

  // ================= Pestañas =================
  function hayProyecto() {
    return Boolean(estado.proyecto);
  }

  function irAPestana(nombre) {
    if (nombre !== "datos" && !hayProyecto()) {
      avisar("Primero guarda los datos del proyecto o selecciona uno existente.", "info");
      nombre = "datos";
    }
    estado.pestana = nombre;
    document.querySelectorAll(".pestana").forEach((boton) => {
      boton.setAttribute("aria-selected", String(boton.dataset.pestana === nombre));
    });
    ["datos", "fotos", "vista"].forEach((p) => {
      $(`#tab-${p}`).hidden = p !== nombre;
    });
    if (nombre === "vista") renderVista();
    window.scrollTo({ top: 0 });
  }

  function actualizarInterfazDeProyecto() {
    const abierto = hayProyecto();
    ["fotos", "vista"].forEach((p) => {
      $(`#t-${p}`).setAttribute("aria-disabled", String(!abierto));
    });
    $("#barra-exportar").hidden = !abierto;
    $("#btn-eliminar-proyecto").hidden = !abierto;
    $("#titulo-formulario").textContent = abierto ? "Datos del proyecto" : "Nuevo proyecto";
    const n = estado.fotos.length;
    $("#resumen-exportar").textContent = abierto ? `${n} ${n === 1 ? "foto" : "fotos"}` : "";
  }

  // ================= Formulario del proyecto =================
  const CAMPOS = [
    { clave: "codigo", etiqueta: "El código de práctica" },
    { clave: "fecha", etiqueta: "La fecha" },
    { clave: "lugar", etiqueta: "El lugar" },
    { clave: "fiscalizador", etiqueta: "El nombre del fiscalizador" },
    { clave: "establecimiento", etiqueta: "El establecimiento o unidad" },
  ];

  function leerFormulario() {
    const datos = {};
    CAMPOS.forEach(({ clave }) => {
      datos[clave] = $(`#p-${clave}`).value.trim();
    });
    return datos;
  }

  function llenarFormulario(proyecto) {
    CAMPOS.forEach(({ clave }) => {
      $(`#p-${clave}`).value = proyecto ? proyecto[clave] : clave === "fecha" ? hoyISO() : "";
    });
    mostrarErroresDeCampos({});
    marcarFormularioSucio(false);
  }

  /** Devuelve { clave: mensaje } con los problemas de los datos; {} si todo está bien. */
  function validarDatos(datos) {
    const errores = {};
    CAMPOS.forEach(({ clave, etiqueta }) => {
      if (!datos[clave] || !String(datos[clave]).trim()) errores[clave] = `${etiqueta} es obligatorio.`;
    });
    if (!errores.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) {
      errores.fecha = "La fecha no es válida.";
    }
    return errores;
  }

  function mostrarErroresDeCampos(errores) {
    CAMPOS.forEach(({ clave }) => {
      const campo = $(`#p-${clave}`);
      const mensaje = errores[clave] || "";
      $(`#e-${clave}`).textContent = mensaje;
      if (mensaje) campo.setAttribute("aria-invalid", "true");
      else campo.removeAttribute("aria-invalid");
    });
    const primero = CAMPOS.find(({ clave }) => errores[clave]);
    if (primero) $(`#p-${primero.clave}`).focus();
  }

  function marcarFormularioSucio(valor) {
    estado.formularioSucio = valor;
    $("#aviso-sucio").hidden = !valor;
  }

  async function guardarProyecto(evento) {
    evento.preventDefault();
    const datos = leerFormulario();
    const errores = validarDatos(datos);
    mostrarErroresDeCampos(errores);
    if (Object.keys(errores).length > 0) {
      avisar("Revisa los campos marcados en rojo.", "error");
      return;
    }
    const ahora = new Date().toISOString();
    const esNuevo = !estado.proyecto;
    const proyecto = esNuevo
      ? { id: nuevoId(), ...datos, creadoEn: ahora, actualizadoEn: ahora }
      : { ...estado.proyecto, ...datos, actualizadoEn: ahora };
    try {
      await Almacen.guardarProyecto(proyecto);
    } catch (error) {
      avisar(`No se pudo guardar el proyecto: ${error.message}`, "error");
      return;
    }
    if (esNuevo) {
      await abrirProyecto(proyecto.id);
      avisar("Proyecto creado. Ya puedes agregar fotografías.");
      irAPestana("fotos");
    } else {
      estado.proyecto = proyecto;
      marcarFormularioSucio(false);
      await refrescarSelector();
      actualizarInterfazDeProyecto();
      avisar("Datos del proyecto actualizados.");
    }
  }

  // ================= Lista de proyectos =================
  async function refrescarSelector() {
    const selector = $("#selector-proyecto");
    const lista = await Almacen.listarProyectos();
    selector.replaceChildren();
    if (!estado.proyecto) {
      selector.add(new Option(lista.length ? "Nuevo proyecto (sin guardar)" : "Sin proyectos todavía", ""));
    }
    lista.forEach((p) => selector.add(new Option(`${p.codigo} — ${p.establecimiento}`, p.id)));
    selector.value = estado.proyecto ? estado.proyecto.id : "";
  }

  /** Abre un proyecto cargando SOLO sus fotos (así no se mezclan con otros). */
  async function abrirProyecto(id) {
    await vaciarGuardadosPendientes();
    const proyecto = await Almacen.obtenerProyecto(id);
    if (!proyecto) {
      avisar("No se encontró ese proyecto.", "error");
      return;
    }
    const fotos = await Almacen.listarFotos(id);
    liberarTodasLasUrls();
    estado.proyecto = proyecto;
    estado.fotos = fotos;
    estado.mostrarFaltantes = false;
    estado.cola = [];
    recordarProyecto(id);
    llenarFormulario(proyecto);
    ocultarProblemas();
    await refrescarSelector();
    actualizarInterfazDeProyecto();
    renderGaleria();
    if (estado.pestana === "vista") renderVista();
  }

  async function prepararProyectoNuevo() {
    await vaciarGuardadosPendientes();
    liberarTodasLasUrls();
    estado.proyecto = null;
    estado.fotos = [];
    estado.cola = [];
    estado.mostrarFaltantes = false;
    llenarFormulario(null);
    ocultarProblemas();
    await refrescarSelector();
    actualizarInterfazDeProyecto();
    renderGaleria();
    irAPestana("datos");
    $("#p-codigo").focus();
  }

  async function descartarCambiosSiHaceFalta() {
    if (!estado.formularioSucio) return true;
    return confirmar(
      "Hay cambios sin guardar en los datos del proyecto. Si continúas, se perderán.",
      "Descartar cambios",
      "Cambios sin guardar"
    );
  }

  async function alElegirProyecto() {
    const selector = $("#selector-proyecto");
    const id = selector.value;
    if (!id) return;
    if (estado.proyecto && estado.proyecto.id === id) return;
    if (!(await descartarCambiosSiHaceFalta())) {
      selector.value = estado.proyecto ? estado.proyecto.id : "";
      return;
    }
    await abrirProyecto(id);
    irAPestana(estado.pestana === "datos" ? "fotos" : estado.pestana);
  }

  async function alPulsarNuevoProyecto() {
    if (!(await descartarCambiosSiHaceFalta())) return;
    await prepararProyectoNuevo();
  }

  async function eliminarProyectoActual() {
    const proyecto = estado.proyecto;
    if (!proyecto) return;
    const n = estado.fotos.length;
    const ok = await confirmar(
      `Se eliminará el proyecto «${proyecto.codigo}» y sus ${n} ${n === 1 ? "fotografía" : "fotografías"}. Esta acción no se puede deshacer.`,
      "Eliminar proyecto",
      "Eliminar proyecto"
    );
    if (!ok) return;
    try {
      await vaciarGuardadosPendientes();
      await Almacen.eliminarProyecto(proyecto.id);
    } catch (error) {
      avisar(`No se pudo eliminar el proyecto: ${error.message}`, "error");
      return;
    }
    avisar("Proyecto eliminado.");
    estado.proyecto = null;
    const restantes = await Almacen.listarProyectos();
    if (restantes.length > 0) {
      await abrirProyecto(restantes[0].id);
      irAPestana("datos");
    } else {
      recordarProyecto(null);
      await prepararProyectoNuevo();
    }
  }

  // ================= Captura de fotografías =================
  async function iniciarCaptura(archivos) {
    if (!hayProyecto()) {
      avisar("Primero guarda los datos del proyecto.", "error");
      return;
    }
    const seleccion = Array.from(archivos);
    if (seleccion.length === 0) return;

    if (seleccion.length === 1) {
      estado.cola.push(...seleccion);
      procesarCola();
      return;
    }

    if (estado.procesando) {
      avisar("Hay otra selección abierta. Termínala antes de elegir más fotografías.", "info");
      return;
    }

    estado.procesando = true;
    try {
      const preparadas = [];
      let fallidas = 0;
      await Promise.all(seleccion.map(async (archivo) => {
        try {
          preparadas.push({ archivo, imagen: await Captura.prepararImagen(archivo) });
        } catch (error) {
          fallidas++;
          avisar(`No se pudo usar «${archivo.name || "la imagen"}»: ${error.message}.`, "error");
        }
      }));
      preparadas.sort((a, b) => seleccion.indexOf(a.archivo) - seleccion.indexOf(b.archivo));

      const descripciones = await pedirVistaLote(preparadas);
      if (descripciones === null) {
        avisar("Selección cancelada. No se agregó ninguna foto.", "info");
        return;
      }

      let guardadas = 0;
      for (let indice = 0; indice < preparadas.length; indice++) {
        try {
          await guardarNuevaFoto(
            estado.proyecto.id,
            preparadas[indice].imagen,
            descripciones[indice],
            preparadas[indice].archivo.name
          );
          guardadas++;
        } catch (error) {
          fallidas++;
          avisar(`No se pudo guardar «${preparadas[indice].archivo.name || "la foto"}»: ${error.message}`, "error");
        }
      }
      if (guardadas > 0) {
        avisar(`${guardadas} ${guardadas === 1 ? "foto guardada" : "fotos guardadas"}.${fallidas ? ` ${fallidas} no se pudo procesar.` : ""}`);
      }
    } finally {
      estado.procesando = false;
    }
  }

  function capturaCancelada() {
    avisar("No se agregó ninguna foto (captura cancelada o sin permiso). Puedes intentarlo de nuevo.", "info");
  }

  async function pedirVistaLote(imagenes) {
    return new Promise((resolve) => {
      const dialogo = $("#dlg-lote");
      const contenedor = $("#lote-galeria");
      const urls = [];
      contenedor.replaceChildren();
      $("#lote-cantidad").textContent = String(imagenes.length);

      imagenes.forEach((item, indice) => {
        const url = URL.createObjectURL(item.imagen.blob);
        urls.push(url);
        const tarjeta = document.createElement("article");
        tarjeta.className = "lote-foto";
        const nombre = item.archivo.name || `Fotografía ${indice + 1}`;
        const figura = document.createElement("figure");
        const vista = document.createElement("img");
        vista.src = url;
        vista.alt = `Vista previa de ${nombre}`;
        figura.appendChild(vista);

        const cuerpo = document.createElement("div");
        cuerpo.className = "lote-foto-cuerpo";
        const nombreVisible = document.createElement("p");
        nombreVisible.className = "lote-foto-nombre";
        nombreVisible.title = nombre;
        nombreVisible.textContent = nombre;
        const etiqueta = document.createElement("label");
        etiqueta.htmlFor = `lote-desc-${indice}`;
        etiqueta.textContent = "Descripción";
        const campo = document.createElement("textarea");
        campo.id = `lote-desc-${indice}`;
        campo.rows = 3;
        campo.maxLength = 500;
        campo.placeholder = "Describe lo que muestra esta foto";
        cuerpo.append(nombreVisible, etiqueta, campo);
        tarjeta.append(figura, cuerpo);
        contenedor.appendChild(tarjeta);
      });

      dialogo.returnValue = "";
      const alCerrar = () => {
        dialogo.removeEventListener("close", alCerrar);
        const descripciones = Array.from(contenedor.querySelectorAll("textarea"), (campo) => campo.value.trim());
        urls.forEach((url) => URL.revokeObjectURL(url));
        contenedor.replaceChildren();
        resolve(dialogo.returnValue === "guardar-lote" ? descripciones : null);
      };
      dialogo.addEventListener("close", alCerrar);
      dialogo.showModal();
    });
  }

  /** Procesa de a una las imágenes pendientes: vista previa -> confirmar -> guardar. */
  async function procesarCola() {
    if (estado.procesando) return;
    estado.procesando = true;
    const proyectoId = estado.proyecto.id;
    let guardadas = 0;
    let descartadas = 0;
    let fallidas = 0;

    try {
      while (estado.cola.length > 0) {
        const archivo = estado.cola.shift();
        let imagen;
        try {
          imagen = await Captura.prepararImagen(archivo);
        } catch (error) {
          fallidas++;
          avisar(`No se pudo usar «${archivo.name || "la imagen"}»: ${error.message}.`, "error");
          continue;
        }

        const respuesta = await pedirVistaPrevia(imagen, estado.cola.length);
        if (respuesta.accion === "cancelar-todo") {
          descartadas += 1 + estado.cola.length;
          estado.cola.length = 0;
          break;
        }
        if (respuesta.accion === "cancelar") {
          descartadas++;
          continue;
        }
        if (!estado.proyecto || estado.proyecto.id !== proyectoId) break;

        try {
          await guardarNuevaFoto(proyectoId, imagen, respuesta.descripcion, archivo.name);
          guardadas++;
        } catch (error) {
          fallidas++;
          avisar(`No se pudo guardar la foto: ${error.message}`, "error");
        }
      }
    } finally {
      estado.procesando = false;
    }

    if (guardadas > 0) {
      avisar(guardadas === 1 ? "Foto guardada." : `${guardadas} fotos guardadas.`);
    }
    if (descartadas > 0 && guardadas === 0 && fallidas === 0) {
      avisar("Captura cancelada. No se guardó la foto.", "info");
    }
  }

  async function guardarNuevaFoto(proyectoId, imagen, descripcion, nombreOriginal) {
    const orden = estado.fotos.length > 0 ? Math.max(...estado.fotos.map((f) => f.orden)) + 1 : 0;
    const foto = {
      id: nuevoId(),
      proyectoId,
      blob: imagen.blob, // la imagen en sí, no una ruta
      tipo: imagen.blob.type,
      ancho: imagen.ancho,
      alto: imagen.alto,
      nombreOriginal: nombreOriginal || "",
      descripcion,
      agregadaEn: new Date().toISOString(), // fecha/hora de incorporación en la app
      orden,
    };
    await Almacen.guardarFoto(foto); // espera la confirmación del guardado

    // Comprobación de recuperación: se vuelve a leer lo guardado.
    const leida = await Almacen.obtenerFoto(foto.id);
    if (!leida || !leida.blob || leida.blob.size !== foto.blob.size) {
      throw new Error("no se pudo verificar la imagen guardada");
    }

    estado.fotos.push(foto);
    actualizarInterfazDeProyecto();
    renderGaleria();
  }

  // ================= Galería =================
  function renderGaleria() {
    const galeria = $("#galeria");
    const plantilla = $("#plantilla-foto");
    galeria.replaceChildren();
    $("#galeria-vacia").hidden = estado.fotos.length > 0;
    $("#contador-fotos").textContent = String(estado.fotos.length);

    estado.fotos.forEach((foto, indice) => {
      const numero = numeroDosDigitos(indice + 1);
      const tarjeta = plantilla.content.firstElementChild.cloneNode(true);
      tarjeta.dataset.id = foto.id;

      const imagen = $("img", tarjeta);
      imagen.src = urlDeFoto(foto);
      imagen.alt = foto.descripcion ? foto.descripcion : `Foto N.º ${numero}`;

      $(".foto-numero", tarjeta).textContent = Exportador.etiquetaFoto(indice + 1);

      const descripcion = $("textarea", tarjeta);
      descripcion.value = foto.descripcion;
      descripcion.setAttribute("aria-label", `Descripción de la ${Exportador.etiquetaFoto(indice + 1)}`);

      $(".foto-meta", tarjeta).textContent = `Incorporada: ${formatearFechaHora(foto.agregadaEn)}`;

      $('[data-accion="subir"]', tarjeta).disabled = indice === 0;
      $('[data-accion="bajar"]', tarjeta).disabled = indice === estado.fotos.length - 1;

      if (estado.mostrarFaltantes && !foto.descripcion.trim()) {
        tarjeta.classList.add("falta");
        descripcion.setAttribute("aria-invalid", "true");
      }
      galeria.appendChild(tarjeta);
    });
  }

  function tarjetaDe(id) {
    return $(`.foto-card[data-id="${id}"]`);
  }

  // ----- Guardado de descripciones (con espera breve mientras se escribe) -----
  function programarGuardadoDescripcion(id) {
    clearTimeout(temporizadores.get(id));
    temporizadores.set(id, setTimeout(() => guardarDescripcion(id), 500));
  }

  async function guardarDescripcion(id) {
    clearTimeout(temporizadores.get(id));
    temporizadores.delete(id);
    const foto = estado.fotos.find((f) => f.id === id);
    if (!foto) return;
    try {
      await Almacen.actualizarDescripcion(id, foto.descripcion);
      const tarjeta = tarjetaDe(id);
      if (tarjeta) {
        const marca = $(".estado-guardado", tarjeta);
        marca.textContent = "✓ Guardado";
        setTimeout(() => {
          if (marca.textContent === "✓ Guardado") marca.textContent = "";
        }, 1500);
      }
    } catch (error) {
      avisar(`No se pudo guardar la descripción: ${error.message}`, "error");
    }
  }

  async function vaciarGuardadosPendientes() {
    const ids = Array.from(temporizadores.keys());
    await Promise.all(ids.map((id) => guardarDescripcion(id)));
  }

  // ----- Mover y eliminar -----
  async function moverFoto(id, desplazamiento) {
    await vaciarGuardadosPendientes();
    const i = estado.fotos.findIndex((f) => f.id === id);
    const j = i + desplazamiento;
    if (i < 0 || j < 0 || j >= estado.fotos.length) return;

    const nueva = estado.fotos.map((f) => ({ ...f }));
    [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
    nueva.forEach((f, k) => {
      f.orden = k;
    });
    try {
      await Almacen.guardarFotos([nueva[i], nueva[j]]);
    } catch (error) {
      avisar(`No se pudo cambiar el orden: ${error.message}`, "error");
      return;
    }
    estado.fotos = nueva;
    renderGaleria();
    const tarjeta = tarjetaDe(id);
    if (tarjeta) {
      tarjeta.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const boton = $(`[data-accion="${desplazamiento < 0 ? "subir" : "bajar"}"]`, tarjeta);
      (boton && !boton.disabled ? boton : $('[data-accion="eliminar"]', tarjeta)).focus({ preventScroll: true });
    }
    avisar(`La foto ahora es la ${Exportador.etiquetaFoto(j + 1)}.`);
  }

  async function eliminarFoto(id) {
    const indice = estado.fotos.findIndex((f) => f.id === id);
    if (indice < 0) return;
    const ok = await confirmar(
      `¿Eliminar la ${Exportador.etiquetaFoto(indice + 1)}? Las demás se volverán a numerar. Esta acción no se puede deshacer.`,
      "Eliminar foto",
      "Eliminar fotografía"
    );
    if (!ok) return;
    await vaciarGuardadosPendientes();
    const restantes = estado.fotos
      .filter((f) => f.id !== id)
      .map((f, k) => ({ ...f, orden: k }));
    try {
      await Almacen.eliminarFotoYReordenar(id, restantes);
    } catch (error) {
      avisar(`No se pudo eliminar la foto: ${error.message}`, "error");
      return;
    }
    liberarUrl(id);
    estado.fotos = restantes;
    actualizarInterfazDeProyecto();
    renderGaleria();
    avisar("Foto eliminada. La numeración se actualizó.");
  }

  // ================= Vista previa del anexo =================
  function crear(etiqueta, clase, texto) {
    const nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  }

  function renderVista() {
    const contenedor = $("#vista");
    contenedor.replaceChildren();
    const proyecto = estado.proyecto;
    if (!proyecto) return;

    if (estado.fotos.length === 0) {
      contenedor.appendChild(crear("p", "vacio", "Aún no hay fotografías para mostrar."));
      return;
    }

    const porPagina = 2;
    for (let inicio = 0; inicio < estado.fotos.length; inicio += porPagina) {
      const hoja = crear("div", "hoja");
      hoja.appendChild(crear("div", "hoja-pagina", `Página ${inicio / porPagina + 1}`));

      if (inicio === 0) {
        hoja.appendChild(crear("h3", "hoja-titulo", "ANEXO 2 REGISTRO FOTOGRÁFICO"));
        const datos = crear("div", "hoja-datos");
        [
          ["Código", proyecto.codigo],
          ["Fiscalizador", proyecto.fiscalizador],
          ["Lugar", proyecto.lugar],
          ["Establecimiento", proyecto.establecimiento],
        ].forEach(([etiqueta, valor]) => {
          const linea = crear("p");
          linea.appendChild(crear("strong", "", `${etiqueta}: `));
          linea.appendChild(document.createTextNode(valor));
          datos.appendChild(linea);
        });
        hoja.appendChild(datos);
      }

      const tabla = crear("div", "tabla-anexo");
      if (inicio === 0) {
        tabla.appendChild(crear("div", "fila-fecha", `FOTOGRAFÍAS DE FECHA ${Exportador.fechaLarga(proyecto.fecha)}`));
      }
      estado.fotos.slice(inicio, inicio + porPagina).forEach((foto, k) => {
        const numero = inicio + k + 1;
        const filaImagen = crear("div", "fila-imagen");
        const img = crear("img");
        img.src = urlDeFoto(foto);
        img.alt = foto.descripcion || Exportador.etiquetaFoto(numero);
        filaImagen.appendChild(img);
        tabla.appendChild(filaImagen);

        const pie = crear("div", "fila-pie");
        pie.appendChild(crear("div", "num", Exportador.etiquetaFoto(numero)));
        const descripcion = crear("div", "desc", foto.descripcion || "(falta la descripción)");
        if (!foto.descripcion.trim()) descripcion.classList.add("vacia");
        pie.appendChild(descripcion);
        tabla.appendChild(pie);
      });
      hoja.appendChild(tabla);
      contenedor.appendChild(hoja);
    }
  }

  // ================= Validación y exportación =================
  function validarParaExportar() {
    const problemas = [];
    if (!estado.proyecto) return ["No hay un proyecto abierto."];

    if (estado.formularioSucio) {
      problemas.push("Hay cambios sin guardar en los datos del proyecto. Ve a «Datos» y pulsa «Guardar proyecto».");
    }
    const errores = validarDatos(estado.proyecto);
    Object.values(errores).forEach((mensaje) => problemas.push(`Datos del proyecto: ${mensaje}`));

    if (estado.fotos.length === 0) problemas.push("Agrega al menos una fotografía.");
    estado.fotos.forEach((foto, i) => {
      if (!foto.descripcion.trim()) problemas.push(`${Exportador.etiquetaFoto(i + 1)}: falta la descripción.`);
    });
    return problemas;
  }

  function mostrarProblemas(problemas) {
    const caja = $("#problemas");
    caja.replaceChildren();
    caja.appendChild(crear("strong", "", "No se puede generar el Word todavía. Corrige lo siguiente:"));
    const lista = crear("ul");
    problemas.forEach((p) => lista.appendChild(crear("li", "", p)));
    caja.appendChild(lista);
    caja.hidden = false;
  }

  function ocultarProblemas() {
    $("#problemas").hidden = true;
    $("#problemas").replaceChildren();
  }

  async function generarWord() {
    const boton = $("#btn-generar");
    await vaciarGuardadosPendientes();

    const problemas = validarParaExportar();
    if (problemas.length > 0) {
      estado.mostrarFaltantes = true;
      renderGaleria();
      irAPestana("vista");
      mostrarProblemas(problemas);
      avisar(`No se puede exportar: hay ${problemas.length} ${problemas.length === 1 ? "punto" : "puntos"} por corregir.`, "error");
      return;
    }

    ocultarProblemas();
    estado.mostrarFaltantes = false;
    boton.disabled = true;
    const textoOriginal = boton.textContent;
    boton.textContent = "Generando…";
    try {
      const blob = await Exportador.generar(estado.proyecto, estado.fotos);
      const nombre = Exportador.nombreArchivo(estado.proyecto);
      Exportador.descargar(blob, nombre);
      avisar(`Word generado (${estado.fotos.length} fotos): ${nombre}`);
    } catch (error) {
      avisar(`No se pudo generar el Word: ${error.message}`, "error");
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }

  // ================= Eventos =================
  function conectarEventos() {
    // Pestañas
    document.querySelector(".pestanas").addEventListener("click", (evento) => {
      const boton = evento.target.closest(".pestana");
      if (boton) irAPestana(boton.dataset.pestana);
    });

    // Proyecto: selector, nuevo, formulario, eliminar
    $("#selector-proyecto").addEventListener("change", alElegirProyecto);
    $("#btn-nuevo-proyecto").addEventListener("click", alPulsarNuevoProyecto);
    $("#form-proyecto").addEventListener("submit", guardarProyecto);
    $("#form-proyecto").addEventListener("input", () => marcarFormularioSucio(true));
    $("#btn-eliminar-proyecto").addEventListener("click", eliminarProyectoActual);

    // Captura: cámara trasera y selección de archivos
    const entradas = { alSeleccionar: iniciarCaptura, alCancelar: capturaCancelada };
    Captura.conectarEntrada($("#entrada-camara"), entradas);
    Captura.conectarEntrada($("#entrada-galeria"), entradas);
    $("#btn-tomar").addEventListener("click", () => $("#entrada-camara").click());
    $("#btn-agregar").addEventListener("click", () => $("#entrada-galeria").click());

    // Galería: UN solo escuchador para todas las fotos (delegación de eventos)
    const galeria = $("#galeria");
    galeria.addEventListener("click", (evento) => {
      const boton = evento.target.closest("button[data-accion]");
      if (!boton) return;
      const tarjeta = boton.closest(".foto-card");
      const id = tarjeta.dataset.id;
      const accion = boton.dataset.accion;
      if (accion === "subir") moverFoto(id, -1);
      else if (accion === "bajar") moverFoto(id, 1);
      else if (accion === "eliminar") eliminarFoto(id);
    });
    galeria.addEventListener("input", (evento) => {
      const campo = evento.target.closest('textarea[data-campo="descripcion"]');
      if (!campo) return;
      const tarjeta = campo.closest(".foto-card");
      const foto = estado.fotos.find((f) => f.id === tarjeta.dataset.id);
      if (!foto) return;
      foto.descripcion = campo.value;
      if (campo.value.trim()) {
        tarjeta.classList.remove("falta");
        campo.removeAttribute("aria-invalid");
      }
      programarGuardadoDescripcion(foto.id);
    });
    galeria.addEventListener("focusout", (evento) => {
      const campo = evento.target.closest('textarea[data-campo="descripcion"]');
      if (!campo) return;
      const tarjeta = campo.closest(".foto-card");
      if (temporizadores.has(tarjeta.dataset.id)) guardarDescripcion(tarjeta.dataset.id);
    });

    // Exportación
    $("#btn-generar").addEventListener("click", generarWord);

    // Avisar si se intenta cerrar con datos del formulario sin guardar
    window.addEventListener("beforeunload", (evento) => {
      if (estado.formularioSucio) {
        evento.preventDefault();
        evento.returnValue = "";
      }
    });
    // Al ocultar la página, guardar las descripciones que aún esperan
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") vaciarGuardadosPendientes();
    });
  }

  // ================= Inicio =================
  async function iniciar() {
    conectarEventos();
    try {
      await Almacen.abrir();
    } catch (error) {
      avisar(`No se pudo abrir el almacenamiento del navegador: ${error.message}`, "error");
      return;
    }
    Almacen.pedirPersistencia();

    try {
      const proyectos = await Almacen.listarProyectos();
      const recordado = recuperarUltimoProyecto();
      const inicial = proyectos.find((p) => p.id === recordado) || proyectos[0];
      if (inicial) {
        await abrirProyecto(inicial.id);
        irAPestana("fotos");
      } else {
        await prepararProyectoNuevo();
      }
    } catch (error) {
      avisar(`No se pudieron cargar los datos guardados: ${error.message}`, "error");
    }
  }

  iniciar();
})();
