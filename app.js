// ===== FUNCIÓN SHOW TOAST GLOBAL =====
function showToast(mensaje, tipo = "success") {
    const toast = document.createElement("div");
    toast.className = "toast-msg toast-" + tipo;
    const icon = tipo === "error" ? "exclamation-circle" : tipo === "warning" ? "exclamation-triangle" : "check-circle";
    const color = tipo === "error" ? "var(--red)" : tipo === "warning" ? "var(--orange)" : "var(--green)";
    toast.innerHTML = `<i class="fas fa-${icon}" style="color:${color};margin-right:6px;"></i> ${mensaje}`;
    document.body.appendChild(toast);
    setTimeout(() => {
        if (!toast.isConnected) return;
        toast.style.animation = 'none';
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        toast.style.opacity = '0';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => { if (toast.isConnected) toast.remove(); }, 300);
    }, 3000);
}
window.showToast = showToast;

// ===== FUNCIÓN ESCAPE HTML GLOBAL =====
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        if (m === "'") return '&#39;';
        return m;
    });
}
window.escapeHtml = escapeHtml;

// ===== CONSTANTES =====
const MAX_CAJAS_POR_ESCANEO = 9999;
const TARIMA_STORAGE_KEY = 'tarimaActivaScanner';

// ===== INICIALIZAR BASE DE DATOS =====
const database = new Database();

// ===== MODELO DE DATOS DEL INVENTARIO =====
let productos = {};
let html5QrCode = null;
let isScanning = false;
let laserActive = true;

// ===== SESIÓN DE TARIMA ACTIVA =====
let tarimaActiva = null;

const READER_ORIGINAL_HTML = `
    <div class="scan-overlay"></div>
    <div class="scan-line"></div>
    <div class="scanner-placeholder">
        <div class="scanner-placeholder-icon">
            <i class="fas fa-bolt"></i>
        </div>
        <p>Apunta y escanea</p>
    </div>
`;

// ===== FUNCIONES PRINCIPALES =====
function cargarDatos() {
    const stored = localStorage.getItem("productosCajasScanner");
    if (stored) {
        try { productos = JSON.parse(stored); } catch (e) { productos = {}; }
    } else {
        productos = {};
    }
    cargarTarimaActiva();
    renderizarProductos();
    actualizarEstadisticas();
    actualizarBannerTarima();
    actualizarHeaderTarimaBadge();
}

function guardarDatos() {
    localStorage.setItem("productosCajasScanner", JSON.stringify(productos));
}

// ===== PERSISTENCIA DE TARIMA ACTIVA =====
function guardarTarimaActiva() {
    try {
        if (tarimaActiva) localStorage.setItem(TARIMA_STORAGE_KEY, JSON.stringify(tarimaActiva));
        else localStorage.removeItem(TARIMA_STORAGE_KEY);
    } catch (e) { console.warn('No se pudo guardar tarima activa:', e); }
}

function cargarTarimaActiva() {
    try {
        const raw = localStorage.getItem(TARIMA_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.escaneos) {
            const codigos = Object.keys(parsed.escaneos || {});
            if (codigos.length > 0 && !codigos.some(c => productos[c])) {
                console.warn('⚠️ Tarima huérfana detectada, se descarta');
                localStorage.removeItem(TARIMA_STORAGE_KEY);
                return;
            }
            tarimaActiva = parsed;
            console.log('📦 Tarima activa recuperada:', tarimaActiva.id);
            setTimeout(() => {
                showToast(`📦 Tarima ${tarimaActiva.id} recuperada`, 'success');
                actualizarBannerTarima();
                actualizarHeaderTarimaBadge();
            }, 500);
        }
    } catch (e) { console.warn('No se pudo cargar tarima activa:', e); }
}

function actualizarEstadisticas() {
    const totalProductos = Object.keys(productos).length;
    const totalCajas = Object.values(productos).reduce((sum, item) => sum + (item.cantidadCajas || 0), 0);
    const tp = document.getElementById("totalProductos");
    const tc = document.getElementById("totalCajasSum");
    if (tp) tp.innerText = totalProductos;
    if (tc) tc.innerText = totalCajas;

    const badge = document.getElementById('tabBadgeCount');
    if (badge) {
        badge.textContent = totalProductos > 99 ? '99+' : totalProductos;
        badge.style.display = totalProductos > 0 ? 'block' : 'none';
    }
}

// ===== GENERADOR DE VARIANTES DE CÓDIGO =====
function generarVariantesCodigo(codigo) {
    const base = String(codigo).trim();
    const set = new Set();
    set.add(base);
    const limpio = base.replace(/[\s\-]/g, '');
    if (limpio) set.add(limpio);
    if (base.startsWith('0') && base.length > 1) set.add(base.slice(1));
    if (limpio.startsWith('0') && limpio.length > 1) set.add(limpio.slice(1));
    if (!base.startsWith('0')) set.add('0' + base);
    if (!limpio.startsWith('0')) set.add('0' + limpio);
    Array.from(set).forEach(v => { set.add(v.replace(/[\s\-]/g, '')); });
    return Array.from(set).filter(v => v.length >= 3);
}
window.generarVariantesCodigo = generarVariantesCodigo;

function encontrarCodigoExistenteEnProductos(codigo) {
    if (!codigo) return null;
    const exacto = String(codigo).trim();
    if (productos[exacto]) return exacto;
    const variantes = generarVariantesCodigo(codigo);
    for (const v of variantes) { if (productos[v]) return v; }
    return null;
}
window.encontrarCodigoExistenteEnProductos = encontrarCodigoExistenteEnProductos;

// ===== CONSULTA A BASE DE DATOS LOCAL =====
async function buscarProducto(codigo) {
    await database.esperarInicializacion();
    const variantes = generarVariantesCodigo(codigo);

    if (window.catalogs) {
        let enCatalogo = null;
        for (const v of variantes) {
            const hit = window.catalogs.buscar(v);
            if (hit) { enCatalogo = hit; break; }
        }
        if (enCatalogo) {
            if (enCatalogo.material) {
                return {
                    nombre: enCatalogo.descripcion,
                    marca: `Material ${enCatalogo.material}`,
                    material: enCatalogo.material,
                    materialNombre: enCatalogo.materialNombre,
                    matchPuntaje: enCatalogo.matchPuntaje,
                    encontrado: true,
                    origen: 'catalogo'
                };
            }
            if (enCatalogo.descripcion) {
                return {
                    nombre: enCatalogo.descripcion,
                    marca: null, material: null, materialNombre: null,
                    matchPuntaje: 0, encontrado: true, origen: 'catalogo_sin_material'
                };
            }
        }
    }

    for (const v of variantes) {
        const productoLocal = database.buscarProducto(v);
        if (productoLocal && productoLocal.descripcion) {
            return { nombre: productoLocal.descripcion, marca: "Base de datos local", material: null, encontrado: true, origen: 'local' };
        }
    }

    return { nombre: null, marca: null, material: null, encontrado: false, origen: 'none' };
}

