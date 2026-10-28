# Registro fotográfico de fiscalización en campo

Tarea individual HT 03 – Frontend con JavaScript (HTML + CSS + JavaScript, sin servidor ni cuentas).

**Alumno:** Sabino Diego Leydi _

La aplicación permite crear proyectos de fiscalización, tomar o elegir fotografías, escribir su
descripción, ordenarlas y descargar un **anexo fotográfico en Word (.docx)** real, con las imágenes
incrustadas, numeradas y listas para editar.

---

## 1. Estructura del proyecto

```
registro-fotografico/
├── index.html              Interfaz (formulario, galería, vista previa, diálogos)
├── css/
│   └── estilos.css         Estilos adaptables a celular y PC
├── js/
│   ├── app.js              Interfaz, eventos y validaciones
│   ├── almacenamiento.js   Módulo de guardado en IndexedDB
│   ├── captura.js          Módulo de captura/selección y preparación de imágenes
│   ├── exportar.js         Módulo que genera el .docx
│   └── vendor/
│       ├── docx.iife.js    Biblioteca "docx" 9.6.1 (MIT), incluida para funcionar sin internet
│       └── docx.LICENSE.txt
├── iniciar.bat             Atajo para Windows (abre un servidor local)
├── iniciar.sh              Atajo para Mac/Linux
└── README.md
```

## 2. Dependencias

