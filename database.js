// database.js - VERSIÓN CORREGIDA v5
// ✅ FIX #4: INSERT OR IGNORE + getRowsModified
// ✅ FIX #6: importarCSV ahora detecta encabezados
// ✅ FIX #11: exportarCSV solo envuelve en comillas cuando es necesario
class Database {
constructor() {
this.db = null;
this.initialized = false;
this._useLocalStorageFallback = false;
this._localStorageData = null;
this.initPromise = this.init();
}
async init() {
     try {
         let attempts = 0;
         while (typeof initSqlJs === 'undefined' && attempts < 25) {
             await new Promise(resolve => setTimeout(resolve, 200));
             attempts++;
         }
         if (typeof initSqlJs === 'undefined') {
             console.warn('⚠️ initSqlJs no disponible, usando fallback localStorage');
             this.fallbackToLocalStorage();
             return;
         }
         const SQL = await initSqlJs({
             locateFile: file => `https://sql.js.org/dist/${file}`
         });
         const saved = localStorage.getItem('scannerDB_sqlite');
         if (saved) {
             try {
                 const bytes = this._base64ToUint8Array(saved);
                 this.db = new SQL.Database(bytes);
                 console.log('✅ SQLite: Base de datos cargada desde localStorage');
             } catch (e) {
                 console.warn('⚠️ No se pudo cargar DB guardada, creando nueva:', e);
                 this.db = new SQL.Database();
                 this.crearTablas();
             }
         } else {
             this.db = new SQL.Database();
             this.crearTablas();
             console.log('✅ SQLite: Nueva base de datos creada');
         }
         this.verificarTabla();
         this.initialized = true;
     } catch (error) {
         console.error('❌ Error al inicializar SQLite:', error);
         this.fallbackToLocalStorage();
     }
 }
 _uint8ArrayToBase64(bytes) {
     let binary = '';
     const chunkSize = 0x8000;
     for (let i = 0; i < bytes.length; i += chunkSize) {
         const chunk = bytes.subarray(i, i + chunkSize);
         binary += String.fromCharCode.apply(null, chunk);
     }
     return btoa(binary);
 }
 _base64ToUint8Array(base64) {
     const binary = atob(base64);
     const len = binary.length;
     const bytes = new Uint8Array(len);
     for (let i = 0; i < len; i++) {
         bytes[i] = binary.charCodeAt(i);
     }
     return bytes;
 }
 crearTablas() {
     if (!this.db) return;
     try {
         this.db.run(`
             CREATE TABLE IF NOT EXISTS productos (
                 codigo TEXT PRIMARY KEY,
                 descripcion TEXT,
                 fecha_creacion TEXT
             )
         `);
         this.db.run(`CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(codigo)`);
         this.guardar();
     } catch (e) {
         console.warn('Error creando tablas:', e);
     }
 }
 verificarTabla() {
     if (!this.db) return;
     try {
         const result = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='productos'");
         if (result.length === 0 || result[0].values.length === 0) {
             this.crearTablas();
         }
     } catch (e) {
         this.crearTablas();
     }
 }
 guardar() {
     if (!this.db) return;
     try {
         const bytes = this.db.export();
         const base64 = this._uint8ArrayToBase64(bytes);
         localStorage.setItem('scannerDB_sqlite', base64);
     } catch (e) {
         console.warn('⚠️ No se pudo guardar la DB:', e);
     }
 }
 fallbackToLocalStorage() {
     console.warn('⚠️ Usando fallback a localStorage');
     this.db = null;
     this.initialized = true;
     this._useLocalStorageFallback = true;
     this._localStorageData = this._cargarLocalStorageFallback();
 }
 _cargarLocalStorageFallback() {
     try {
         const data = localStorage.getItem('scannerDB_fallback');
         if (data) {
             const parsed = JSON.parse(data);
             if (parsed && typeof parsed === 'object') return parsed;
         }
     } catch (e) {}
     return { productos: {} };
 }
 _guardarLocalStorageFallback() {
     try {
         localStorage.setItem('scannerDB_fallback', JSON.stringify(this._localStorageData));
     } catch (e) {
         console.warn('⚠️ No se pudo guardar fallback:', e);
     }
 }
 async esperarInicializacion() {
     await this.initPromise;
 }
 agregarProducto(codigo, descripcion) {
     if (this._useLocalStorageFallback || !this.db) {
         if (!this._localStorageData.productos) this._localStorageData.productos = {};
         if (this._localStorageData.productos[codigo]) {
             return { success: false, message: 'El código ya existe en la base de datos' };
         }
         this._localStorageData.productos[codigo] = {
             codigo, descripcion: descripcion || 'Sin descripción',
             fecha_creacion: new Date().toISOString()
         };
         this._guardarLocalStorageFallback();
         return { success: true, message: 'Producto agregado correctamente' };
     }
     try {
         const existe = this.db.exec('SELECT codigo FROM productos WHERE codigo = ?', [codigo]);
         if (existe.length > 0 && existe[0].values.length > 0) {
             return { success: false, message: 'El código ya existe en la base de datos' };
         }
         this.db.run(
             'INSERT INTO productos (codigo, descripcion, fecha_creacion) VALUES (?, ?, ?)',
             [codigo, descripcion || 'Sin descripción', new Date().toISOString()]
         );
         this.guardar();
         return { success: true, message: 'Producto agregado correctamente' };
     } catch (error) {
         console.error('Error en agregarProducto:', error);
         return { success: false, message: error.message || 'Error al agregar' };
     }
 }
 agregarProductosMasivo(productos) {
     if (this._useLocalStorageFallback || !this.db) {
         if (!this._localStorageData.productos) this._localStorageData.productos = {};
         let agregados = 0, duplicados = 0, errores = 0;
         for (const item of productos) {
             const codigo = item.codigo?.toString().trim();
             const descripcion = item.descripcion?.trim() || 'Sin descripción';
             if (!codigo) { errores++; continue; }
             if (this._localStorageData.productos[codigo]) { duplicados++; continue; }
             this._localStorageData.productos[codigo] = {
                 codigo, descripcion, fecha_creacion: new Date().toISOString()
             };
             agregados++;
         }
         this._guardarLocalStorageFallback();
         return { success: true, agregados, duplicados, errores, total: productos.length };
     }
     let agregados = 0, duplicados = 0, errores = 0;
     try {
         this.db.run('BEGIN TRANSACTION');
         for (const item of productos) {
             const codigo = item.codigo?.toString().trim();
             const descripcion = item.descripcion?.trim() || 'Sin descripción';
             if (!codigo) { errores++; continue; }
             try {
                 this.db.run(
                     'INSERT OR IGNORE INTO productos (codigo, descripcion, fecha_creacion) VALUES (?, ?, ?)',
                     [codigo, descripcion, new Date().toISOString()]
                 );
                 const modificadas = (typeof this.db.getRowsModified === 'function')
                     ? this.db.getRowsModified()
                     : 0;
                 if (modificadas > 0) agregados++;
                 else duplicados++;
             } catch (e) {
                 errores++;
             }
         }
         try {
             this.db.run('COMMIT');
             this.guardar();
             return { success: true, agregados, duplicados, errores, total: productos.length };
         } catch (commitErr) {
             try { this.db.run('ROLLBACK'); } catch (e) {}
             console.error('❌ Falló COMMIT, ROLLBACK aplicado:', commitErr);
             return { success: false, message: 'Error al confirmar transacción: ' + (commitErr.message || 'desconocido') };
         }
     } catch (error) {
         try { this.db.run('ROLLBACK'); } catch (e) {}
         return { success: false, message: error.message || 'Error en carga masiva' };
     }
 }
 buscarProducto(codigo) {
     if (this._useLocalStorageFallback || !this.db) {
         const producto = this._localStorageData.productos?.[codigo];
         if (producto) return { ...producto };
         return null;
     }
     try {
         const result = this.db.exec(
             'SELECT codigo, descripcion, fecha_creacion FROM productos WHERE codigo = ?',
             [codigo]
         );
         if (result.length > 0 && result[0].values.length > 0) {
             const row = result[0].values[0];
             return { codigo: row[0], descripcion: row[1], fecha_creacion: row[2] };
         }
         return null;
     } catch (error) {
         console.error('Error en buscarProducto:', error);
         return null;
     }
 }
 obtenerTodosProductos() {
     if (this._useLocalStorageFallback || !this.db) {
         return this._localStorageData.productos || {};
     }
     try {
         const result = this.db.exec('SELECT codigo, descripcion, fecha_creacion FROM productos');
         const productos = {};
         if (result.length > 0) {
             for (const row of result[0].values) {
                 productos[row[0]] = { codigo: row[0], descripcion: row[1], fecha_creacion: row[2] };
             }
         }
         return productos;
     } catch (error) {
         return {};
     }
 }
 obtenerProductosArray() {
     if (this._useLocalStorageFallback || !this.db) {
         return Object.values(this._localStorageData.productos || {});
     }
     try {
         const result = this.db.exec('SELECT codigo, descripcion, fecha_creacion FROM productos ORDER BY fecha_creacion DESC');
         const productos = [];
         if (result.length > 0) {
             for (const row of result[0].values) {
                 productos.push({ codigo: row[0], descripcion: row[1], fecha_creacion: row[2] });
             }
         }
         return productos;
     } catch (error) {
         return [];
     }
 }
 eliminarProducto(codigo) {
     if (this._useLocalStorageFallback || !this.db) {
         if (!this._localStorageData.productos?.[codigo]) {
             return { success: false, message: 'Producto no encontrado' };
         }
         delete this._localStorageData.productos[codigo];
         this._guardarLocalStorageFallback();
         return { success: true, message: 'Producto eliminado' };
     }
     try {
         const result = this.db.run('DELETE FROM productos WHERE codigo = ?', [codigo]);
         if (result.changes && result.changes > 0) {
             this.guardar();
             return { success: true, message: 'Producto eliminado' };
         }
         return { success: false, message: 'Producto no encontrado' };
     } catch (error) {
         return { success: false, message: error.message || 'Error al eliminar' };
     }
 }
 actualizarDescripcion(codigo, nuevaDescripcion) {
     if (this._useLocalStorageFallback || !this.db) {
         if (!this._localStorageData.productos?.[codigo]) {
             return { success: false, message: 'Producto no encontrado' };
         }
         this._localStorageData.productos[codigo].descripcion = nuevaDescripcion || 'Sin descripción';
         this._guardarLocalStorageFallback();
         return { success: true, message: 'Descripción actualizada' };
     }
     try {
         this.db.run('UPDATE productos SET descripcion = ? WHERE codigo = ?',
             [nuevaDescripcion || 'Sin descripción', codigo]);
         this.guardar();
         return { success: true, message: 'Descripción actualizada' };
     } catch (error) {
         return { success: false, message: error.message || 'Error al actualizar' };
     }
 }
 contarProductos() {
     if (this._useLocalStorageFallback || !this.db) {
         return Object.keys(this._localStorageData.productos || {}).length;
     }
     try {
         const result = this.db.exec('SELECT COUNT(*) FROM productos');
         if (result.length > 0 && result[0].values.length > 0) return result[0].values[0][0];
         return 0;
     } catch (error) {
         return 0;
     }
 }
 // ✅ FIX #11: exportarCSV solo envuelve en comillas cuando es necesario
 exportarCSV() {
     const productos = this.obtenerProductosArray();
     if (productos.length === 0) return null;
     const headers = ['Código', 'Descripción', 'Fecha Creación'];
     const rows = productos.map(p => [p.codigo, p.descripcion || 'Sin descripción', p.fecha_creacion || '']);
     return [headers, ...rows]
         .map(row => row.map(cell => {
             const s = String(cell == null ? '' : cell);
             // ✅ FIX #11: solo envolver si contiene caracteres especiales o es número
             if (typeof cell === 'number') return String(cell);
             if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
                 return `"${s.replace(/"/g, '""')}"`;
             }
             return s;
         }).join(','))
         .join('\n');
 }
 // ✅ FIX #6: importarCSV ahora detecta encabezados
 importarCSV(csvText) {
     const lines = csvText.split('\n').filter(line => line.trim());
     if (lines.length < 1) return { success: false, message: 'CSV vacío o formato inválido' };
     const productos = [];
     let errores = 0;
     // ✅ FIX #6: detectar encabezado
     let inicio = 0;
     if (this._esEncabezadoCSV(lines[0])) inicio = 1;
     for (let i = inicio; i < lines.length; i++) {
         const line = lines[i].trim();
         if (!line) continue;
         try {
             const parts = [];
             let current = '';
             let inQuotes = false;
             for (let j = 0; j < line.length; j++) {
                 const char = line[j];
                 if (char === '"') {
                     if (inQuotes && j + 1 < line.length && line[j + 1] === '"') {
                         current += '"'; j++;
                     } else inQuotes = !inQuotes;
                 } else if (char === ',' && !inQuotes) {
                     parts.push(current.trim()); current = '';
                 } else current += char;
             }
             parts.push(current.trim());
             if (parts.length >= 2) {
                 const codigo = parts[0];
                 const descripcion = parts[1] || 'Sin descripción';
                 if (codigo) productos.push({ codigo, descripcion });
                 else errores++;
             } else errores++;
         } catch (e) { errores++; }
     }
     if (productos.length === 0) return { success: false, message: 'No se encontraron datos válidos' };
     return this.agregarProductosMasivo(productos);
 }
 // ✅ FIX #6: detección de encabezado para CSV de productos
 _esEncabezadoCSV(linea) {
     if (!linea) return false;
     const norm = (s) => String(s || '').toLowerCase().trim()
         .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
     const encabezados = new Set(['codigo', 'code', 'sku', 'barcode', 'clave',
         'descripcion', 'description', 'nombre', 'name', 'producto', 'product']);
     const partes = linea.split(',').map(p => norm(p.replace(/"/g, '')));
     if (partes.length < 2) return false;
     let hits = 0;
     for (const p of partes) if (encabezados.has(p)) hits++;
     return hits >= 2;
 }
 limpiarDB() {
     if (this._useLocalStorageFallback || !this.db) {
         this._localStorageData = { productos: {} };
         this._guardarLocalStorageFallback();
         return { success: true, message: 'Base de datos limpiada' };
     }
     try {
         this.db.run('DELETE FROM productos');
         this.guardar();
         return { success: true, message: 'Base de datos limpiada' };
     } catch (error) {
         return { success: false, message: error.message || 'Error al limpiar' };
     }
 }
 obtenerEstadisticas() {
     return {
         totalProductos: this.contarProductos(),
         usandoSQLite: !this._useLocalStorageFallback && this.db !== null,
         usandoFallback: this._useLocalStorageFallback || false
     };
 }
}
if (typeof module !== 'undefined' && module.exports) {
module.exports = Database;
}