// ===== AGREGAR PRODUCTO CON CANTIDAD =====
async function agregarProductoConBusqueda(codigo, cantidadCajas) {
    if (!codigo || String(codigo).trim() === "") {
        showToast("Código inválido", "error");
        return false;
    }

    codigo = String(codigo).trim();
    let cant = parseInt(cantidadCajas, 10);
    if (isNaN(cant) || cant < 1) {
        if (cantidadCajas !== undefined && cantidadCajas !== null && cantidadCajas !== '') {
            showToast('Cantidad inválida, usando 1', 'warning');
        }
        cant = 1;
    }
    if (cant > MAX_CAJAS_POR_ESCANEO) cant = MAX_CAJAS_POR_ESCANEO;

    showToast(`🔍 Buscando ${codigo}...`, "success");

    const infoProducto = await buscarProducto(codigo);

    let nombreProducto = null, marcaProducto = null, materialProducto = null;
    let materialNombreProducto = null, matchPuntajeProducto = null;

    if (infoProducto.encontrado) {
        nombreProducto = infoProducto.nombre;
        marcaProducto = infoProducto.marca;
        materialProducto = infoProducto.material || null;
        materialNombreProducto = infoProducto.materialNombre || null;
        matchPuntajeProducto = infoProducto.matchPuntaje || null;
    }

    if (!nombreProducto) {
        const codExistenteFallback = encontrarCodigoExistenteEnProductos(codigo);
        if (codExistenteFallback && productos[codExistenteFallback].nombre) {
            nombreProducto = productos[codExistenteFallback].nombre;
        } else {
            nombreProducto = `Producto ${codigo}`;
        }
    }

    const codigoExistente = encontrarCodigoExistenteEnProductos(codigo);

    if (codigoExistente) {
        return await mostrarModalCantidad(
            codigoExistente,
            nombreProducto || productos[codigoExistente].nombre || codigoExistente,
            productos[codigoExistente].cantidadCajas,
            true, null, null,
            materialProducto || productos[codigoExistente].material || null,
            materialNombreProducto || productos[codigoExistente].materialNombre || null,
            matchPuntajeProducto || productos[codigoExistente].matchPuntaje || null,
            cant
        );
    } else {
        return await mostrarModalCantidad(
            codigo, nombreProducto || codigo, 0, false,
            nombreProducto, marcaProducto,
            materialProducto, materialNombreProducto, matchPuntajeProducto, cant
        );
    }
}

// ===== MODAL DE CANTIDAD =====
function mostrarModalCantidad(codigo, nombre, cantidadActual, esExistente, nombreNuevo, marcaNueva, materialNuevo, materialNombreNuevo, matchPuntaje, cantidadInicial) {
    return new Promise((resolve) => {
        ScannerState.block('modal');

        const existing = document.querySelector('.modal-overlay');
        if (existing) existing.remove();

        let cantidad = Math.max(1, parseInt(cantidadInicial, 10) || 1);

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const titulo = esExistente ? 'Agregar cajas' : 'Producto encontrado';
        const mensaje = esExistente
            ? `Actual: ${cantidadActual} cajas. ¿Cuántas agregar?`
            : `¿Cuántas cajas de este producto?`;

        const materialMostrar = materialNuevo || (productos[codigo] && productos[codigo].material) || null;
        const materialNombreMostrar = materialNombreNuevo || (productos[codigo] && productos[codigo].materialNombre) || null;
        const puntajeMostrar = matchPuntaje || (productos[codigo] && productos[codigo].matchPuntaje) || null;

        let calidadBadge = '';
        if (puntajeMostrar) {
            let color = 'var(--green)';
            let icono = 'fa-check-circle';
            if (puntajeMostrar < 70) { color = 'var(--red)'; icono = 'fa-exclamation-circle'; }
            else if (puntajeMostrar < 85) { color = 'var(--yellow)'; icono = 'fa-info-circle'; }
            calidadBadge = `<span style="font-size:0.68rem;color:${color};margin-left:6px;font-weight:700;">
                <i class="fas ${icono}"></i> ${puntajeMostrar}%
            </span>`;
        }

        const materialHtml = materialMostrar
            ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--separator);margin-bottom:6px;">
                   <span style="color:var(--label);font-size:0.8rem;">🔢 Material ${calidadBadge}</span>
                   <span style="font-weight:800;color:var(--purple);font-size:1.05rem;font-family:'SF Mono',monospace;letter-spacing:0.5px;">${escapeHtml(materialMostrar)}</span>
               </div>
               ${materialNombreMostrar ? `<div style="font-size:0.72rem;color:var(--label);text-align:right;margin-bottom:6px;font-style:italic;">${escapeHtml(materialNombreMostrar)}</div>` : ''}`
            : `<div style="padding:6px 0;border-bottom:0.5px solid var(--separator);margin-bottom:6px;">
                   <span style="color:var(--orange);font-size:0.8rem;">⚠️ Sin material asignado</span>
               </div>`;

        const tarimaBadge = tarimaActiva
            ? `<div style="display:flex;justify-content:center;margin-bottom:10px;">
                   <span style="background:rgba(10,132,255,0.15);color:var(--blue-bright);padding:4px 12px;border-radius:100px;font-size:0.72rem;font-weight:700;letter-spacing:0.4px;">
                       <i class="fas fa-pallet"></i> ${escapeHtml(tarimaActiva.id)}
                   </span>
               </div>`
            : '';

        overlay.innerHTML = `
            <div class="modal-sheet">
                <div class="modal-handle"></div>
                <div class="scan-success-icon"><i class="fas fa-cubes"></i></div>
                <div class="modal-title">${escapeHtml(titulo)}</div>
                <div class="modal-message">${escapeHtml(mensaje)}</div>
                ${tarimaBadge}
                <div class="modal-product-info">
                    ${materialHtml}
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--separator);margin-bottom:6px;gap:10px;">
                        <span style="color:var(--label);font-size:0.8rem;flex-shrink:0;">📝 Descripción</span>
                        <span style="font-weight:600;color:var(--text);font-size:0.85rem;text-align:right;word-break:break-word;">${escapeHtml(nombre)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;">
                        <span style="color:var(--label);font-size:0.8rem;">📦 Código</span>
                        <span style="font-family:'SF Mono',monospace;color:var(--teal);font-weight:600;font-size:0.85rem;">${escapeHtml(codigo)}</span>
                    </div>
                    ${marcaNueva && marcaNueva !== 'Sin material' && marcaNueva !== 'Base de datos local' ? `<div style="color:var(--label);font-size:0.75rem;margin-top:8px;text-align:center;">${escapeHtml(marcaNueva)}</div>` : ''}
                </div>
                <div class="modal-input-label">Cajas a ${esExistente ? 'agregar' : 'registrar'}</div>
                <div class="stepper">
                    <button class="stepper-btn" id="modalStepDown">−</button>
                    <div class="stepper-value" id="modalStepValue">${cantidad}</div>
                    <button class="stepper-btn" id="modalStepUp">+</button>
                </div>
                ${esExistente ? `<div style="text-align:center;color:var(--label);font-size:0.8rem;margin-bottom:12px;">Total será: <span style="color:var(--green);font-weight:700;" id="totalCajasDisplay">${cantidadActual + cantidad}</span> cajas</div>` : ''}
                <div class="modal-actions">
                    <button class="modal-btn modal-btn-primary" id="modalConfirm">Confirmar</button>
                    <button class="modal-btn modal-btn-cancel" id="modalCancel">Cancelar</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');

        const valEl = document.getElementById('modalStepValue');

        document.getElementById('modalStepDown').addEventListener('click', () => {
            if (cantidad > 1) {
                cantidad--;
                valEl.textContent = cantidad;
                if (esExistente) {
                    const totalDisplay = document.getElementById('totalCajasDisplay');
                    if (totalDisplay) totalDisplay.textContent = cantidadActual + cantidad;
                }
            }
        });

        document.getElementById('modalStepUp').addEventListener('click', () => {
            if (cantidad < MAX_CAJAS_POR_ESCANEO) {
                cantidad++;
                valEl.textContent = cantidad;
                if (esExistente) {
                    const totalDisplay = document.getElementById('totalCajasDisplay');
                    if (totalDisplay) totalDisplay.textContent = cantidadActual + cantidad;
                }
            }
        });

        let resolvio = false;
        let escHandler = null;

        function cerrarModal(resuelto = false) {
            if (resolvio) return;
            resolvio = true;
            overlay.classList.remove('active');
            if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
            setTimeout(() => {
                overlay.remove();
                ScannerState.unblock('modal');
            }, 300);
            resolve(resuelto);
        }

        document.getElementById('modalConfirm').addEventListener('click', () => {
            if (esExistente) {
                productos[codigo].cantidadCajas = (productos[codigo].cantidadCajas || 0) + cantidad;
                productos[codigo].timestamp = new Date().toISOString();
                const puntajeActual = productos[codigo].matchPuntaje || 0;
                const puntajeNuevo = puntajeMostrar || 0;
                if (materialMostrar && (!productos[codigo].material || puntajeNuevo > puntajeActual)) {
                    productos[codigo].material = materialMostrar;
                    productos[codigo].materialNombre = materialNombreMostrar;
                    productos[codigo].matchPuntaje = puntajeMostrar || puntajeActual || null;
                }
            } else {
                productos[codigo] = {
                    codigo: codigo,
                    cantidadCajas: cantidad,
                    nombre: nombreNuevo || null,
                    marca: marcaNueva || null,
                    material: materialMostrar || null,
                    materialNombre: materialNombreMostrar || null,
                    matchPuntaje: puntajeMostrar || null,
                    timestamp: new Date().toISOString()
                };
            }

            if (tarimaActiva) {
                if (!tarimaActiva.escaneos[codigo]) {
                    tarimaActiva.escaneos[codigo] = {
                        cajas: 0, piezas: 0, nombre: nombre,
                        material: materialMostrar,
                        materialNombre: materialNombreMostrar,
                        tarimaPrevia: (productos[codigo] && productos[codigo].tarima && productos[codigo].tarima !== tarimaActiva.id)
                            ? productos[codigo].tarima : null
                    };
                }
                tarimaActiva.escaneos[codigo].cajas = (tarimaActiva.escaneos[codigo].cajas || 0) + cantidad;
                productos[codigo].tarima = tarimaActiva.id;
                guardarTarimaActiva();
                actualizarBannerTarima();
                showToast(`📦 +${cantidad} → ${tarimaActiva.id} (${productos[codigo].cantidadCajas} total)`);
            } else {
                if (esExistente) showToast(`📦 +${cantidad} cajas (total ${productos[codigo].cantidadCajas})`);
                else {
                    const matMsg = materialMostrar ? ` · Mat ${materialMostrar}` : '';
                    showToast(`📦 ${nombre}${matMsg} | ${cantidad} caja(s)`);
                }
            }

            guardarDatos();
            renderizarProductos();
            actualizarEstadisticas();
            cerrarModal(true);
        });

        document.getElementById('modalCancel').addEventListener('click', () => cerrarModal(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModal(false); });

        escHandler = (e) => { if (e.key === 'Escape') cerrarModal(false); };
        document.addEventListener('keydown', escHandler);
    });
}