| Dependencia | Para qué se usa | Cómo se incluye |
|---|---|---|
| [docx](https://github.com/dolanmiu/docx) 9.6.1 (licencia MIT) | Generar el archivo .docx en el navegador | Copiada en `js/vendor/` (no hay que instalar nada ni usar internet) |
| Navegador moderno (Chrome, Edge, Firefox, Safari 15.4+) | IndexedDB, `<dialog>`, `createImageBitmap` | — |
| Python 3 *(opcional)* | Solo para abrir un servidor local con `iniciar.bat` / `iniciar.sh` | — |
| Fuente **Poppins** *(opcional)* | Se usa en el Word. Si no está instalada, Word la reemplaza por otra | Descargar de Google Fonts |

**No hay base de datos que conectar.** Los datos se guardan en **IndexedDB**, que ya viene dentro
del navegador (la tarea pide este almacenamiento). No se usa SQLite, servidor, `npm` ni `package.json`.

## 3. Cómo ejecutarlo en la computadora

Elige **una** de estas formas (la carpeta debe estar descomprimida):

**Opción A – Visual Studio Code + Live Server (recomendada)**
1. Abre la carpeta `registro-fotografico` en VS Code (*Archivo > Abrir carpeta*).
2. Instala la extensión **Live Server** (Ritwick Dey).
3. Clic derecho sobre `index.html` > **Open with Live Server**. Se abre `http://127.0.0.1:5500`.

**Opción B – Python (con el atajo incluido)**
- Windows: doble clic en `iniciar.bat`.
- Mac/Linux: en la terminal, `sh iniciar.sh`.
- Se abre `http://localhost:8000`. Para detener el servidor, cierra la ventana o pulsa `Ctrl + C`.

**Opción C – Manual**
```
cd registro-fotografico
python -m http.server 8000      (en Windows también: py -m http.server 8000)
```
y entra a `http://localhost:8000`.

> También puede abrirse `index.html` con doble clic (`file://`) en Chrome/Edge y casi todo funciona,
> pero se recomienda usar un servidor local para evitar restricciones del navegador.

## 4. Cómo habilitar la captura en el celular

La captura usa `<input type="file" accept="image/*" capture="environment">`: el celular abre su
**cámara trasera** y devuelve la foto. No necesita HTTPS ni permisos especiales de la página.

1. Conecta el celular y la computadora a la **misma red Wi-Fi**.
2. Inicia el servidor con la opción B o C de la sección 3 (escuchan en toda la red local).
3. En la computadora averigua su IP: `ipconfig` (Windows, línea *Dirección IPv4*, por ejemplo
   `192.168.1.20`) o `ifconfig`/`ip a` (Mac/Linux).
4. En el navegador del celular abre `http://192.168.1.20:8000` (usa tu IP y tu puerto).
5. Si no carga, permite Python/Node en el **Firewall de Windows** para redes privadas.
6. Pulsa **Tomar foto**: el sistema pedirá permiso de cámara si hace falta. Si lo deniegas o
   cancelas, la app muestra un mensaje y puedes continuar con **Agregar imágenes**.

Otras formas de abrirla en el celular: publicar la carpeta en GitHub Pages / Netlify (HTTPS), o usar
un túnel como Cloudflare Tunnel o ngrok.

**Importante:** los datos viven en el navegador *y en la dirección* donde se abrió la app.
`http://localhost:8000` y `http://192.168.1.20:8000` guardan datos **distintos**. Si registras las
fotos en el celular, genera el Word desde el celular (se descarga allí).

## 5. Cómo se usa

1. **Datos:** completa código, fecha, lugar, fiscalizador y establecimiento ficticio y pulsa
   *Guardar proyecto*. Con **+ Nuevo** o el selector superior creas/abres otros proyectos; cada uno
   tiene sus propias fotos.
2. **Fotos:** *Tomar foto* o *Agregar imágenes* (puedes elegir varias). Cada imagen muestra una
   **vista previa**; escribe la descripción y confirma, o cancela. Luego puedes editar la descripción,
   **Subir/Bajar** para ordenar y **Eliminar** (con confirmación). La numeración sigue el orden.
3. **Vista previa:** muestra el anexo tal como saldrá (dos fotos por página).
4. **Generar Word:** el botón fijo inferior descarga
   `Anexo2_Registro_Fotografico_<CÓDIGO>.docx`. Si falta algún dato o descripción, **no exporta** y
   lista qué debes corregir.

### Formato del Word generado
- A4 vertical, márgenes de 2,54 cm.
- Título, datos del proyecto y una **tabla continua de dos columnas**: encabezado *FOTOGRAFÍAS DE FECHA …*,
  fila de imagen combinada (ancho completo) y debajo *Foto N.º 01* | descripción.
- Imágenes incrustadas con sus proporciones; dos fotografías por página; cada foto se mantiene junto
  a su descripción.
- Poppins de 8 pt en etiquetas y descripciones.
- La fecha y hora que muestra la app de cada foto es la de **incorporación a la app**; no se presenta
  como certificación de la fecha original de la imagen (y no se incluye en el Word).

## 6. Pruebas que se deben demostrar

- [ ] Capturar una foto desde el celular, guardarla y verla en la galería.
- [ ] Cerrar y abrir la app en el mismo navegador y recuperar fotos y descripciones.
- [ ] Mover una foto, eliminar otra y verificar la nueva numeración.
- [ ] Exportar y abrir el Word (sin conexión) con las imágenes del dispositivo.
- [ ] Intentar exportar con datos o descripciones faltantes: la app lo impide e indica qué corregir.
- [ ] Crear un segundo proyecto y comprobar que no aparecen las fotos del primero.
- [ ] Registrar al menos **seis fotos propias**, reordenar, eliminar una, agregar otra, recargar y exportar.

## 7. Guía breve para la sustentación

**Eventos de JavaScript (`js/app.js`)**
- `submit` del formulario → valida y guarda el proyecto.
- `input` del formulario → marca “cambios sin guardar”.
- `change` / `cancel` de los `<input type="file">` (`js/captura.js`) → llegan las fotos o se cancela.
- Galería con **delegación de eventos**: un solo `click` y un solo `input` para todas las fotos
  (se identifica la foto con `data-id`), sin repetir código por fotografía. Cada tarjeta nace de un
  `<template>` clonado.
- `close` de los `<dialog>` → vista previa y confirmaciones (devuelven una promesa).
- `click` en *Generar Word* → valida, construye el documento y descarga.

**Guardado de imágenes (`js/almacenamiento.js`)**
- IndexedDB `registro_fotografico` con dos almacenes: `proyectos` y `fotos` (índice `porProyecto`).
- Cada foto guarda el **Blob** de la imagen (no una ruta ni una URL temporal), descripción, fecha y hora
  de incorporación, identificador propio, `proyectoId` y `orden`.
- Cada operación espera `transaction.oncomplete` (guardado confirmado) y, al agregar una foto, se vuelve
  a leer para comprobar la recuperación.
- Las URLs `blob:` que se ven en pantalla son temporales y solo sirven para mostrar; no se guardan.

**Generación del documento (`js/exportar.js`)**
- Usa la biblioteca `docx` para crear un .docx real (`Packer.toBlob`) y lo descarga con un enlace temporal.
- `Foto N.º 01, 02, …` se calcula a partir de la posición en el arreglo ordenado.
- Cada imagen se ajusta a una caja máxima (14,5 × 7,8 cm) conservando su proporción; el salto de página
  se controla con `pageBreakBefore` cada dos fotos y `keepNext`/`cantSplit` evitan separar foto y descripción.

## 8. Limitaciones conocidas

- Los datos son **locales al navegador, al perfil y a la dirección** (`localhost` ≠ IP de la red). No
  hay sincronización entre dispositivos ni cuentas de usuario.
- Borrar los datos del sitio, usar modo incógnito o limpiar el navegador **elimina** los proyectos.
  Genera el Word antes de limpiar datos. La app solicita almacenamiento persistente, pero el navegador
  puede negarlo.
- Las fotos se **reducen a un máximo de 2000 px** por lado y se guardan como JPEG (calidad 0,9) para que
  el Word no pese demasiado. Se corrige la orientación EXIF.
- Formatos que el navegador no pueda decodificar (por ejemplo HEIC en algunos equipos) se rechazan con un
  mensaje; en iPhone, Safari puede convertirlos a JPEG al elegirlos.
- El Word usa la fuente Poppins por nombre; **no la incrusta**. Si el equipo no la tiene instalada, Word
  mostrará otra similar (el archivo sigue siendo válido).
- **Funcionamiento sin conexión:** la app no usa CDN, de modo que, una vez abierta, guardar y generar el
  Word no requiere internet. No incluye *service worker*, por lo que para **volver a abrir** la app sin
  conexión debe seguir disponible el servidor local (o abrir `index.html` directamente en la computadora).
- La captura se basa en el selector de archivos del sistema (no en `getUserMedia`), por lo que no hay
  vista de cámara dentro de la página; cada navegador decide cómo mostrar la cámara.
- Verificado en Chromium (escritorio y vista de celular emulada). Falta probar la captura con la cámara
  de un celular real: hazlo antes de la entrega.

## 9. Datos de práctica

Usa fotografías propias de objetos o espacios autorizados y datos ficticios. No uses imágenes,
identificadores ni descripciones del expediente de referencia.
