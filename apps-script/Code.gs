/**
 * Biblioteca Virtual UDHI — catálogo con acceso solo para cuentas @udhi.edu.mx.
 *
 * Cómo funciona:
 *  - La web app se publica "Ejecutar como: yo" y "Acceso: cualquier usuario de udhi.edu.mx".
 *    Google pide correo y contraseña institucional antes de llegar aquí; nadie de fuera entra.
 *  - Los PDFs viven en Drive (carpeta RAIZ, una subcarpeta por categoría) compartidos solo con
 *    el dominio. Aunque alguien copie un enlace, Drive vuelve a pedir la cuenta @udhi.edu.mx.
 *  - Para agregar un libro: soltar el PDF en la subcarpeta de su categoría y correr
 *    compartirConDominio(). El nombre del archivo es el título que se muestra.
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
  const cat = carpetas.map(f => ({
    c: f.name,
    l: listar_("'" + f.id + "' in parents and mimeType='application/pdf' and trashed=false",
               'id,name,thumbnailLink')
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
 * Deja cada PDF visible solo para @udhi.edu.mx y sin descarga/impresión para lectores.
 * Reanudable: si se corta por tiempo, volver a correrla sigue donde iba.
 */
function compartirConDominio() {
  const inicio = Date.now();
  const raiz = raiz_();
  const carpetas = listar_("'" + raiz + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", 'id');
  let hechos = 0, pendientes = 0;
  [raiz].concat(carpetas.map(f => f.id)).forEach(fid => {
    const archivos = listar_("'" + fid + "' in parents and trashed=false",
      'id,mimeType,copyRequiresWriterPermission,permissions(type,domain,role,allowFileDiscovery)');
    archivos.forEach(a => {
      if (Date.now() - inicio > 5 * 60 * 1000) { pendientes++; return; }
      const perms = a.permissions || [];
      let tieneDominio = perms.some(x => x.type === 'domain' && x.domain === DOMINIO);
      if (perms.some(x => x.type === 'anyone')) { // público: se cierra y se vuelve a abrir solo al dominio
        DriveApp.getFileById(a.id).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        tieneDominio = false;
      }
      if (!tieneDominio) {
        Drive.Permissions.create({type: 'domain', domain: DOMINIO, role: 'reader', allowFileDiscovery: false},
          a.id, {sendNotificationEmail: false, supportsAllDrives: true});
      }
      if (a.mimeType === 'application/pdf' && !a.copyRequiresWriterPermission) {
        Drive.Files.update({copyRequiresWriterPermission: true}, a.id, null, {supportsAllDrives: true});
      }
      hechos++;
    });
  });
  CacheService.getScriptCache().remove('cat_n');
  console.log('Revisados: ' + hechos + ' · Pendientes por tiempo: ' + pendientes +
    (pendientes ? ' → vuelve a correrla' : ' → listo'));
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