// ===== FUNCIONES DE CÁMARA =====
async function iniciarScanner() {
    try {
        const readerElement = document.getElementById("reader");
        if (!readerElement) { showToast("Error: No se encontró el elemento de escáner", "error"); return; }

        if (typeof Html5Qrcode === 'undefined') {
            showToast("Error: Librería QR no cargada. Recarga la página.", "error");
            return;
        }

        if (html5QrCode) {
            try { await html5QrCode.stop(); html5QrCode.clear(); } catch(e) {}
            html5QrCode = null;
        }

        readerElement.innerHTML = '';
        readerElement.style.background = '#000';
        readerElement.style.minHeight = '300px';
        readerElement.style.position = 'relative';

        html5QrCode = new Html5Qrcode("reader");
        const config = { fps: 10, qrbox: { width: 250, height: 200 } };

        await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, onScanError);

        isScanning = true;
        ScannerState.deactivate(); // el láser no debe escanear con la cámara activa
        showToast("📷 Cámara activada - Escanea códigos QR", "success");

        const startBtn = document.getElementById("startScannerBtn");
        if (startBtn) {
            startBtn.innerHTML = '<i class="fas fa-stop"></i> Detener';
            startBtn.style.background = 'var(--red)';
        }

        laserActive = false;
        const modeLabel = document.getElementById('scannerModeLabel');
        const modeSub = document.getElementById('scannerModeSub');
        const dot = document.getElementById('scannerDot');
        if (modeLabel) modeLabel.textContent = 'Cámara';
        if (modeSub) modeSub.textContent = 'Escaneando en vivo';
        if (dot) dot.classList.add('blue');

    } catch (err) {
        console.error("Error al iniciar cámara:", err);
        let errorMsg = "No se pudo acceder a la cámara";
        if (err.message && err.message.includes('NotAllowedError')) errorMsg = "Permiso de cámara denegado.";
        else if (err.message && err.message.includes('NotFoundError')) errorMsg = "No se encontró cámara.";
        else if (err.message && err.message.includes('NotReadableError')) errorMsg = "La cámara está siendo usada por otra app.";

        showToast("❌ " + errorMsg, "error");
        isScanning = false;
        html5QrCode = null;

        const readerElement = document.getElementById("reader");
        if (readerElement) readerElement.innerHTML = READER_ORIGINAL_HTML;

        const startBtn = document.getElementById("startScannerBtn");
        if (startBtn) {
            startBtn.innerHTML = '<i class="fas fa-camera"></i> Cámara';
            startBtn.style.background = 'var(--blue)';
        }

        laserActive = true;
        const modeLabel = document.getElementById('scannerModeLabel');
        const modeSub = document.getElementById('scannerModeSub');
        const dot = document.getElementById('scannerDot');
        if (modeLabel) modeLabel.textContent = 'Láser';
        if (modeSub) modeSub.textContent = 'Activo · Listo para escanear';
        if (dot) dot.classList.remove('blue');
        ScannerState.activate();
    }
}

function onScanSuccess(decodedText, decodedResult) {
    if (!ScannerState.canScan()) return;

    const codigo = String(decodedText || '').trim();
    if (codigo.length < 3) return;

    if (!ScannerState.notifyScan(codigo)) return;

    const lastEl = document.getElementById("lastScanned");
    if (lastEl) lastEl.innerHTML = escapeHtml(codigo);

    agregarProductoConBusqueda(codigo, 1).finally(() => {
        ScannerState.finishScan();
    });
}

let scanErrorCount = 0;
function onScanError(errorMessage) {
    scanErrorCount++;
    if (scanErrorCount % 50 === 0) console.debug('Errores de escaneo (acumulados):', scanErrorCount);
}

async function detenerScanner() {
    if (html5QrCode && isScanning) {
        try { await html5QrCode.stop(); html5QrCode.clear(); } catch(err) {}
        isScanning = false;
        html5QrCode = null;
        showToast("📷 Cámara detenida", "success");

        const readerElement = document.getElementById("reader");
        if (readerElement) readerElement.innerHTML = READER_ORIGINAL_HTML;

        const startBtn = document.getElementById("startScannerBtn");
        if (startBtn) {
            startBtn.innerHTML = '<i class="fas fa-camera"></i> Cámara';
            startBtn.style.background = 'var(--blue)';
        }

        laserActive = true;
        const modeLabel = document.getElementById('scannerModeLabel');
        const modeSub = document.getElementById('scannerModeSub');
        const dot = document.getElementById('scannerDot');
        if (modeLabel) modeLabel.textContent = 'Láser';
        if (modeSub) modeSub.textContent = 'Activo · Listo para escanear';
        if (dot) dot.classList.remove('blue');
        ScannerState.activate();
    }
}

