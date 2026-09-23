/**
 * Biblioteca Virtual UDHI — catálogo con acceso solo para cuentas @udhi.edu.mx.
 *
 * Cómo funciona:
 *  - La web app se publica "Ejecutar como: yo" y "Acceso: cualquier usuario de udhi.edu.mx".
 *    Google pide correo y contraseña institucional antes de llegar aquí; nadie de fuera entra.
 *  - Los PDFs viven en Drive (carpeta RAIZ, una subcarpeta por categoría) compartidos solo con
 *    el dominio. Aunque alguien copie un enlace, Drive vuelve a pedir la cuenta @udhi.edu.mx.
 *  - Para agregar un libro: soltar el PDF en la subcarpeta de su categoría. El nombre del
 *    archivo es el título. Al reconstruir el catálogo (cada ≤50 min) el script lo deja solo para
 *    el dominio y sin descarga; para verlo al momento, correr refrescar().
 *  - Cada apertura queda en la hoja de accesos (id en la propiedad LOG_ID).
 *
 * Requiere el servicio avanzado "Drive API" (v3), declarado en appsscript.json.
 */

const RAIZ_NOMBRE = 'Biblioteca-Virtual';
const DOMINIO = 'udhi.edu.mx';
const CACHE_SEG = 3000; // < 1 h: los thumbnailLink de Drive caducan

function doGet() {
  const correo = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!correo.endsWith('@' + DOMINIO)) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:2rem">La Biblioteca Virtual es solo para cuentas @' +
      DOMINIO + '. Cierra sesión e ingresa con tu correo institucional.</p>')
      .setTitle('Biblioteca Virtual UDHI');
  }
  registrar_(correo, 'ENTRADA', '', '');
  const t = HtmlService.createTemplateFromFile('Index');
  t.datos = JSON.stringify(catalogo_());
  t.correo = correo;
  return t.evaluate()
    .setTitle('Biblioteca Virtual UDHI')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Lo llama la página al abrir un documento. */
function abrir(id, titulo, categoria) {
  registrar_(Session.getActiveUser().getEmail(), 'ABRIR', categoria, titulo);
  return true;
}

function raiz_() {
  const id = PropertiesService.getScriptProperties().getProperty('RAIZ_ID');
  if (id) return id;
  // La carpeta vive en la unidad compartida "Biblioteca Virtual UDHI"; DriveApp no busca ahí.
  const r = Drive.Files.list({
    q: "name='" + RAIZ_NOMBRE + "' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true,
    fields: 'files(id,driveId)',
  }).files.filter(f => f.driveId);
  if (!r.length) throw new Error('No existe la carpeta ' + RAIZ_NOMBRE + ' en una unidad compartida');
  PropertiesService.getScriptProperties().setProperty('RAIZ_ID', r[0].id);
  PropertiesService.getScriptProperties().setProperty('UNIDAD_ID', r[0].driveId);
  return r[0].id;
}

