// ✅ FIX #1: corregido "& &" → "&&" (syntax error crítico)
// ✅ FIX #7: cargarMateriales ahora pide confirmación si ya hay materiales
const _esc = (typeof window !== 'undefined' && typeof window.escapeHtml === 'function')
? window.escapeHtml
: function(str) {
if (str === null || str === undefined) return '';
return String(str).replace(/[&<>"']/g, function(m) {
if (m === '&') return '&amp;';
if (m === '<') return '&lt;';
if (m === '>') return '&gt;';
if (m === '"') return '&quot;';
if (m === "'") return '&#39;';
return m;
});
};
class DBManager {
constructor(database) {
this.db = database;
this._listenerAttached = false;
this._bindAbortController = null;
this.initUI();
}
async initUI() {
     try {
         if (this.db && typeof this.db.esperarInicializacion === 'function') {
             await this.db.esperarInicializacion();
         }
     } catch (e) {
         console.warn('DBManager: DB no lista al inicializar UI:', e);
     }
     this.createDBManagementUI();
 }
 createDBManagementUI() {
     const container = document.getElementById('settingsContent');
     if (!container) { console.error('❌ No se encontró settingsContent'); return; }
     if (this._bindAbortController) {
         try { this._bindAbortController.abort(); } catch (e) {}
         this._bindAbortController = null;
     }
     this._listenerAttached = false;
     container.innerHTML = `
         <div class="settings-section">
             <div class="settings-section-title">📦 Catálogos de productos</div>
             <div class="manual-panel" style="margin-bottom:12px;">
                 <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                     <div style="font-weight:700;font-size:0.9rem;">
                         <i class="fas fa-cube" style="color:var(--purple);margin-right:6px;"></i>
                         Materiales (A)
                     </div>
                     <span id="catMatCount" style="font-size:0.75rem;color:var(--label);">0 registros</span>
                 </div>
                 <div style="font-size:0.72rem;color:var(--label);margin-bottom:10px;line-height:1.5;">
                     Acepta: <code>.csv .xlsx .xls .ods .txt .tsv</code><br>
                     Columnas: <code>material, descripcion, referencia, cajas</code><br>
                     <span style="color:var(--blue-bright);">· referencia y cajas son opcionales ·</span>
                 </div>
                 <input type="file" id="catMatFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods" style="display:none;">
                 <div style="display:flex;gap:8px;">
                     <button class="btn btn-secondary" id="catMatUploadBtn" style="flex:1;padding:10px;font-size:0.85rem;">
                         <i class="fas fa-file-upload"></i> Subir archivo
                     </button>
                     <button class="btn btn-secondary" id="catMatClearBtn" style="width:auto;padding:10px 14px;color:var(--red);">
                         <i class="fas fa-trash"></i>
                     </button>
                 </div>
                 <div id="catMatStatus" style="font-size:0.72rem;color:var(--label);margin-top:8px;text-align:center;"></div>
             </div>
             <div class="manual-panel">
                 <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                     <div style="font-weight:700;font-size:0.9rem;">
                         <i class="fas fa-barcode" style="color:var(--teal);margin-right:6px;"></i>
                         Códigos (B)
                     </div>
                     <span id="catCodCount" style="font-size:0.75rem;color:var(--label);">0 registros</span>
                 </div>
                 <div style="font-size:0.72rem;color:var(--label);margin-bottom:10px;line-height:1.5;">
                     Acepta: <code>.csv .xlsx .xls .ods .txt .tsv</code><br>
                     Columnas: <code>codigo, descripcion</code> o <code>codigo descripcion</code> juntos
                 </div>
                 <input type="file" id="catCodFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods" style="display:none;">
                 <div style="display:flex;gap:8px;">
                     <button class="btn btn-secondary" id="catCodUploadBtn" style="flex:1;padding:10px;font-size:0.85rem;">
                         <i class="fas fa-file-upload"></i> Subir archivo
                     </button>
                     <button class="btn btn-secondary" id="catCodClearBtn" style="width:auto;padding:10px 14px;color:var(--red);">
                         <i class="fas fa-trash"></i>
                     </button>
                 </div>
                 <div id="catCodStatus" style="font-size:0.72rem;color:var(--label);margin-top:8px;text-align:center;"></div>
             </div>
             <div class="manual-panel" style="margin-top:12px;background:var(--surface-2);">
                 <div style="font-size:0.8rem;display:flex;justify-content:space-between;margin-bottom:8px;">
                     <span style="color:var(--label);">🔗 Cruce por descripción</span>
                 </div>
                 <div style="font-size:0.85rem;display:flex;justify-content:space-between;margin-bottom:4px;">
                     <span>✅ Con material asignado:</span>
                     <strong id="catConMaterial" style="color:var(--green);">0</strong>
                 </div>
                 <div style="font-size:0.85rem;display:flex;justify-content:space-between;margin-bottom:4px;">
                     <span>⚠️ Sin coincidencia:</span>
                     <strong id="catSinMaterial" style="color:var(--orange);">0</strong>
                 </div>
                 <div style="font-size:0.85rem;display:flex;justify-content:space-between;margin-bottom:10px;">
                     <span>🔍 Coincidencia débil:</span>
                     <strong id="catMatchBajo" style="color:var(--yellow);">0</strong>
                 </div>
                 <div style="border-top:0.5px solid var(--separator);padding-top:10px;">
                     <div style="font-size:0.75rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                         <span style="color:var(--label);">Sensibilidad del cruce</span>
                         <strong id="catUmbralVal" style="color:var(--blue-bright);">70%</strong>
                     </div>
                     <input type="range" id="catUmbralSlider" min="50" max="95" step="5" value="70">
                     <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--label);margin-top:4px;">
                         <span>Estricto (95%)</span>
                         <span>Flexible (50%)</span>
                     </div>
                     <div style="font-size:0.7rem;color:var(--label);margin-top:8px;line-height:1.4;">
                         💡 Bajo = acepta más coincidencias<br>
                         💡 Alto = solo coincidencias casi exactas
                     </div>
                 </div>
             </div>
             <div id="catBajosContainer" style="margin-top:12px;"></div>
             <button class="btn btn-secondary" id="catClearAllBtn" style="margin-top:12px;color:var(--red);padding:10px;font-size:0.85rem;">
                 <i class="fas fa-trash-alt"></i> Limpiar todos los catálogos
             </button>
         </div>
         <div class="settings-section">
             <div class="settings-section-title">Estado</div>
             <div class="manual-panel" style="padding:12px;">
                 <div id="dbStatus" style="display:flex; align-items:center; gap:10px; font-size:0.9rem;">
                     <span id="dbStatusIcon">⏳</span>
                     <span id="dbStatusText">Inicializando...</span>
                 </div>
             </div>
         </div>
         <div class="settings-section">
             <div class="settings-section-title">Agregar producto</div>
             <div class="manual-panel">
                 <div class="form-group" style="margin-bottom:12px;">
                     <label>Código de barras</label>
                     <input type="text" id="dbCodeInput" placeholder="Ej: 7501234567890" inputmode="numeric">
                 </div>
                 <div class="form-group" style="margin-bottom:12px;">
                     <label>Descripción</label>
                     <input type="text" id="dbDescInput" placeholder="Ej: Leche entera Lala 1L">
                 </div>
                 <button class="btn btn-primary" id="dbAddSingleBtn">
                     <i class="fas fa-plus"></i> Agregar producto
                 </button>
             </div>
         </div>
         <div class="settings-section">
             <div class="settings-section-title">Carga masiva</div>
             <div class="manual-panel">
                 <div class="form-group" style="margin-bottom:8px;">
                     <label>Formato: código,descripción (uno por línea)</label>
                     <textarea id="dbBulkInput" placeholder="7501234567890,Leche entera Lala 1L&#10;7501234567891,Pan Bimbo 600g"></textarea>
                 </div>
                 <button class="btn btn-green" id="dbBulkBtn">
                     <i class="fas fa-file-upload"></i> Cargar múltiples
                 </button>
             </div>
         </div>
         <div class="settings-section">
             <div class="settings-section-title">Acciones</div>
             <div class="manual-panel">
                 <div class="db-stats">
                     <span>Total en DB:</span>
                     <strong id="dbTotalCount">0</strong>
                     <span id="dbEngine" style="font-size:0.7rem; color:var(--label);">(SQLite)</span>
                 </div>
                 <div style="display:flex;gap:8px;flex-wrap:wrap;">
                     <button class="btn btn-secondary" id="dbExportBtn" style="flex:1;min-width:80px;padding:10px;">
                         <i class="fas fa-file-export"></i> Exportar
                     </button>
                     <button class="btn btn-secondary" id="dbImportBtn" style="flex:1;min-width:80px;padding:10px;">
                         <i class="fas fa-file-import"></i> Importar
                     </button>
                     <button class="btn btn-secondary" id="dbClearBtn" style="flex:1;min-width:80px;color:var(--red);padding:10px;">
                         <i class="fas fa-trash-alt"></i> Limpiar
                     </button>
                 </div>
                 <input type="file" id="dbFileInput" accept=".csv" style="display:none;">
             </div>
         </div>
         <div class="settings-section">
             <div class="settings-section-title">Productos en DB</div>
             <div class="manual-panel" style="padding: 12px;">
                 <div id="dbProductList" style="max-height:320px;overflow-y:auto;">
                     <div class="empty-state" style="padding:20px;">
                         <p>No hay productos en la base de datos</p>
                     </div>
                 </div>
             </div>
         </div>
     `;
     this.bindEvents();
     this.refreshUI();
     this.actualizarEstado();
     this._refreshCatalogStats();
 }
 async actualizarEstado() {
     try {
         if (!this.db) return;
         await this.db.esperarInicializacion();
         const stats = this.db.obtenerEstadisticas();
         const icon = document.getElementById('dbStatusIcon');
         const text = document.getElementById('dbStatusText');
         const engine = document.getElementById('dbEngine');
         if (stats.usandoSQLite && !stats.usandoFallback) {
             if (icon) { icon.textContent = '✅'; icon.style.color = 'var(--green)'; }
             if (text) text.textContent = 'SQLite activo';
             if (engine) engine.textContent = '(SQLite)';
         } else if (stats.usandoFallback) {
             if (icon) { icon.textContent = '⚠️'; icon.style.color = 'var(--orange)'; }
             if (text) text.textContent = 'Usando fallback (localStorage)';
             if (engine) engine.textContent = '(Fallback)';
         } else {
             if (icon) { icon.textContent = '❌'; icon.style.color = 'var(--red)'; }
             if (text) text.textContent = 'Error en la base de datos';
             if (engine) engine.textContent = '(Error)';
         }
     } catch (e) { console.warn('Error al obtener estado:', e); }
 }
 _showModal(options) {
     if (typeof window.showModal === 'function') { window.showModal(options); return; }
     if (options.actions && options.actions.length) {
         const danger = options.actions.find(a => a.type === 'danger');
         if (danger && danger.action) danger.action();
     }
 }
 _refreshCatalogStats() {
     if (!window.catalogs) return;
     const stats = window.catalogs.obtenerStats();
     const matCount = document.getElementById('catMatCount');
     const codCount = document.getElementById('catCodCount');
     const conMat = document.getElementById('catConMaterial');
     const sinMat = document.getElementById('catSinMaterial');
     const bajos = document.getElementById('catMatchBajo');
     const umbralVal = document.getElementById('catUmbralVal');
     const umbralSlider = document.getElementById('catUmbralSlider');
     if (matCount) {
         const nTar = stats.tarimas || 0;
         matCount.textContent = `${stats.materiales} registros${nTar > 0 ? ` · ${nTar} tarimas` : ''}`;
     }
     if (codCount) codCount.textContent = `${stats.codigos} registros`;
     if (conMat) conMat.textContent = stats.conMaterial;
     if (sinMat) sinMat.textContent = stats.sinMaterial;
     if (bajos) bajos.textContent = stats.conMatchBajo || 0;
     const umbral = window.catalogs.obtenerUmbral();
     if (umbralVal) umbralVal.textContent = umbral + '%';
     if (umbralSlider) umbralSlider.value = umbral;
     this._renderMatchesBajos();
 }
 _renderMatchesBajos() {
     const container = document.getElementById('catBajosContainer');
     if (!container || !window.catalogs) return;
     const bajos = window.catalogs.obtenerMatchesBajos();
     if (bajos.length === 0) { container.innerHTML = ''; return; }
     let html = `
         <div class="settings-section-title" style="margin-top:12px;">
             🔍 Coincidencias débiles (${bajos.length})
         </div>
         <div class="manual-panel" style="padding:12px;max-height:250px;overflow-y:auto;">
             <div style="font-size:0.72rem;color:var(--label);margin-bottom:10px;">
                 Revisa estas coincidencias — quizás el material asignado no sea el correcto.
             </div>
     `;
     bajos.slice(0, 30).forEach(b => {
         const color = b.matchPuntaje >= 75 ? 'var(--yellow)' : 'var(--orange)';
         html += `
             <div style="padding:8px 0;border-bottom:0.5px solid var(--separator);font-size:0.78rem;">
                 <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                     <span style="color:var(--label);font-family:'SF Mono',monospace;">${_esc(b.codigo)}</span>
                     <span style="color:${color};font-weight:700;">${b.matchPuntaje}%</span>
                 </div>
                 <div style="color:var(--text);margin-bottom:2px;">${_esc(b.descripcion)}</div>
                 <div style="color:var(--purple);font-size:0.72rem;">
                     → ${_esc(b.material)} · ${_esc(b.materialNombre || '')}
                 </div>
             </div>
         `;
     });
     if (bajos.length > 30) {
         html += `<div style="padding:8px 0;color:var(--label);font-size:0.72rem;text-align:center;">... y ${bajos.length - 30} más</div>`;
     }
     html += '</div>';
     container.innerHTML = html;
 }
 _bindCatalogsEvents(signal) {
     const matFile = document.getElementById('catMatFile');
     const matUploadBtn = document.getElementById('catMatUploadBtn');
     const matClearBtn = document.getElementById('catMatClearBtn');
     const codFile = document.getElementById('catCodFile');
     const codUploadBtn = document.getElementById('catCodUploadBtn');
     const codClearBtn = document.getElementById('catCodClearBtn');
     const clearAllBtn = document.getElementById('catClearAllBtn');

     // ✅ FIX #7: cargarMateriales pide confirmación si ya hay materiales
     const _procesarCargaMateriales = async (file) => {
         const statsActuales = window.catalogs.obtenerStats();
         if (statsActuales.materiales > 0) {
             this._showModal({
                 icon: 'exclamation-triangle', iconType: 'warning',
                 title: 'Reemplazar materiales',
                 message: `Ya tienes ${statsActuales.materiales} materiales cargados${statsActuales.tarimas > 0 ? ` y ${statsActuales.tarimas} tarimas` : ''}. Cargar un archivo nuevo los REEMPLAZARÁ. ¿Continuar?`,
                 actions: [
                     { text: 'Sí, reemplazar', type: 'danger', action: async () => {
                         await this._ejecutarCargaMateriales(file);
                     }},
                     { text: 'Cancelar', type: 'cancel' }
                 ]
             });
         } else {
             await this._ejecutarCargaMateriales(file);
         }
     };
     this._ejecutarCargaMateriales = async (file) => {
         try {
             showToast(`📖 Leyendo ${file.name}...`, 'success');
             const res = await window.catalogs.cargarMateriales(file);
             if (res.success) {
                 let msg = `✅ ${res.agregados} materiales`;
                 if (res.tarimas > 0) msg += ` · ${res.tarimas} tarimas`;
                 showToast(msg, 'success');
                 if (res.tarimasPreservadas && res.tarimasPreservadas > 0) {
                     showToast(`ℹ️ Archivo sin "referencia": se conservaron ${res.tarimasPreservadas} tarimas previas`, 'warning');
                 }
                 const st = document.getElementById('catMatStatus');
                 if (st) {
                     let txt = `Última carga: ${file.name} · ${res.agregados} registros`;
                     if (res.errores > 0) txt += ` (${res.errores} errores)`;
                     if (res.tarimas > 0) txt += ` · ${res.tarimas} tarimas`;
                     if (res.filasSinTarima > 0) txt += ` · ${res.filasSinTarima} sin referencia`;
                     if (res.tarimasPreservadas > 0) txt += ` · ${res.tarimasPreservadas} tarimas preservadas`;
                     st.textContent = txt;
                 }
             } else {
                 showToast(`❌ ${res.message}`, 'error');
             }
             this._refreshCatalogStats();
         } catch (err) {
             console.error('Error al cargar materiales:', err);
             showToast(`❌ Error: ${err.message}`, 'error');
         }
     };

     if (matUploadBtn && matFile) {
         matUploadBtn.addEventListener('click', () => matFile.click(), { signal });
         matFile.addEventListener('change', async (e) => {
             const file = e.target.files[0];
             if (!file) return;
             await _procesarCargaMateriales(file);
             matFile.value = '';
         }, { signal });
     }
     if (matClearBtn) {
         matClearBtn.addEventListener('click', () => {
             if (window.catalogs.stats.materiales === 0) { showToast('No hay materiales cargados', 'warning'); return; }
             this._showModal({
                 icon: 'exclamation-triangle', iconType: 'warning',
                 title: 'Limpiar materiales',
                 message: `Se eliminarán ${window.catalogs.stats.materiales} materiales y sus ${window.catalogs.stats.tarimas || 0} tarimas derivadas.`,
                 actions: [
                     { text: 'Limpiar', type: 'danger', action: () => {
                         window.catalogs.limpiarMateriales();
                         showToast('🗑️ Materiales limpiados', 'success');
                         this._refreshCatalogStats();
                     }},
                     { text: 'Cancelar', type: 'cancel' }
                 ]
             });
         }, { signal });
     }
     if (codUploadBtn && codFile) {
         codUploadBtn.addEventListener('click', () => codFile.click(), { signal });
         codFile.addEventListener('change', async (e) => {
             const file = e.target.files[0];
             if (!file) return;
             try {
                 showToast(`📖 Leyendo ${file.name}...`, 'success');
                 const res = await window.catalogs.cargarCodigos(file);
                 if (res.success) {
                     let msg = `✅ ${res.agregados} códigos cargados`;
                     if (res.sinCodigo > 0) msg += ` (${res.sinCodigo} sin código)`;
                     showToast(msg, 'success');
                     const st = document.getElementById('catCodStatus');
                     if (st) {
                         let extra = `${res.agregados} registros (${res.errores} errores)`;
                         if (res.sinCodigo > 0) extra += ` · ${res.sinCodigo} sin código detectado`;
                         st.textContent = `Última carga: ${file.name} · ${extra}`;
                     }
                 } else showToast(`❌ ${res.message}`, 'error');
                 this._refreshCatalogStats();
             } catch (err) {
                 console.error('Error al cargar códigos:', err);
                 showToast(`❌ Error: ${err.message}`, 'error');
             }
             codFile.value = '';
         }, { signal });
     }
     if (codClearBtn) {
         codClearBtn.addEventListener('click', () => {
             if (window.catalogs.stats.codigos === 0) { showToast('No hay códigos cargados', 'warning'); return; }
             this._showModal({
                 icon: 'exclamation-triangle', iconType: 'warning',
                 title: 'Limpiar códigos',
                 message: `Se eliminarán ${window.catalogs.stats.codigos} códigos.`,
                 actions: [
                     { text: 'Limpiar', type: 'danger', action: () => {
                         window.catalogs.limpiarCodigos();
                         showToast('🗑️ Códigos limpiados', 'success');
                         this._refreshCatalogStats();
                     }},
                     { text: 'Cancelar', type: 'cancel' }
                 ]
             });
         }, { signal });
     }
     if (clearAllBtn) {
         clearAllBtn.addEventListener('click', () => {
             this._showModal({
                 icon: 'exclamation-triangle', iconType: 'warning',
                 title: 'Limpiar TODOS los catálogos',
                 message: 'Se eliminarán materiales, códigos y tarimas. El inventario no se toca.',
                 actions: [
                     { text: 'Limpiar todo', type: 'danger', action: () => {
                         window.catalogs.limpiarTodo();
                         showToast('🗑️ Catálogos limpiados', 'success');
                         this._refreshCatalogStats();
                     }},
                     { text: 'Cancelar', type: 'cancel' }
                 ]
             });
         }, { signal });
     }
     const umbralSlider = document.getElementById('catUmbralSlider');
     if (umbralSlider) {
         umbralSlider.addEventListener('input', (e) => {
             const valEl = document.getElementById('catUmbralVal');
             if (valEl) valEl.textContent = parseInt(e.target.value) + '%';
         }, { signal });
         umbralSlider.addEventListener('change', (e) => {
             const val = parseInt(e.target.value);
             window.catalogs.ajustarUmbral(val);
             showToast(`🎚️ Sensibilidad: ${val}%`, 'success');
             if (window.catalogs.stats.codigos > 0 && window.catalogs.stats.materiales > 0) {
                 showToast('🔄 Recalculando cruces...', 'success');
                 setTimeout(() => {
                     const actualizados = window.catalogs.recalcularCruces();
                     this._refreshCatalogStats();
                     showToast(`✅ ${actualizados} cruces actualizados`, 'success');
                 }, 100);
             }
         }, { signal });
     }
 }
 bindEvents() {
     if (this._listenerAttached) return;
     this._listenerAttached = true;
     if (this._bindAbortController) {
         try { this._bindAbortController.abort(); } catch (e) {}
     }
     this._bindAbortController = new AbortController();
     const signal = this._bindAbortController.signal;
     this._bindCatalogsEvents(signal);
     const addBtn = document.getElementById('dbAddSingleBtn');
     if (addBtn) {
         addBtn.addEventListener('click', () => {
             const codeInput = document.getElementById('dbCodeInput');
             const descInput = document.getElementById('dbDescInput');
             const codigo = codeInput.value.trim();
             const descripcion = descInput.value.trim();
             if (!codigo) { if (typeof showToast === 'function') showToast('Ingresa un código de barras', 'error'); return; }
             const result = this.db.agregarProducto(codigo, descripcion);
             if (result.success) {
                 if (typeof showToast === 'function') showToast(`✅ ${result.message}`, 'success');
                 codeInput.value = ''; descInput.value = '';
                 this.refreshUI(); this.actualizarEstado();
             } else {
                 if (typeof showToast === 'function') showToast(`❌ ${result.message}`, 'error');
             }
         }, { signal });
     }
     const bulkBtn = document.getElementById('dbBulkBtn');
     if (bulkBtn) {
         bulkBtn.addEventListener('click', () => {
             const bulkInput = document.getElementById('dbBulkInput');
             const text = bulkInput.value.trim();
             if (!text) { if (typeof showToast === 'function') showToast('Ingresa datos', 'warning'); return; }
             const productos = text.split('\n').filter(l => l.trim()).map(line => {
                 const parts = line.split(',').map(p => p.trim());
                 return { codigo: parts[0], descripcion: parts.slice(1).join(', ') || 'Sin descripción' };
             });
             const result = this.db.agregarProductosMasivo(productos);
             if (typeof showToast === 'function') {
                 if (result.success === false) showToast(`❌ ${result.message}`, 'error');
                 else showToast(`✅ Agregados: ${result.agregados} | Duplicados: ${result.duplicados} | Errores: ${result.errores}`, result.agregados > 0 ? 'success' : 'warning');
             }
             bulkInput.value = '';
             this.refreshUI(); this.actualizarEstado();
         }, { signal });
     }
     const exportBtn = document.getElementById('dbExportBtn');
     if (exportBtn) {
         exportBtn.addEventListener('click', () => {
             const csv = this.db.exportarCSV();
             if (!csv) { if (typeof showToast === 'function') showToast('No hay datos para exportar', 'warning'); return; }
             const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
             const link = document.createElement('a');
             const url = URL.createObjectURL(blob);
             link.href = url;
             link.setAttribute('download', `productos_db_${new Date().toISOString().slice(0,10)}.csv`);
             document.body.appendChild(link); link.click(); document.body.removeChild(link);
             URL.revokeObjectURL(url);
             if (typeof showToast === 'function') showToast('📥 Base de datos exportada', 'success');
         }, { signal });
     }
     const importBtn = document.getElementById('dbImportBtn');
     const fileInput = document.getElementById('dbFileInput');
     if (importBtn && fileInput) {
         importBtn.addEventListener('click', () => fileInput.click(), { signal });
         fileInput.addEventListener('change', (e) => {
             const file = e.target.files[0];
             if (!file) return;
             const reader = new FileReader();
             reader.onload = (event) => {
                 const result = this.db.importarCSV(event.target.result);
                 if (result.success) {
                     if (typeof showToast === 'function') showToast(`✅ Importados: ${result.agregados} productos`, 'success');
                     this.refreshUI(); this.actualizarEstado();
                 } else {
                     if (typeof showToast === 'function') showToast(`❌ ${result.message}`, 'error');
                 }
                 fileInput.value = '';
             };
             reader.readAsText(file);
         }, { signal });
     }
     const clearBtn = document.getElementById('dbClearBtn');
     if (clearBtn) {
         clearBtn.addEventListener('click', () => {
             if (this.db.contarProductos() === 0) { if (typeof showToast === 'function') showToast('La base de datos ya está vacía', 'warning'); return; }
             this._showModal({
                 icon: 'exclamation-triangle', iconType: 'warning',
                 title: '¿Limpiar base de datos?',
                 message: `Se eliminarán ${this.db.contarProductos()} productos. Esta acción no se puede deshacer.`,
                 actions: [
                     { text: 'Limpiar todo', type: 'danger', action: () => {
                         this.db.limpiarDB();
                         if (typeof showToast === 'function') showToast('🗑️ Base de datos limpiada', 'success');
                         this.refreshUI(); this.actualizarEstado();
                     }},
                     { text: 'Cancelar', type: 'cancel' }
                 ]
             });
         }, { signal });
     }
     const listContainer = document.getElementById('dbProductList');
     if (listContainer) {
         listContainer.addEventListener('click', (e) => {
             const btn = e.target.closest('.db-delete-btn');
             if (!btn) return;
             e.stopPropagation();
             const codigo = btn.getAttribute('data-code');
             if (!codigo) return;
             this._showModal({
                 icon: 'trash', iconType: 'warning',
                 title: 'Eliminar producto',
                 message: `¿Eliminar el producto con código "${codigo}"?`,
                 actions: [
                     { text: 'Eliminar', type: 'danger', action: () => {
                         this.db.eliminarProducto(codigo);
                         if (typeof showToast === 'function') showToast('Producto eliminado', 'success');
                         this.refreshUI(); this.actualizarEstado();
                     }},
                     { text: 'Cancelar', type: 'cancel' }
                 ]
             });
         }, { signal });
     }
 }
 refreshUI() {
     if (!this.db) return;
     let productos = [];
     try {
         productos = this.db.obtenerProductosArray() || [];
     } catch (e) {
         console.warn('refreshUI: DB aún no lista, reintentando en 300ms', e);
         setTimeout(() => this.refreshUI(), 300);
         return;
     }
     const totalEl = document.getElementById('dbTotalCount');
     if (totalEl) totalEl.textContent = productos.length;
     const listContainer = document.getElementById('dbProductList');
     if (!listContainer) return;
     if (productos.length === 0) {
         listContainer.innerHTML = `
             <div class="empty-state" style="padding:20px;">
                 <p>No hay productos en la base de datos</p>
             </div>
         `;
         return;
     }
     let html = '';
     productos.slice(-20).reverse().forEach(p => {
         html += `
             <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:0.5px solid var(--separator);font-size:0.85rem;gap:10px;">
                 <div style="min-width:0;flex:1;">
                     <div style="font-weight:600;color:var(--text);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(p.descripcion || 'Sin descripción')}</div>
                     <div style="color:var(--teal);font-size:0.72rem;font-family:'SF Mono',monospace;letter-spacing:0.3px;">${_esc(p.codigo)}</div>
                 </div>
                 <button class="db-delete-btn" data-code="${_esc(p.codigo)}" style="background:var(--surface-2);border:0.5px solid var(--separator);width:34px;height:34px;border-radius:8px;color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-appearance:none;">
                     <i class="fas fa-trash" style="font-size:0.75rem;"></i>
                 </button>
             </div>
         `;
     });
     if (productos.length > 20) {
         html += `<div style="padding:10px 0;color:var(--label);font-size:0.78rem;text-align:center;">... y ${productos.length - 20} más</div>`;
     }
     listContainer.innerHTML = html;
 }
}