// ==================================================================
// ===== SESIÓN DE TARIMA =====
// ==================================================================
function iniciarTarima(idTarima) {
    if (!idTarima) { showToast('Selecciona una tarima', 'error'); return; }
    const tarimaRef = window.catalogs?.obtenerTarima(idTarima);
    if (!tarimaRef) { showToast(`❌ Tarima ${idTarima} no está en el archivo de referencia`, 'error'); return; }

    const idUpper = idTarima.toUpperCase();
    if (tarimaActiva && tarimaActiva.id !== idUpper) {
        showModal({
            icon: 'exclamation-triangle', iconType: 'warning',
            title: 'Tarima activa',
            message: `Ya tienes la tarima ${tarimaActiva.id} abierta con ${Object.keys(tarimaActiva.escaneos).length} SKU. ¿Reemplazarla por ${idUpper}? Los escaneos previos quedarán en el inventario.`,
            actions: [
                { text: 'Sí, reemplazar', type: 'danger', action: () => {
                    tarimaActiva = { id: idUpper, inicio: new Date().toISOString(), escaneos: {} };
                    guardarTarimaActiva();
                    actualizarBannerTarima();
                    actualizarHeaderTarimaBadge();
                    showToast(`📦 Tarima ${tarimaActiva.id} iniciada`, 'success');
                    ScannerState.activate();
                }},
                { text: 'Cancelar', type: 'cancel', action: () => ScannerState.activate() }
            ]
        });
        return;
    }

    tarimaActiva = { id: idUpper, inicio: new Date().toISOString(), escaneos: {} };
    guardarTarimaActiva();
    actualizarBannerTarima();
    actualizarHeaderTarimaBadge();
    showToast(`📦 Tarima ${tarimaActiva.id} iniciada`, 'success');
    ScannerState.activate();
}

function cancelarTarima() {
    if (!tarimaActiva) return;

    const nSKUs = Object.keys(tarimaActiva.escaneos).length;
    showModal({
        icon: 'exclamation-triangle', iconType: 'warning',
        title: 'Cancelar tarima',
        message: `Se quitarán del inventario las ${nSKUs} líneas escaneadas en esta tarima.`,
        actions: [
            { text: 'Cancelar tarima', type: 'danger', action: () => {
                for (const [cod, item] of Object.entries(tarimaActiva.escaneos)) {
                    if (productos[cod]) {
                        const cajasItem = Number(item.cajas) || 0;
                        const actuales = Number(productos[cod].cantidadCajas) || 0;
                        productos[cod].cantidadCajas = actuales - cajasItem;
                        if (productos[cod].cantidadCajas <= 0) delete productos[cod];
                        else if (productos[cod].tarima === tarimaActiva.id) {
                            if (item.tarimaPrevia) productos[cod].tarima = item.tarimaPrevia;
                            else delete productos[cod].tarima;
                        }
                    }
                }
                guardarDatos();
                renderizarProductos();
                actualizarEstadisticas();
                tarimaActiva = null;
                guardarTarimaActiva();
                actualizarBannerTarima();
                actualizarHeaderTarimaBadge();
                showToast('Tarima cancelada y revertida', 'warning');
            }},
            { text: 'Volver', type: 'cancel' }
        ]
    });
}