function listar_(q, campos) {
  const out = [];
  let token;
  do {
    const r = Drive.Files.list({
      q: q, fields: 'nextPageToken,files(' + campos + ')', pageSize: 1000, pageToken: token,
      corpora: 'allDrives', supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.push.apply(out, r.files || []);
    token = r.nextPageToken;
  } while (token);
  return out;
}

/** [{c: categoría, l: [[id, título, miniatura], ...]}, ...] — cacheado en trozos de 90 KB. */
function catalogo_() {
  const cache = CacheService.getScriptCache();
  const n = cache.get('cat_n');
  if (n) {
    const partes = cache.getAll(Array.from({length: +n}, (_, i) => 'cat_' + i));
    if (Object.keys(partes).length === +n) {
      return JSON.parse(Array.from({length: +n}, (_, i) => partes['cat_' + i]).join(''));
    }
  }
  const carpetas = listar_(
    "'" + raiz_() + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
    'id,name');
  carpetas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  // Protege al vuelo los PDFs nuevos (sin marca), hasta 40 por reconstrucción para no alentar la
  // página; los que excedan se muestran igual y se protegen en la siguiente (o con compartirConDominio).
  let presupuesto = 40;
  const cat = carpetas.map(f => ({
    c: f.name,
    l: listar_("'" + f.id + "' in parents and mimeType='application/pdf' and trashed=false",
               'id,name,thumbnailLink,appProperties')
      .map(x => { if (!protegido_(x) && presupuesto-- > 0) proteger_(x.id); return x; })
      .map(x => [x.id, x.name.replace(/\.pdf$/i, ''),
                 (x.thumbnailLink || '').replace(/=s\d+$/, '=s400')])
      .sort((a, b) => a[1].localeCompare(b[1], 'es')),
  })).filter(x => x.l.length);
  const s = JSON.stringify(cat), trozos = {};
  let i = 0;
  for (let p = 0; p < s.length; p += 90000) trozos['cat_' + i++] = s.slice(p, p + 90000);
  trozos.cat_n = String(i);
  cache.putAll(trozos, CACHE_SEG);
  return cat;
}

/*
 * En unidades compartidas files.list no trae los permisos de cada archivo, así que no se puede
 * preguntar "¿ya está compartido?". Al protegerlo se le pone la marca appProperties.bv = 'ok'.
 */
function protegido_(x) {
  return !!(x.appProperties && x.appProperties.bv === 'ok');
}

/** Solo lectura para @udhi.edu.mx, no descubrible, sin descargar/imprimir/copiar. */
function proteger_(id) {
  try {
    Drive.Permissions.create({type: 'domain', domain: DOMINIO, role: 'reader', allowFileDiscovery: false},
      id, {sendNotificationEmail: false, supportsAllDrives: true});
    Drive.Files.update({copyRequiresWriterPermission: true, appProperties: {bv: 'ok'}}, id, null,
      {supportsAllDrives: true});
    return true;
  } catch (e) {
    console.error('proteger_ ' + id + ': ' + e);
    return false;
  }
}

function registrar_(correo, accion, categoria, titulo) {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('LOG_ID');
    if (!id) return;
    SpreadsheetApp.openById(id).getSheets()[0]
      .appendRow([new Date(), correo, accion, categoria, titulo]);
  } catch (e) {
    console.error('registrar_: ' + e);
  }
}

/* ------------------------- Mantenimiento (correr a mano) ------------------------- */

/** Una vez: crea la hoja de accesos (privada, solo del dueño del script). */
function configurar() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('LOG_ID')) {
    const ss = SpreadsheetApp.create('Biblioteca Virtual · Accesos');
    ss.getSheets()[0].appendRow(['Fecha', 'Correo', 'Acción', 'Categoría', 'Documento']);
    ss.getSheets()[0].setFrozenRows(1);
    p.setProperty('LOG_ID', ss.getId());
  }
  raiz_();
  Drive.Drives.update({name: 'Biblioteca Virtual UDHI'}, p.getProperty('UNIDAD_ID'));
  console.log('Raíz: ' + p.getProperty('RAIZ_ID') + ' · Hoja de accesos: ' + p.getProperty('LOG_ID'));
}

/**
 * Protege todos los PDFs que aún no tengan la marca (útil tras una carga masiva).
 * Reanudable: si se corta por tiempo, volver a correrla sigue donde iba.
 */
function compartirConDominio() {
  const inicio = Date.now();
  const raiz = raiz_();
  const carpetas = listar_("'" + raiz + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", 'id');
  let hechos = 0, fallos = 0, pendientes = 0;
  [raiz].concat(carpetas.map(f => f.id)).forEach(fid => {
    listar_("'" + fid + "' in parents and mimeType='application/pdf' and trashed=false and " +
            "not appProperties has { key='bv' and value='ok' }", 'id')
      .forEach(a => {
        if (Date.now() - inicio > 5 * 60 * 1000) { pendientes++; return; }
        if (proteger_(a.id)) hechos++; else fallos++;
      });
  });
  CacheService.getScriptCache().remove('cat_n');
  console.log('Protegidos ahora: ' + hechos + ' · Fallos: ' + fallos + ' · Pendientes por tiempo: ' +
    pendientes + (pendientes || fallos ? ' → vuelve a correrla' : ' → todo protegido'));
}

/** Borra el caché para que un PDF recién agregado aparezca de inmediato. */
function refrescar() {
  CacheService.getScriptCache().remove('cat_n');
  console.log(catalogo_().reduce((s, c) => s + c.l.length, 0) + ' documentos');
}

/** Diagnóstico: de quién es la sesión y si ve la carpeta. */
function diagnostico() {
  console.log(Session.getEffectiveUser().getEmail() + ' · carpeta: ' + raiz_());
}
