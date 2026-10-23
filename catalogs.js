// ============================================================
// CATALOGS.JS - Manejo de catálogos Materiales + Códigos + Tarimas
// ✅ FIX #12: _esEncabezado más robusto (acepta más palabras clave)
// ============================================================
class Catalogs {
constructor() {
this.materiales = {};
this.codigos = {};
this.tarimas = {};
this.tarimasMeta = {};
this.tarimasOrden = {};
this.stats = { materiales: 0, codigos: 0, tarimas: 0, conMaterial: 0, sinMaterial: 0, conMatchBajo: 0 };
this.umbral = 70;
try {
const u = localStorage.getItem('catalogs_umbral');
if (u) this.umbral = parseInt(u) || 70;
} catch (e) {}
this._cargarDeStorage();
}
normalizar(texto) {
     if (!texto) return '';
     return String(texto).trim().toLowerCase()
         .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
         .replace(/\s+/g, ' ').replace(/[^\w\s\-."°]/g, '');
 }
 _parsearFilaCodigo(fila) {
     if (!fila || fila.length === 0) return { codigo: '', descripcion: '' };
     if (fila.length >= 2) {
         const col1 = String(fila[0] || '').trim();
         const col2 = String(fila[1] || '').trim();
         if (col2 && col2 !== '0' && col2 !== 'undefined' && col2 !== 'null') return { codigo: col1, descripcion: col2 };
         if (col1 && (!col2 || col2 === '0')) return this._separarCodigoDescripcion(col1);
         return { codigo: col1, descripcion: col2 };
     }
     return this._separarCodigoDescripcion(String(fila[0] || '').trim());
 }
 _separarCodigoDescripcion(texto) {
     if (!texto) return { codigo: '', descripcion: '' };
     const match = texto.match(/^([A-Za-z0-9\-_.\/]{3,20})[\s\-,\t]+(.+)$/);
     if (match) {
         const posibleCodigo = match[1].trim();
         const posibleDesc = match[2].trim();
         if (this._pareceCodigo(posibleCodigo) && posibleDesc.length >= 3) {
             return { codigo: posibleCodigo, descripcion: posibleDesc };
         }
     }
     return { codigo: '', descripcion: texto };
 }
 _pareceCodigo(texto) {
     if (!texto) return false;
     const limpio = texto.replace(/[\s\-_]/g, '');
     if (/^\d{3,30}$/.test(limpio)) return true;
     if (/^[A-Z0-9]{3,30}$/i.test(limpio)) {
         const palabrasComunes = ['SOPA','REFRESCO','AGUA','PAN','LECHE','JAMON','SALCHICHA',
             'YOGHURT','QUESO','ACEITE','GALLETA','CHICLE','CERVEZA','SALSA','ATUN','ARROZ',
             'FRIJOL','CAFE','TE','JUGO'];
         const mayus = limpio.toUpperCase();
         if (palabrasComunes.some(p => mayus.startsWith(p))) return false;
         if (/^\d/.test(limpio)) return true;
     }
     return false;
 }
 _levenshtein(a, b) {
     if (a === b) return 0;
     if (a.length === 0) return b.length;
     if (b.length === 0) return a.length;
     const matrix = [];
     for (let i = 0; i <= b.length; i++) matrix[i] = [i];
     for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
     for (let i = 1; i <= b.length; i++) {
         for (let j = 1; j <= a.length; j++) {
             matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
                 ? matrix[i - 1][j - 1]
                 : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
         }
     }
     return matrix[b.length][a.length];
 }
 _similitudTexto(a, b) {
     if (!a || !b) return 0;
     if (a === b) return 100;
     const maxLen = Math.max(a.length, b.length);
     if (maxLen === 0) return 100;
     return Math.max(0, Math.round((1 - this._levenshtein(a, b) / maxLen) * 100));
 }
 _similitudTokens(a, b) {
     if (!a || !b) return 0;
     const tokensA = a.split(/\s+/).filter(t => t.length > 0);
     const tokensB = b.split(/\s+/).filter(t => t.length > 0);
     if (tokensA.length === 0 || tokensB.length === 0) return 0;
     const setB = new Set(tokensB);
     let coincidencias = 0;
     for (const t of tokensA) {
         if (setB.has(t)) coincidencias++;
         else {
             for (const tb of tokensB) {
                 if (tb.includes(t) || t.includes(tb)) { coincidencias += 0.7; break; }
             }
         }
     }
     return Math.round((coincidencias / Math.max(tokensA.length, tokensB.length)) * 100);
 }
 _similitudCombinada(a, b) {
     return Math.round(this._similitudTexto(a, b) * 0.4 + this._similitudTokens(a, b) * 0.6);
 }
 _buscarMejorMatch(descNorm, diccionario, umbral = null) {
     if (!descNorm || !diccionario) return null;
     const u = umbral !== null ? umbral : this.umbral;
     if (diccionario[descNorm]) return { key: descNorm, valor: diccionario[descNorm], puntaje: 100 };
     let mejor = null, mejorPuntaje = u;
     for (const [key, valor] of Object.entries(diccionario)) {
         const puntaje = this._similitudCombinada(descNorm, key);
         if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = { key, valor, puntaje }; }
     }
     return mejor;
 }
 async leerArchivo(file) {
     const nombre = (file.name || '').toLowerCase();
     const esExcel = nombre.endsWith('.xlsx') || nombre.endsWith('.xls') || nombre.endsWith('.ods');
     return esExcel ? await this._leerExcel(file) : await this._leerTexto(file);
 }
 async _leerExcel(file) {
     if (typeof XLSX === 'undefined') throw new Error('Librería SheetJS no cargada.');
     const arrayBuffer = await file.arrayBuffer();
     const workbook = XLSX.read(arrayBuffer, { type: 'array' });
     const hoja = workbook.Sheets[workbook.SheetNames[0]];
     const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });
     return filas.filter(f => f && f.some(c => String(c).trim()))
         .map(f => f.map(c => String(c == null ? '' : c).trim()));
 }
 async _leerTexto(file) {
     return this._parsearTextoCSV(await file.text());
 }
 _parsearTextoCSV(texto, separador = ',') {
     if (!texto) return [];
     if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
     const primeraLinea = texto.split('\n')[0] || '';
     if (separador === ',') {
         const comas = (primeraLinea.match(/,/g) || []).length;
         const puntoComas = (primeraLinea.match(/;/g) || []).length;
         const tabs = (primeraLinea.match(/\t/g) || []).length;
         if (tabs > comas && tabs > puntoComas) separador = '\t';
         else if (puntoComas > comas) separador = ';';
     }
     const lineas = [];
     let actual = '', enComillas = false;
     for (let i = 0; i < texto.length; i++) {
         const c = texto[i];
         if (c === '"') {
             if (enComillas && texto[i + 1] === '"') { actual += '"'; i++; }
             else enComillas = !enComillas;
         } else if (c === '\n' && !enComillas) { lineas.push(actual); actual = ''; }
         else if (c !== '\r' || enComillas) actual += c;
     }
     if (actual) lineas.push(actual);
     return lineas.filter(l => l.trim()).map(l => this._parsearLinea(l, separador));
 }
 _parsearLinea(linea, sep) {
     const partes = [];
     let actual = '', enComillas = false;
     for (let i = 0; i < linea.length; i++) {
         const c = linea[i];
         if (c === '"') {
             if (enComillas && linea[i + 1] === '"') { actual += '"'; i++; }
             else enComillas = !enComillas;
         } else if (c === sep && !enComillas) { partes.push(actual.trim()); actual = ''; }
         else actual += c;
     }
     partes.push(actual.trim());
     return partes;
 }
 // ✅ FIX #12: _esEncabezado más robusto, acepta 1+ coincidencia si la segunda celda parece texto
 _esEncabezado(fila) {
     if (!fila || fila.length === 0) return false;
     const norm = (s) => String(s || '').toLowerCase().trim()
         .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
     const exactos = new Set(['material','descripcion','descripcion material','codigo','code',
         'sku','barcode','nombre','name','producto','product','clave','referencia','tarima',
         'cajas','description','bultos','piezas','cantidad','qty','unidades','items']);
     const celdas = fila.map(norm).filter(c => c.length > 0);
     if (celdas.length < 2) return false;
     let hits = 0;
     for (const c of celdas) if (exactos.has(c)) hits++;
     if (hits < 1) return false;
     const segunda = String(fila[1] || '').trim();
     if (/^\d+(\.\d+)?$/.test(segunda)) return false;
     if (segunda.length > 60) return false;
     // ✅ FIX #12: si hay 1+ hit y la segunda celda parece texto descriptivo, es encabezado
     if (hits >= 1 && segunda.length >= 3 && !/^\d/.test(segunda)) return true;
     return hits >= 2;
 }
 async cargarMateriales(fileOrText) {
     let filas;
     if (fileOrText instanceof File || fileOrText instanceof Blob) filas = await this.leerArchivo(fileOrText);
     else if (typeof fileOrText === 'string') filas = this._parsearTextoCSV(fileOrText);
     else return { success: false, message: 'Formato no reconocido' };
     if (!filas || filas.length === 0) return { success: false, message: 'El archivo está vacío o no se pudo leer' };
     let inicio = 0;
     if (this._esEncabezado(filas[0])) inicio = 1;
     const nuevos = {}, tarimas = {}, tarimasOrden = {};
     let agregados = 0, errores = 0, filasConTarima = 0, filasSinTarima = 0;
     for (let i = inicio; i < filas.length; i++) {
         const fila = filas[i];
         if (!fila || fila.length < 2) { errores++; continue; }
         const material = String(fila[0] || '').trim();
         const descripcion = String(fila[1] || '').trim();
         const referencia = fila[2] != null ? String(fila[2]).trim().toUpperCase() : '';
         const cajas = fila[3] != null ? parseFloat(fila[3]) : 0;
         if (!material || !descripcion) { errores++; continue; }
         const descNorm = this.normalizar(descripcion);
         if (!descNorm) { errores++; continue; }
         nuevos[descNorm] = { material, descripcion, referencia: referencia || null, cajas: isNaN(cajas) ? 0 : cajas };
         if (referencia) {
             if (!tarimas[referencia]) tarimas[referencia] = {};
             if (!tarimasOrden[referencia]) tarimasOrden[referencia] = [];
             if (!tarimas[referencia][descNorm]) {
                 tarimas[referencia][descNorm] = { material, descripcion, cajas_esperadas: 0 };
             }
             tarimas[referencia][descNorm].cajas_esperadas += (isNaN(cajas) ? 0 : cajas);
             if (!tarimasOrden[referencia].includes(descNorm)) tarimasOrden[referencia].push(descNorm);
             filasConTarima++;
         } else filasSinTarima++;
         agregados++;
     }
     const tarimasPrevias = Object.keys(this.tarimas || {}).length;
     const nuevoArchivoSinTarimas = Object.keys(tarimas).length === 0;
     const preservarTarimasPrevias = (tarimasPrevias > 0 && nuevoArchivoSinTarimas);
     this.materiales = nuevos;
     if (preservarTarimasPrevias) {
         console.warn(`⚠️ Archivo sin "referencia": se conservan ${tarimasPrevias} tarimas previas.`);
     } else {
         this.tarimas = tarimas;
         this.tarimasOrden = tarimasOrden;
     }
     this._recalcularMetaTarimas();
     this._guardarEnStorage();
     if (Object.keys(this.codigos).length > 0) {
         for (const cod of Object.values(this.codigos)) {
             const match = this._buscarMejorMatch(cod.descNorm, this.materiales);
             cod.material = match ? match.valor.material : null;
             cod.materialNombre = match ? match.valor.descripcion : null;
             cod.matchPuntaje = match ? match.puntaje : 0;
         }
         this._guardarEnStorage();
     }
     this._recalcularStats();
     return {
         success: true, agregados, errores, total: agregados,
         tarimas: Object.keys(tarimas).length, filasConTarima, filasSinTarima,
         tarimasPerdidas: 0,
         tarimasPreservadas: preservarTarimasPrevias ? tarimasPrevias : 0
     };
 }
 async cargarCodigos(fileOrText) {
     let filas;
     if (fileOrText instanceof File || fileOrText instanceof Blob) filas = await this.leerArchivo(fileOrText);
     else if (typeof fileOrText === 'string') filas = this._parsearTextoCSV(fileOrText);
     else return { success: false, message: 'Formato no reconocido' };
     if (!filas || filas.length === 0) return { success: false, message: 'El archivo está vacío o no se pudo leer' };
     let inicio = 0;
     if (this._esEncabezado(filas[0])) inicio = 1;
     const nuevos = {};
     let agregados = 0, errores = 0, sinCodigo = 0;
     for (let i = inicio; i < filas.length; i++) {
         const fila = filas[i];
         if (!fila || fila.length === 0) { errores++; continue; }
         const { codigo, descripcion } = this._parsearFilaCodigo(fila);
         if (!descripcion || descripcion.length < 3) { errores++; continue; }
         let codigoFinal = codigo;
         if (!codigoFinal) { sinCodigo++; codigoFinal = 'SIN_COD_' + i; }
         const descNorm = this.normalizar(descripcion);
         if (!descNorm) { errores++; continue; }
         const match = this._buscarMejorMatch(descNorm, this.materiales);
         nuevos[codigoFinal] = {
             codigo: codigoFinal, descripcion, descNorm,
             material: match ? match.valor.material : null,
             materialNombre: match ? match.valor.descripcion : null,
             matchPuntaje: match ? match.puntaje : 0
         };
         agregados++;
     }
     this.codigos = nuevos;
     this._guardarEnStorage();
     this._recalcularStats();
     return { success: true, agregados, errores, sinCodigo, total: agregados };
 }
 buscar(codigo) {
     if (!codigo) return null;
     return this.codigos[String(codigo).trim()] || null;
 }
 buscarMaterialPorDescripcion(descripcion) {
     if (!descripcion) return null;
     const match = this._buscarMejorMatch(this.normalizar(descripcion), this.materiales);
     return match ? match.valor.material : null;
 }
 _recalcularMetaTarimas() {
     this.tarimasMeta = {};
     for (const [tid, items] of Object.entries(this.tarimas || {})) {
         let totalCajas = 0, totalSKUs = 0;
         for (const it of Object.values(items)) { totalCajas += it.cajas_esperadas; totalSKUs++; }
         this.tarimasMeta[tid] = { totalCajas, skus: totalSKUs };
     }
 }
 obtenerTarima(id) {
     if (!id) return null;
     return this.tarimas[String(id).trim().toUpperCase()] || null;
 }
 listarTarimas() { return Object.keys(this.tarimas || {}).sort(); }
 obtenerOrdenTarima(id) {
     if (!id) return [];
     return this.tarimasOrden[String(id).trim().toUpperCase()] || [];
 }
 limpiarTarimas() {
     this.tarimas = {}; this.tarimasMeta = {}; this.tarimasOrden = {};
     this._guardarEnStorage(); this._recalcularStats();
 }
 ajustarUmbral(nuevoUmbral) {
     const val = Math.max(0, Math.min(100, parseInt(nuevoUmbral) || 70));
     this.umbral = val;
     try { localStorage.setItem('catalogs_umbral', val); } catch (e) {}
 }
 obtenerUmbral() { return this.umbral || 70; }
 recalcularCruces() {
     if (Object.keys(this.codigos).length === 0) return 0;
     let actualizados = 0;
     for (const cod of Object.values(this.codigos)) {
         const match = this._buscarMejorMatch(cod.descNorm, this.materiales);
         const nuevoMat = match ? match.valor.material : null;
         if (nuevoMat !== cod.material) actualizados++;
         cod.material = nuevoMat;
         cod.materialNombre = match ? match.valor.descripcion : null;
         cod.matchPuntaje = match ? match.puntaje : 0;
     }
     this._guardarEnStorage();
     this._recalcularStats();
     return actualizados;
 }
 _recalcularStats() {
     let conMat = 0, sinMat = 0, bajos = 0;
     for (const cod of Object.values(this.codigos)) {
         if (cod.material) { conMat++; if (cod.matchPuntaje && cod.matchPuntaje < 85) bajos++; }
         else sinMat++;
     }
     this.stats = {
         materiales: Object.keys(this.materiales).length,
         codigos: Object.keys(this.codigos).length,
         tarimas: Object.keys(this.tarimas || {}).length,
         conMaterial: conMat, sinMaterial: sinMat, conMatchBajo: bajos
     };
 }
 _guardarEnStorage() {
     try {
         localStorage.setItem('catalogs_materiales', JSON.stringify(this.materiales));
         localStorage.setItem('catalogs_codigos', JSON.stringify(this.codigos));
         localStorage.setItem('catalogs_tarimas', JSON.stringify(this.tarimas));
         localStorage.setItem('catalogs_tarimasOrden', JSON.stringify(this.tarimasOrden));
     } catch (e) { console.warn('⚠️ No se pudieron guardar catálogos:', e); }
 }
 _cargarDeStorage() {
     try {
         const mat = localStorage.getItem('catalogs_materiales');
         const cod = localStorage.getItem('catalogs_codigos');
         const tar = localStorage.getItem('catalogs_tarimas');
         const tarOrd = localStorage.getItem('catalogs_tarimasOrden');
         if (mat) this.materiales = JSON.parse(mat) || {};
         if (cod) this.codigos = JSON.parse(cod) || {};
         if (tar) this.tarimas = JSON.parse(tar) || {};
         if (tarOrd) this.tarimasOrden = JSON.parse(tarOrd) || {};
         this._recalcularMetaTarimas();
         this._recalcularStats();
     } catch (e) {
         console.warn('⚠️ No se pudieron cargar catálogos:', e);
         this.materiales = {}; this.codigos = {}; this.tarimas = {}; this.tarimasOrden = {};
     }
 }
 limpiarMateriales() {
     this.materiales = {}; this.tarimas = {}; this.tarimasMeta = {}; this.tarimasOrden = {};
     this._guardarEnStorage(); this._recalcularStats();
 }
 limpiarCodigos() { this.codigos = {}; this._guardarEnStorage(); this._recalcularStats(); }
 limpiarTodo() {
     this.materiales = {}; this.codigos = {}; this.tarimas = {};
     this.tarimasMeta = {}; this.tarimasOrden = {};
     this._guardarEnStorage(); this._recalcularStats();
 }
 obtenerStats() { return { ...this.stats }; }
 exportarMaterialesCSV() {
     const rows = [['Material', 'Descripción', 'Referencia', 'Cajas']];
     for (const m of Object.values(this.materiales)) rows.push([m.material, m.descripcion, m.referencia || '', m.cajas || 0]);
     return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
 }
 exportarCodigosCSV() {
     const rows = [['Código', 'Descripción', 'Material', 'Puntaje']];
     for (const c of Object.values(this.codigos)) rows.push([c.codigo, c.descripcion, c.material || '', c.matchPuntaje || '']);
     return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
 }
 obtenerMatchesBajos() {
     return Object.values(this.codigos)
         .filter(c => c.material && c.matchPuntaje && c.matchPuntaje < 85)
         .sort((a, b) => a.matchPuntaje - b.matchPuntaje);
 }
}
const catalogs = new Catalogs();
window.catalogs = catalogs;