function actualizarBannerTarima() {
    const banners = [
        document.getElementById('tarimaBanner'),
        document.getElementById('tarimaBannerInv')
    ].filter(Boolean);
    if (banners.length === 0) return;

    for (const banner of banners) {
        if (!tarimaActiva) {
            banner.style.display = 'none';
            banner.innerHTML = '';
            continue;
        }

        const nSKUs = Object.keys(tarimaActiva.escaneos).length;
        const nCajas = Object.values(tarimaActiva.escaneos).reduce((s, x) => s + (Number(x.cajas) || 0), 0);

        const existingId = banner.querySelector('[data-tarima-id]');
        const existingStats = banner.querySelector('[data-tarima-stats]');

        if (existingId && existingStats) {
            existingId.textContent = tarimaActiva.id;
            existingStats.textContent = `${nSKUs} SKU · ${nCajas} cajas escaneadas`;
            banner.style.display = 'block';
            continue;
        }

        banner.style.display = 'block';
        banner.innerHTML = `
            <div class="card card-padded" style="background:linear-gradient(135deg,rgba(10,132,255,0.12),rgba(191,90,242,0.08));border:0.5px solid rgba(10,132,255,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <div style="min-width:0;">
                        <div style="font-size:0.72rem;color:var(--blue-bright);font-weight:700;letter-spacing:0.5px;">📦 TARIMA ACTIVA</div>
                        <div style="font-weight:800;font-size:1.1rem;letter-spacing:-0.3px;" data-tarima-id>${escapeHtml(tarimaActiva.id)}</div>
                        <div style="font-size:0.72rem;color:var(--label);margin-top:2px;" data-tarima-stats>${nSKUs} SKU · ${nCajas} cajas escaneadas</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="btn btn-primary btn-verificar-tarima" style="padding:10px 14px;font-size:0.8rem;width:auto;">
                            <i class="fas fa-clipboard-check"></i> Verificar
                        </button>
                        <button class="btn btn-secondary btn-cancelar-tarima" style="padding:10px 12px;font-size:0.8rem;color:var(--red);width:auto;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        banner.querySelectorAll('.btn-verificar-tarima').forEach(b => b.addEventListener('click', validarTarima));
        banner.querySelectorAll('.btn-cancelar-tarima').forEach(b => b.addEventListener('click', cancelarTarima));
    }
}

function actualizarHeaderTarimaBadge() {
    let badge = document.getElementById('headerTarimaBadge');
    const header = document.querySelector('.app-header-inner');
    if (!header) return;

    if (!tarimaActiva) { if (badge) badge.remove(); return; }

    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'headerTarimaBadge';
        badge.style.cssText = 'position:absolute;top:calc(var(--safe-top) + 4px);left:50%;transform:translateX(-50%);background:rgba(10,132,255,0.9);color:white;font-size:0.62rem;font-weight:800;padding:3px 10px;border-radius:100px;letter-spacing:0.4px;box-shadow:0 2px 8px rgba(10,132,255,0.4);white-space:nowrap;pointer-events:none;z-index:5;';
        const headerEl = document.querySelector('.app-header');
        if (headerEl) { headerEl.style.position = 'sticky'; headerEl.appendChild(badge); }
    }
    const nCajas = Object.values(tarimaActiva.escaneos).reduce((s, x) => s + (Number(x.cajas) || 0), 0);
    badge.innerHTML = `<i class="fas fa-pallet"></i> ${escapeHtml(tarimaActiva.id)} · ${nCajas}`;
}

// ===== VALIDACIÓN CONTRA REFERENCIA =====
function validarTarima() {
    if (!tarimaActiva) { showToast('No hay tarima activa', 'warning'); return; }
    const refObj = window.catalogs?.obtenerTarima(tarimaActiva.id);
    if (!refObj) { showToast('❌ No hay referencia cargada para esta tarima', 'error'); return; }

    const escaneado = tarimaActiva.escaneos;
    const escaneadoPorMaterial = {};

    for (const [cod, item] of Object.entries(escaneado)) {
        const codInfo = window.catalogs?.buscar(cod);
        const materialKey = codInfo ? codInfo.descNorm : null;
        const descripcionEsc = codInfo ? codInfo.descripcion : (item.nombre || cod);

        if (!materialKey) {
            const key = '__sin_match__' + cod;
            escaneadoPorMaterial[key] = {
                descripcion: descripcionEsc, codigoOriginal: cod,
                codigos: [cod], cajas: item.cajas, match: false
            };
            continue;
        }

        if (!escaneadoPorMaterial[materialKey]) {
            escaneadoPorMaterial[materialKey] = {
                descripcion: descripcionEsc, codigoOriginal: cod,
                codigos: [], cajas: 0, match: true
            };
        }
        if (!escaneadoPorMaterial[materialKey].codigos.includes(cod)) escaneadoPorMaterial[materialKey].codigos.push(cod);
        escaneadoPorMaterial[materialKey].cajas += item.cajas;
    }

    const ordenOriginal = window.catalogs?.obtenerOrdenTarima(tarimaActiva.id) || [];
    const filasReporte = [];
    const yaIncluidos = new Set();

    for (const materialKey of ordenOriginal) {
        const ref = refObj[materialKey];
        if (!ref) continue;
        const esc = escaneadoPorMaterial[materialKey] || { cajas: 0, match: false };
        const esperado = ref.cajas_esperadas || 0;
        const escaneadoCant = esc.cajas || 0;
        const diff = escaneadoCant - esperado;
        const estado = diff === 0 ? 'OK' : (diff < 0 ? 'FALTA' : 'SOBRA');

        filasReporte.push({
            codigo: esc.codigoOriginal || '',
            codigos: esc.codigos || (esc.codigoOriginal ? [esc.codigoOriginal] : []),
            material: ref.material, descripcion: ref.descripcion,
            referencia: tarimaActiva.id,
            cajas_esperadas: esperado, cajas_escaneadas: escaneadoCant,
            diferencia: diff, estado, match: esc.match
        });
        yaIncluidos.add(materialKey);
    }

    for (const [key, esc] of Object.entries(escaneadoPorMaterial)) {
        if (yaIncluidos.has(key)) continue;
        filasReporte.push({
            codigo: esc.codigoOriginal || '', codigos: esc.codigos || [],
            material: '', descripcion: esc.descripcion,
            referencia: tarimaActiva.id,
            cajas_esperadas: 0, cajas_escaneadas: esc.cajas,
            diferencia: esc.cajas, estado: 'EXTRA', match: esc.match
        });
    }

    let totalEsperadoCajas = 0, totalEscaneadoCajas = 0;
    let totalFaltantes = 0, totalSobrantes = 0, totalOK = 0, totalExtras = 0;

    for (const f of filasReporte) {
        totalEsperadoCajas += f.cajas_esperadas;
        totalEscaneadoCajas += f.cajas_escaneadas;
        if (f.estado === 'FALTA') totalFaltantes++;
        else if (f.estado === 'SOBRA') totalSobrantes++;
        else if (f.estado === 'EXTRA') totalExtras++;
        else if (f.estado === 'OK') totalOK++;
    }

    const reporte = {
        tarima: tarimaActiva.id, filas: filasReporte, orden: ordenOriginal,
        totalEsperadoCajas, totalEscaneadoCajas,
        totalSKUsRef: Object.keys(refObj).length,
        totalSKUsEsc: Object.keys(escaneadoPorMaterial).length,
        resumen: { ok: totalOK, faltantes: totalFaltantes, sobrantes: totalSobrantes, extras: totalExtras }
    };

    window._ultimoReporteTarima = reporte;
    mostrarReporteTarima(reporte);
}

// ===== REPORTE MEJORADO =====
function mostrarReporteTarima(rep) {
    ScannerState.block('modal');

    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const faltantes = rep.filas.filter(f => f.estado === 'FALTA');
    const extras    = rep.filas.filter(f => f.estado === 'EXTRA');
    const perfecto  = faltantes.length === 0 && extras.length === 0;
    const diffTotal = rep.totalEscaneadoCajas - rep.totalEsperadoCajas;

    const iconColor = perfecto ? 'var(--green)' : 'var(--red)';
    const iconName  = perfecto ? 'check-circle' : 'exclamation-triangle';

    let filasHtml = '';

    if (perfecto) {
        filasHtml = `
            <div style="text-align:center;padding:32px 20px;">
                <div style="font-size:2.5rem;color:var(--green);margin-bottom:12px;">✓</div>
                <div style="font-weight:700;font-size:1rem;color:var(--green);margin-bottom:6px;">Todo coincide</div>
                <div style="font-size:0.8rem;color:var(--label);">No hay diferencias con la referencia</div>
            </div>
        `;
    } else {
        filasHtml += `<div style="font-size:0.7rem;font-weight:800;color:var(--label);letter-spacing:0.6px;margin:12px 0 8px 0;text-transform:uppercase;">📦 Escaneado (orden del archivo)</div>`;

        for (const materialKey of rep.orden) {
            const fila = rep.filas.find(f => f.descripcion && window.catalogs?.normalizar(f.descripcion) === materialKey);
            if (!fila) continue;
            const esc = fila.cajas_escaneadas || 0;
            const esp = fila.cajas_esperadas || 0;
            const diff = esc - esp;
            const color = diff === 0 ? 'var(--green)' : (diff < 0 ? 'var(--red)' : 'var(--orange)');
            const icono = diff === 0 ? '✓' : (diff < 0 ? '▼' : '▲');
            const signo = diff > 0 ? '+' : '';
            filasHtml += `
                <div style="padding:9px 0;border-bottom:0.5px solid var(--separator);">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                        <div style="min-width:0;flex:1;">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <span style="font-weight:800;color:${color};font-size:0.75rem;">${icono}</span>
                                ${fila.material ? `<span style="font-family:'SF Mono',monospace;font-size:0.65rem;color:var(--purple);font-weight:700;">${escapeHtml(fila.material)}</span>` : ''}
                            </div>
                            <div style="font-size:0.8rem;color:var(--text);line-height:1.3;word-break:break-word;">${escapeHtml(fila.descripcion)}</div>
                            <div style="font-size:0.65rem;color:var(--label);margin-top:3px;">Ref: <b style="color:var(--text);">${esp}</b> · Esc: <b style="color:${color};">${esc}</b></div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-weight:800;font-size:1.15rem;color:${color};letter-spacing:-0.5px;line-height:1;">${signo}${diff}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        if (faltantes.length > 0) {
            filasHtml += `<div style="font-size:0.7rem;font-weight:800;color:var(--red);letter-spacing:0.6px;margin:16px 0 8px 0;text-transform:uppercase;">🔴 Faltantes (${faltantes.length})</div>`;
            faltantes.forEach(f => {
                filasHtml += `
                    <div style="padding:9px 0;border-bottom:0.5px solid var(--separator);">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                            <div style="min-width:0;flex:1;">
                                ${f.material ? `<div style="font-family:'SF Mono',monospace;font-size:0.65rem;color:var(--purple);font-weight:700;margin-bottom:3px;">${escapeHtml(f.material)}</div>` : ''}
                                <div style="font-size:0.8rem;color:var(--text);line-height:1.3;word-break:break-word;">${escapeHtml(f.descripcion)}</div>
                                <div style="font-size:0.65rem;color:var(--label);margin-top:3px;">Ref: <b>${f.cajas_esperadas}</b> · Esc: <b style="color:var(--red);">${f.cajas_escaneadas}</b></div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div style="font-weight:800;font-size:1.15rem;color:var(--red);letter-spacing:-0.5px;line-height:1;">${f.diferencia}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (extras.length > 0) {
            filasHtml += `<div style="font-size:0.7rem;font-weight:800;color:var(--purple);letter-spacing:0.6px;margin:16px 0 8px 0;text-transform:uppercase;">🟣 Extras (no en referencia) · ${extras.length}</div>`;
            extras.forEach(f => {
                filasHtml += `
                    <div style="padding:9px 0;border-bottom:0.5px solid var(--separator);">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                            <div style="min-width:0;flex:1;">
                                <div style="font-size:0.8rem;color:var(--text);line-height:1.3;word-break:break-word;">${escapeHtml(f.descripcion)}</div>
                                <div style="font-size:0.65rem;color:var(--label);margin-top:3px;">Escaneado: <b style="color:var(--purple);">${f.cajas_escaneadas}</b></div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div style="font-weight:800;font-size:1.15rem;color:var(--purple);letter-spacing:-0.5px;line-height:1;">+${f.diferencia}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-sheet" style="max-height:92vh;">
            <div class="modal-handle"></div>
            <div class="scan-success-icon" style="background:rgba(255,255,255,0.05);color:${iconColor};border-color:${iconColor};">
                <i class="fas fa-${iconName}"></i>
            </div>
            <div class="modal-title">${perfecto ? 'Sin diferencias' : `Reporte · ${escapeHtml(rep.tarima)}`}</div>
            <div class="modal-message">${perfecto ? 'La mercancía física coincide con la referencia.' : `${faltantes.length} faltante(s) · ${extras.length} extra(s)`}</div>
            <div class="modal-product-info" style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--label);font-size:0.78rem;">SKUs referencia</span><b>${rep.totalSKUsRef}</b></div>
                <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--label);font-size:0.78rem;">SKUs escaneados</span><b>${rep.totalSKUsEsc}</b></div>
                <div style="display:flex;justify-content:space-between;padding:6px 0 3px 0;border-top:0.5px solid var(--separator);margin-top:5px;"><span style="color:var(--label);font-size:0.78rem;">Cajas esperadas</span><b>${rep.totalEsperadoCajas}</b></div>
                <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--label);font-size:0.78rem;">Cajas escaneadas</span><b style="color:${diffTotal === 0 ? 'var(--green)' : 'var(--red)'};">${rep.totalEscaneadoCajas}</b></div>
                <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--label);font-size:0.78rem;">Diferencia total</span><b style="color:${diffTotal === 0 ? 'var(--green)' : 'var(--red)'};">${diffTotal > 0 ? '+' : ''}${diffTotal}</b></div>
            </div>
            <div style="max-height:42vh;overflow-y:auto;padding:0 16px;margin-bottom:12px;">${filasHtml}</div>
            <div class="modal-actions">
                <button class="modal-btn modal-btn-primary" id="repConfirmar"><i class="fas fa-check"></i> Finalizar tarima</button>
                <button class="modal-btn modal-btn-secondary" id="repExportar"><i class="fas fa-file-export"></i> Exportar (CSV)</button>
                <button class="modal-btn modal-btn-secondary" id="repSeguir">Seguir escaneando</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');

    const cerrar = () => {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
            ScannerState.unblock('modal');
        }, 300);
    };

    document.getElementById('repConfirmar').addEventListener('click', () => {
        if (!tarimaActiva) { showToast('⚠️ La tarima ya no está activa', 'warning'); cerrar(); return; }
        const idTarima = tarimaActiva.id;
        showToast(`✅ Tarima ${idTarima} finalizada`, 'success');
        tarimaActiva = null;
        guardarTarimaActiva();
        actualizarBannerTarima();
        actualizarHeaderTarimaBadge();
        cerrar();
    });

    document.getElementById('repExportar').addEventListener('click', () => exportarReporteTarimaCSV(rep, faltantes, extras));
    document.getElementById('repSeguir').addEventListener('click', cerrar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
}

