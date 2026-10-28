"use strict";

/**
 * Módulo de almacenamiento (IndexedDB).
 *
 * Base de datos: "registro_fotografico"
 *   - almacén "proyectos": un registro por fiscalización (keyPath: id)
 *   - almacén "fotos":     un registro por fotografía (keyPath: id)
 *                          índice "porProyecto" sobre proyectoId, así las fotos
 *                          de un proyecto nunca se mezclan con las de otro.
 *
 * Cada foto guarda el archivo de imagen como Blob (no una ruta ni una URL
 * temporal), junto con su descripción, fecha/hora de incorporación y orden.
 *
 * Todas las operaciones devuelven una promesa que se resuelve SOLO cuando la
 * transacción terminó (evento "complete"), es decir, cuando el guardado está
 * confirmado por el navegador.
 */
const Almacen = (() => {
  const NOMBRE_BD = "registro_fotografico";
  const VERSION = 1;
  let conexion = null;

  /** Abre (o crea) la base de datos y reutiliza la conexión. */
  function abrir() {
    if (conexion) return conexion;
    conexion = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Este navegador no admite IndexedDB."));
        return;
      }
      const peticion = indexedDB.open(NOMBRE_BD, VERSION);
      peticion.onupgradeneeded = () => {
        const bd = peticion.result;
        if (!bd.objectStoreNames.contains("proyectos")) {
          bd.createObjectStore("proyectos", { keyPath: "id" });
        }
        if (!bd.objectStoreNames.contains("fotos")) {
          const fotos = bd.createObjectStore("fotos", { keyPath: "id" });
          fotos.createIndex("porProyecto", "proyectoId", { unique: false });
        }
      };
      peticion.onsuccess = () => {
        const bd = peticion.result;
        bd.onversionchange = () => {
          bd.close();
          conexion = null;
        };
        resolve(bd);
      };
      peticion.onerror = () => reject(peticion.error);
      peticion.onblocked = () =>
        reject(new Error("La base de datos está bloqueada. Cierra otras pestañas de la aplicación y recarga."));
    });
    conexion.catch(() => {
      conexion = null;
    });
    return conexion;
  }

  /** Convierte una IDBRequest en promesa. */
  function pedir(peticion) {
    return new Promise((resolve, reject) => {
      peticion.onsuccess = () => resolve(peticion.result);
      peticion.onerror = () => reject(peticion.error);
    });
  }

  /**
   * Ejecuta `trabajo(transaccion)` y resuelve con su resultado una vez que la
   * transacción terminó correctamente.
   */
  async function transaccion(almacenes, modo, trabajo) {
    const bd = await abrir();
    return new Promise((resolve, reject) => {
      let t;
      try {
        t = bd.transaction(almacenes, modo);
      } catch (error) {
        reject(error);
        return;
      }
      let resultado;
      t.oncomplete = () => resolve(resultado);
      t.onabort = () => reject(t.error || new Error("La operación fue cancelada."));
      let promesa;
      try {
        promesa = Promise.resolve(trabajo(t));
      } catch (error) {
        promesa = Promise.reject(error);
      }
      promesa
        .then((valor) => {
          resultado = valor;
        })
        .catch((error) => {
          try {
            t.abort();
          } catch (_) {
            /* la transacción ya había terminado */
          }
          reject(error);
        });
    });
  }

  // ---------- Proyectos ----------

  function listarProyectos() {
    return transaccion("proyectos", "readonly", async (t) => {
      const lista = await pedir(t.objectStore("proyectos").getAll());
      return lista.sort((a, b) => (b.actualizadoEn || "").localeCompare(a.actualizadoEn || ""));
    });
  }

  function obtenerProyecto(id) {
    return transaccion("proyectos", "readonly", (t) => pedir(t.objectStore("proyectos").get(id)));
  }

  function guardarProyecto(proyecto) {
    return transaccion("proyectos", "readwrite", async (t) => {
      await pedir(t.objectStore("proyectos").put(proyecto));
      return proyecto;
    });
  }

  /** Elimina el proyecto y TODAS sus fotos en una sola transacción. */
  function eliminarProyecto(id) {
    return transaccion(["proyectos", "fotos"], "readwrite", async (t) => {
      const fotos = t.objectStore("fotos");
      const claves = await pedir(fotos.index("porProyecto").getAllKeys(IDBKeyRange.only(id)));
      claves.forEach((clave) => fotos.delete(clave));
      t.objectStore("proyectos").delete(id);
    });
  }

  // ---------- Fotos ----------

  /** Devuelve las fotos de UN proyecto, ordenadas por el orden elegido. */
  function listarFotos(proyectoId) {
    return transaccion("fotos", "readonly", async (t) => {
      const lista = await pedir(t.objectStore("fotos").index("porProyecto").getAll(IDBKeyRange.only(proyectoId)));
      return lista.sort((a, b) => a.orden - b.orden);
    });
  }

  function obtenerFoto(id) {
    return transaccion("fotos", "readonly", (t) => pedir(t.objectStore("fotos").get(id)));
  }

  function guardarFoto(foto) {
    return transaccion("fotos", "readwrite", async (t) => {
      await pedir(t.objectStore("fotos").put(foto));
      return foto;
    });
  }

  /** Guarda varias fotos a la vez (por ejemplo, tras cambiar el orden). */
  function guardarFotos(lista) {
    return transaccion("fotos", "readwrite", (t) => {
      const almacen = t.objectStore("fotos");
      lista.forEach((foto) => almacen.put(foto));
    });
  }

  /** Actualiza solo la descripción de una foto, sin tocar lo demás. */
  function actualizarDescripcion(id, descripcion) {
    return transaccion("fotos", "readwrite", async (t) => {
      const almacen = t.objectStore("fotos");
      const foto = await pedir(almacen.get(id));
      if (!foto) return false;
      foto.descripcion = descripcion;
      await pedir(almacen.put(foto));
      return true;
    });
  }

  /** Borra una foto y guarda la nueva numeración de las restantes. */
  function eliminarFotoYReordenar(id, restantes) {
    return transaccion("fotos", "readwrite", (t) => {
      const almacen = t.objectStore("fotos");
      almacen.delete(id);
      restantes.forEach((foto) => almacen.put(foto));
    });
  }

  /** Pide al navegador que no borre los datos automáticamente (si puede). */
  function pedirPersistencia() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().catch(() => false);
      }
    } catch (_) {
      /* no es crítico */
    }
    return Promise.resolve(false);
  }

  return {
    abrir,
    listarProyectos,
    obtenerProyecto,
    guardarProyecto,
    eliminarProyecto,
    listarFotos,
    obtenerFoto,
    guardarFoto,
    guardarFotos,
    actualizarDescripcion,
    eliminarFotoYReordenar,
    pedirPersistencia,
  };
})();