// ===== EXPORTAR REPORTE =====
function exportarReporteTarimaCSV(rep, faltantes, extras) {
    if (!rep) { showToast('No hay reporte para exportar', 'warning'); return; }
    const codigosDeFila = (f) => {
        if (Array.isArray(f.codigos) && f.codigos.length) {
            return f.codigos.map(c => String(c).replace(/[\r\n]+/g, ' ')).join(', ');
        }
        return String(f.codigo || '').replace(/[\r\n]+/g, ' ');
    };

    const headers = ['codigo', 'material', 'descripcion', 'referencia', 'cajas_esperadas', 'cajas_escaneadas', 'diferencia', 'estado'];
    const rows = [headers];

    rows.push(['# ESCANEADO EN ORDEN DEL ARCHIVO', '', '', '', '', '', '', '']);
    for (const materialKey of rep.orden) {
        const f = rep.filas.find(x => x.descripcion && window.catalogs?.normalizar(x.descripcion) === materialKey);
        if (!f) continue;
        rows.push([codigosDeFila(f), f.material || '', f.descripcion || '', f.referencia || '', f.cajas_esperadas, f.cajas_escaneadas, f.diferencia, f.estado]);
    }

    if (faltantes && faltantes.length > 0) {
        rows.push([]);
        rows.push(['# FALTANTES', '', '', '', '', '', '', '']);
        for (const f of faltantes) rows.push([codigosDeFila(f), f.material || '', f.descripcion || '', f.referencia || '', f.cajas_esperadas, f.cajas_escaneadas, f.diferencia, 'FALTA']);
    }

    if (extras && extras.length > 0) {
        rows.push([]);
        rows.push(['# EXTRAS', '', '', '', '', '', '', '']);
        for (const f of extras) rows.push([codigosDeFila(f), f.material || '', f.descripcion || '', f.referencia || '', f.cajas_esperadas, f.cajas_escaneadas, f.diferencia, 'EXTRA']);
    }

    rows.push([]);
    rows.push(['# RESUMEN', '', '', '', '', '', '', '']);
    rows.push(['# Tarima', rep.tarima, '', '', '', '', '', '']);
    rows.push(['# Cajas esperadas', rep.totalEsperadoCajas, '', '', '', '', '', '']);
    rows.push(['# Cajas escaneadas', rep.totalEscaneadoCajas, '', '', '', '', '', '']);
    rows.push(['# Diferencia total', rep.totalEscaneadoCajas - rep.totalEsperadoCajas, '', '', '', '', '', '']);
    rows.push(['# Faltantes', rep.resumen.faltantes, '', '', '', '', '', '']);
    rows.push(['# Extras', rep.resumen.extras, '', '', '', '', '', '']);

    const csvContent = rows.map(row =>
        row.map(cell => {
            const s = String(cell == null ? '' : cell);
            return `"${s.replace(/"/g, '""')}"`;
        }).join(',')
    ).join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.href = url;
    link.setAttribute('download', `reporte_${rep.tarima}_${fecha}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`📥 Reporte exportado`, 'success');
}

// ===== MODAL PARA ELEGIR TARIMA =====
function abrirSelectorTarima() {
    const tarimas = window.catalogs?.listarTarimas() || [];
    if (tarimas.length === 0) { showToast('⚠️ Sube un archivo de materiales con columna "referencia" primero', 'warning'); return; }

    ScannerState.block('modal');

    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    let listaHtml = tarimas.map(tid => {
        const meta = window.catalogs.tarimasMeta[tid] || { skus: 0, totalCajas: 0 };
        return `
            <button class="modal-btn modal-btn-secondary" data-tarima="${escapeHtml(tid)}"
                style="text-align:left;display:flex;justify-content:space-between;align-items:center;padding:14px 16px;">
                <span>
                    <b style="font-size:1rem;">${escapeHtml(tid)}</b>
                    <small style="display:block;color:var(--label);font-weight:500;margin-top:2px;">${meta.skus} SKU · ${meta.totalCajas} cajas</small>
                </span>
                <i class="fas fa-chevron-right" style="color:var(--label);"></i>
            </button>
        `;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="modal-handle"></div>
            <div class="scan-success-icon"><i class="fas fa-pallet"></i></div>
            <div class="modal-title">Selecciona una tarima</div>
            <div class="modal-message">¿Qué tarima vas a escanear?</div>
            <div style="max-height:50vh;overflow-y:auto;padding:0 16px;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">${listaHtml}</div>
            <div class="modal-actions"><button class="modal-btn modal-btn-cancel" id="tarCancel">Cancelar</button></div>
        </div>
    `;

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');

    const cerrar = () => {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
            ScannerState.unblock('modal');
        }, 300);
    };

    overlay.querySelectorAll('[data-tarima]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tid = btn.getAttribute('data-tarima');
            cerrar();
            setTimeout(() => iniciarTarima(tid), 250);
        });
    });

    document.getElementById('tarCancel').addEventListener('click', cerrar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
}

// ===== MANEJO DE PRODUCTOS =====
function eliminarProducto(codigo) {
    const prod = productos[codigo];
    if (!prod) return;
    const nombre = prod.nombre || codigo;
    const cajas = prod.cantidadCajas;

    showModal({
        icon: 'trash', iconType: 'error', title: 'Eliminar producto',
        message: `¿Eliminar "${nombre}" y sus ${cajas} caja(s)?`,
        actions: [
            { text: 'Eliminar', type: 'danger', action: () => {
                delete productos[codigo];
                guardarDatos();
                renderizarProductos();
                actualizarEstadisticas();
                showToast("Producto eliminado");
                ScannerState.activate();
            }},
            { text: 'Cancelar', type: 'cancel', action: () => ScannerState.activate() }
        ]
    });
}

function editarCantidad(codigo) {
    if (!productos[codigo]) return;
    const prod = productos[codigo];
    let currentQty = prod.cantidadCajas;

    showModal({
        icon: 'pen', iconType: 'normal', title: 'Editar cantidad',
        productInfo: { name: prod.nombre || codigo, code: codigo },
        stepper: { value: currentQty, onChange: (v) => { currentQty = v; } },
        actions: [
            { text: 'Guardar', type: 'primary', action: () => {
                if (currentQty === 0) eliminarProducto(codigo);
                else {
                    productos[codigo].cantidadCajas = currentQty;
                    productos[codigo].timestamp = new Date().toISOString();
                    guardarDatos();
                    renderizarProductos();
                    actualizarEstadisticas();
                    showToast(`Cantidad actualizada`);
                }
                ScannerState.activate();
            }},
            { text: 'Cancelar', type: 'cancel', action: () => ScannerState.activate() }
        ]
    });
}

// ===== RENDERIZAR PRODUCTOS =====
let productsContainerListenerAttached = false;

function renderizarProductos() {
    const container = document.getElementById("productsList");
    if (!container) return;

    const productosArray = Object.values(productos).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (productosArray.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-qrcode"></i></div>
                <h3>Sin productos</h3>
                <p>Escanea un código para comenzar tu inventario</p>
            </div>
        `;
        return;
    }

    let html = '';
    productosArray.forEach(prod => {
        const displayName = prod.nombre || "📦 Producto sin descripción";
        const displayBrand = prod.marca || "";
        const hasBrand = displayBrand && displayBrand !== "Marca no especificada" && displayBrand !== "Sin material" && displayBrand !== "Base de datos local";

        html += `
            <div class="product-card" data-code="${escapeHtml(prod.codigo)}">
                <div class="product-body">
                    <div class="product-top">
                        <div class="product-info">
                            <div class="product-name">${escapeHtml(displayName)}</div>
                            ${hasBrand ? `<div class="product-brand"><i class="fas fa-building"></i> ${escapeHtml(displayBrand)}</div>` : ''}
                            ${prod.material ? `<div class="product-material"><i class="fas fa-cube"></i> ${escapeHtml(prod.material)}${prod.matchPuntaje && prod.matchPuntaje < 85 ? ` · ${prod.matchPuntaje}%` : ''}</div>` : ''}
                            ${prod.tarima ? `<div class="product-material" style="background:rgba(10,132,255,0.15);color:var(--blue-bright);"><i class="fas fa-pallet"></i> ${escapeHtml(prod.tarima)}</div>` : ''}
                            <div class="product-code">${escapeHtml(prod.codigo)}</div>
                            <div class="product-meta">
                                <i class="fas fa-clock"></i>
                                ${new Date(prod.timestamp).toLocaleString()}
                            </div>
                        </div>
                        <div class="product-qty">${prod.cantidadCajas}<small>Cajas</small></div>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="icon-btn edit-qty" data-code="${escapeHtml(prod.codigo)}"><i class="fas fa-pen"></i> Editar</button>
                    <button class="icon-btn danger delete-prod" data-code="${escapeHtml(prod.codigo)}"><i class="fas fa-trash"></i> Eliminar</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;

    if (!productsContainerListenerAttached) {
        productsContainerListenerAttached = true;
        container.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-prod');
            if (deleteBtn) {
                e.stopPropagation();
                const code = deleteBtn.getAttribute('data-code');
                if (code) eliminarProducto(code);
                return;
            }
            const editBtn = e.target.closest('.edit-qty');
            if (editBtn) {
                e.stopPropagation();
                const code = editBtn.getAttribute('data-code');
                if (code) editarCantidad(code);
                return;
            }
        });
    }
}

// ===== MODAL GENÉRICO =====
function showModal(options = {}) {
    const opts = Object.assign({}, options);
    if (!Array.isArray(opts.actions)) opts.actions = [];

    ScannerState.block('modal');

    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    let iconHtml = '';
    if (opts.icon) {
        const iconClass = opts.iconType === 'error' ? 'error' : opts.iconType === 'warning' ? 'warning' : '';
        iconHtml = `<div class="scan-success-icon ${iconClass}"><i class="fas fa-${opts.icon}"></i></div>`;
    }

    let productInfoHtml = '';
    if (opts.productInfo) {
        productInfoHtml = `
            <div class="modal-product-info">
                <div class="modal-product-name">${escapeHtml(opts.productInfo.name)}</div>
                <div class="modal-product-code">${escapeHtml(opts.productInfo.code)}</div>
            </div>
        `;
    }

    let stepperHtml = '';
    if (opts.stepper) {
        let val = opts.stepper.value;
        stepperHtml = `
            <div class="modal-input-label">Cantidad de cajas</div>
            <div class="stepper">
                <button class="stepper-btn" id="modalStepDown">−</button>
                <div class="stepper-value" id="modalStepValue">${val}</div>
                <button class="stepper-btn" id="modalStepUp">+</button>
            </div>
        `;
    }

    let actionsHtml = '';
    opts.actions.forEach((action, idx) => {
        if (action.type === 'cancel') actionsHtml += `<button class="modal-btn modal-btn-cancel" data-action="cancel-${idx}">${escapeHtml(action.text)}</button>`;
        else if (action.type === 'danger') actionsHtml += `<button class="modal-btn modal-btn-danger" data-action="action-${idx}">${escapeHtml(action.text)}</button>`;
        else if (action.type === 'secondary') actionsHtml += `<button class="modal-btn modal-btn-secondary" data-action="action-${idx}">${escapeHtml(action.text)}</button>`;
        else actionsHtml += `<button class="modal-btn modal-btn-primary" data-action="action-${idx}">${escapeHtml(action.text)}</button>`;
    });

    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="modal-handle"></div>
            ${iconHtml}
            <div class="modal-title">${escapeHtml(opts.title || '')}</div>
            ${opts.message ? `<div class="modal-message">${escapeHtml(opts.message)}</div>` : ''}
            ${productInfoHtml}
            ${stepperHtml}
            <div class="modal-actions">${actionsHtml}</div>
        </div>
    `;

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');

    if (opts.stepper) {
        let currentVal = opts.stepper.value;
        const valEl = document.getElementById('modalStepValue');
        document.getElementById('modalStepDown').addEventListener('click', () => {
            if (currentVal > 0) { currentVal--; valEl.textContent = currentVal; opts.stepper.onChange(currentVal); }
        });
        document.getElementById('modalStepUp').addEventListener('click', () => {
            currentVal++; valEl.textContent = currentVal; opts.stepper.onChange(currentVal);
        });
    }

    let escHandler = null;

    function closeModal() {
        overlay.classList.remove('active');
        if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
        setTimeout(() => {
            overlay.remove();
            ScannerState.unblock('modal');
        }, 300);
    }

    opts.actions.forEach((action, idx) => {
        const selector = action.type === 'cancel' ? `[data-action="cancel-${idx}"]` : `[data-action="action-${idx}"]`;
        const btn = overlay.querySelector(selector);
        if (btn) {
            btn.addEventListener('click', () => {
                closeModal();
                if (action.action) action.action();
            });
        }
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeModal();
            const cancelAction = opts.actions.find(a => a.type === 'cancel');
            if (cancelAction && cancelAction.action) cancelAction.action();
        }
    });

    escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            const cancelAction = opts.actions.find(a => a.type === 'cancel');
            if (cancelAction && cancelAction.action) cancelAction.action();
        }
    };
    document.addEventListener('keydown', escHandler);
}
window.showModal = showModal;

// ===== EXPORTAR CSV (inventario general) =====
function exportarCSV() {
    const productosArray = Object.values(productos).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (productosArray.length === 0) { showToast("No hay datos para exportar", "error"); return; }
    let csvRows = [["Código", "Material", "Descripción Material", "Nombre Producto", "Marca", "Tarima", "Cantidad Cajas", "Match %", "Fecha Registro"]];
    for (let prod of productosArray) {
        csvRows.push([
            prod.codigo, prod.material || "", prod.materialNombre || "",
            prod.nombre || "Sin descripción", prod.marca || "N/A",
            prod.tarima || "", prod.cantidadCajas, prod.matchPuntaje || "",
            new Date(prod.timestamp).toLocaleString()
        ]);
    }
    const csvContent = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", `inventario_${new Date().toISOString().slice(0,19)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("CSV exportado");
}

// ===== RESET =====
function resetSistema() {
    showModal({
        icon: 'exclamation-triangle', iconType: 'warning', title: 'Reiniciar inventario',
        message: 'Se eliminarán todos los productos y no se podrán recuperar. Los catálogos NO se tocan.',
        actions: [
            { text: 'Reiniciar todo', type: 'danger', action: () => {
                productos = {};
                tarimaActiva = null;
                guardarDatos();
                guardarTarimaActiva();
                renderizarProductos();
                actualizarEstadisticas();
                actualizarBannerTarima();
                actualizarHeaderTarimaBadge();
                showToast("Sistema reiniciado");
                ScannerState.activate();
            }},
            { text: 'Cancelar', type: 'cancel', action: () => ScannerState.activate() }
        ]
    });
}

// ===== INICIALIZACIÓN =====
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 Inicializando Scansoriana...");

    await database.esperarInicializacion();
    console.log("✅ SQLite listo");

    if (typeof DBManager === 'undefined') {
        console.error('❌ DBManager no está definido.');
        showToast('❌ Error cargando DB Manager', 'error');
        return;
    }

    const dbManager = new DBManager(database);
    window.dbManager = dbManager;

    const stats = database.obtenerEstadisticas();
    if (stats.usandoSQLite && !stats.usandoFallback) {
        console.log('✅ Usando SQLite real');
        showToast('🗄️ SQLite activo', 'success');
    } else if (stats.usandoFallback) {
        console.warn('⚠️ Usando fallback localStorage');
        showToast('⚠️ Usando fallback localStorage', 'warning');
    }

    if (window.catalogs) {
        const cs = window.catalogs.obtenerStats();
        if (cs.codigos > 0 || cs.materiales > 0) {
            console.log(`📦 Catálogos: ${cs.materiales} materiales, ${cs.codigos} códigos, ${cs.tarimas} tarimas`);
        }
    }

    cargarDatos();
    actualizarHeaderTarimaBadge();

    // ✅ Inicializar la máquina de estados del escáner
    ScannerState.init({
        onScan: (codigo, origen) => {
            const lastEl = document.getElementById('lastScanned');
            if (lastEl) lastEl.innerHTML = escapeHtml(codigo);
            showToast(`📸 Código: ${codigo}`, 'success');
            agregarProductoConBusqueda(codigo, 1).finally(() => {
                ScannerState.finishScan();
            });
        },
        onFlash: () => {
            const reader = document.getElementById('reader');
            if (reader) {
                reader.classList.add('flash');
                setTimeout(() => reader.classList.remove('flash'), 300);
            }
        },
        onVibrate: () => {
            if (navigator.vibrate) navigator.vibrate(50);
        },
    });
    ScannerState.activate();

    const iniciarTarimaBtn = document.getElementById("iniciarTarimaBtn");
    if (iniciarTarimaBtn) iniciarTarimaBtn.addEventListener("click", abrirSelectorTarima);

    const startBtn = document.getElementById("startScannerBtn");
    if (startBtn) {
        startBtn.addEventListener("click", function() {
            if (isScanning) detenerScanner();
            else {
                showModal({
                    icon: 'camera', iconType: 'normal',
                    title: 'Seleccionar método de escaneo',
                    message: 'Elige cómo quieres escanear los códigos:',
                    actions: [
                        { text: '📷 Usar Cámara', type: 'primary', action: () => iniciarScanner() },
                        { text: '🔦 Usar Láser', type: 'secondary', action: () => {
                            showToast('🔦 Escáner láser activo', 'success');
                            laserActive = true;
                            const modeLabel = document.getElementById('scannerModeLabel');
                            const modeSub = document.getElementById('scannerModeSub');
                            const dot = document.getElementById('scannerDot');
                            if (modeLabel) modeLabel.textContent = 'Láser';
                            if (modeSub) modeSub.textContent = 'Activo · Listo para escanear';
                            if (dot) dot.classList.remove('blue');
                            ScannerState.activate();
                        }},
                        { text: 'Cancelar', type: 'cancel', action: () => ScannerState.activate() }
                    ]
                });
            }
        });
    }

    const addManualBtn = document.getElementById("addManualBtn");
    const manualCode = document.getElementById("manualCode");
    const cajasQuantity = document.getElementById("cajasQuantity");

    if (addManualBtn && manualCode && cajasQuantity) {
        addManualBtn.addEventListener("click", async () => {
            const code = manualCode.value.trim();
            const cant = cajasQuantity.value;
            if (code === "") { showToast("Ingresa un código", "error"); manualCode.focus(); return; }
            addManualBtn.disabled = true;
            try {
                await agregarProductoConBusqueda(code, parseInt(cant));
                manualCode.value = "";
                cajasQuantity.value = "1";
            } finally { addManualBtn.disabled = false; }
            manualCode.focus();
        });

        manualCode.addEventListener("keypress", (e) => { if (e.key === "Enter") addManualBtn.click(); });
    }

    const exportBtn = document.getElementById("exportExcelBtn");
    const resetBtn = document.getElementById("resetAllBtn");
    if (exportBtn) exportBtn.addEventListener("click", exportarCSV);
    if (resetBtn) resetBtn.addEventListener("click", resetSistema);

    function abrirSettings() {
        ScannerState.block('settings');
        const settingsOverlay = document.getElementById('settingsOverlay');
        if (settingsOverlay) settingsOverlay.classList.add('active');
        if (window.dbManager && typeof window.dbManager.refreshUI === 'function') {
            try { window.dbManager.refreshUI(); } catch (e) { console.warn(e); }
        }
        if (window.dbManager && typeof window.dbManager.actualizarEstado === 'function') {
            try { window.dbManager.actualizarEstado(); } catch (e) { console.warn(e); }
        }
        if (window.dbManager && typeof window.dbManager._refreshCatalogStats === 'function') {
            try { window.dbManager._refreshCatalogStats(); } catch (e) { console.warn(e); }
        }
    }
    window.abrirSettings = abrirSettings;

    function cerrarSettings() {
        const settingsOverlay = document.getElementById('settingsOverlay');
        if (settingsOverlay) settingsOverlay.classList.remove('active');
        ScannerState.unblock('settings');
        setTimeout(() => {
            document.dispatchEvent(new CustomEvent('settings:closed'));
        }, 300);
    }
    window.cerrarSettings = cerrarSettings;

    const settingsClose = document.getElementById('settingsClose');
    if (settingsClose) settingsClose.addEventListener('click', (e) => { e.preventDefault(); cerrarSettings(); });

    const settingsOverlayEl = document.getElementById('settingsOverlay');
    if (settingsOverlayEl) settingsOverlayEl.addEventListener('click', (e) => { if (e.target === settingsOverlayEl) cerrarSettings(); });

    setTimeout(async () => {
        try {
            await database.esperarInicializacion();
            const stats = database.obtenerEstadisticas();
            const badge = document.getElementById('dbStatusBadge');
            if (badge) {
                if (stats.usandoSQLite && !stats.usandoFallback) {
                    badge.className = 'db-badge sqlite';
                    badge.textContent = '● SQLite';
                } else if (stats.usandoFallback) {
                    badge.className = 'db-badge fallback';
                    badge.textContent = '● Local';
                } else {
                    badge.className = 'db-badge error';
                    badge.textContent = '● Error';
                }
            }
        } catch (e) { console.error('❌ Error verificando DB:', e); }
    }, 500);

    window.addEventListener("beforeunload", () => {
        if (html5QrCode && isScanning) html5QrCode.stop().catch(e => console.log(e));
    });
});