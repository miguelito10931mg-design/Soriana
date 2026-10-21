// ===== FUNCIÓN SHOW TOAST GLOBAL =====
function showToast(mensaje, tipo = "success") {
    const toast = document.createElement("div");
    toast.className = "toast-msg toast-" + tipo;
    const icon = tipo === "error" ? "exclamation-circle" : tipo === "warning" ? "exclamation-triangle" : "check-circle";
    const color = tipo === "error" ? "var(--red)" : tipo === "warning" ? "var(--orange)" : "var(--green)";
    toast.innerHTML = `<i class="fas fa-${icon}" style="color:${color};margin-right:6px;"></i> ${mensaje}`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'none';
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        toast.style.opacity = '0';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
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
let scanBuffer = '';
let scanTimeout = null;
let lastScanTime = 0;
let focoInterval = null;
let modalAbierto = false;
let settingsAbierto = false;
let scanProcessing = false;

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
        guardarDatos();
    }
    cargarTarimaActiva();
    renderizarProductos();
    actualizarEstadisticas();
    actualizarBannerTarima();
}

function guardarDatos() {
    localStorage.setItem("productosCajasScanner", JSON.stringify(productos));
}

// ===== PERSISTENCIA DE TARIMA ACTIVA =====
function guardarTarimaActiva() {
    try {
        if (tarimaActiva) {
            localStorage.setItem(TARIMA_STORAGE_KEY, JSON.stringify(tarimaActiva));
        } else {
            localStorage.removeItem(TARIMA_STORAGE_KEY);
        }
    } catch (e) {
        console.warn('No se pudo guardar tarima activa:', e);
    }
}

function cargarTarimaActiva() {
    try {
        const raw = localStorage.getItem(TARIMA_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.escaneos) {
            tarimaActiva = parsed;
            console.log('📦 Tarima activa recuperada:', tarimaActiva.id);
            setTimeout(() => {
                showToast(`📦 Tarima ${tarimaActiva.id} recuperada`, 'success');
                actualizarBannerTarima();
            }, 500);
        }
    } catch (e) {
        console.warn('No se pudo cargar tarima activa:', e);
    }
}

function actualizarEstadisticas() {
    const totalProductos = Object.keys(productos).length;
    const totalCajas = Object.values(productos).reduce((sum, item) => sum + (item.cantidadCajas || 0), 0);
    const tp = document.getElementById("totalProductos");
    const tc = document.getElementById("totalCajasSum");
    if (tp) tp.innerText = totalProductos;
    if (tc) tc.innerText = totalCajas;
}

// ===== CONSULTA A BASE DE DATOS LOCAL (SIN API EXTERNA) =====
async function buscarProducto(codigo) {
    await database.esperarInicializacion();

    // 1) Catálogo (más rápido y confiable)
    if (window.catalogs) {
        const enCatalogo = window.catalogs.buscar(codigo);
        if (enCatalogo) {
            console.log('✅ Encontrado en catálogo:', enCatalogo);
            return {
                nombre: enCatalogo.descripcion,
                marca: enCatalogo.material ? `Material ${enCatalogo.material}` : 'Sin material',
                material: enCatalogo.material,
                materialNombre: enCatalogo.materialNombre,
                matchPuntaje: enCatalogo.matchPuntaje,
                encontrado: true,
                origen: 'catalogo'
            };
        }
    }

    // 2) DB local
    const productoLocal = database.buscarProducto(codigo);
    if (productoLocal) {
        console.log('✅ Producto encontrado en DB local:', productoLocal);
        return {
            nombre: productoLocal.descripcion || "Sin descripción",
            marca: "Base de datos local",
            material: null,
            encontrado: true,
            origen: 'local'
        };
    }

    // 3) No encontrado en ninguna fuente local
    console.log('❌ Código no encontrado en fuentes locales:', codigo);
    return {
        nombre: null,
        marca: null,
        material: null,
        encontrado: false,
        origen: 'none'
    };
}

// ===== AGREGAR PRODUCTO CON CANTIDAD =====
async function agregarProductoConBusqueda(codigo, cantidadCajas) {
    if (!codigo || codigo.trim() === "") {
        showToast("Código inválido", "error");
        return false;
    }

    codigo = codigo.trim();
    let cant = parseInt(cantidadCajas);
    if (isNaN(cant) || cant < 1) cant = 1;
    if (cant > MAX_CAJAS_POR_ESCANEO) cant = MAX_CAJAS_POR_ESCANEO;

    showToast(`🔍 Buscando ${codigo}...`, "success");

    const infoProducto = await buscarProducto(codigo);

    let nombreProducto = null;
    let marcaProducto = null;
    let materialProducto = null;
    let materialNombreProducto = null;
    let matchPuntajeProducto = null;

    if (infoProducto.encontrado) {
        nombreProducto = infoProducto.nombre;
        marcaProducto = infoProducto.marca;
        materialProducto = infoProducto.material || null;
        materialNombreProducto = infoProducto.materialNombre || null;
        matchPuntajeProducto = infoProducto.matchPuntaje || null;
    }

    if (!nombreProducto) {
        nombreProducto = `Producto ${codigo}`;
    }

    if (productos[codigo]) {
        // ✅ await para esperar confirmación del usuario
        return await mostrarModalCantidad(
            codigo,
            nombreProducto || productos[codigo].nombre || codigo,
            productos[codigo].cantidadCajas,
            true,
            null, null,
            materialProducto || productos[codigo].material || null,
            materialNombreProducto || productos[codigo].materialNombre || null,
            matchPuntajeProducto || productos[codigo].matchPuntaje || null
        );
    } else {
        // ✅ await para esperar confirmación del usuario
        return await mostrarModalCantidad(
            codigo,
            nombreProducto || codigo,
            0,
            false,
            nombreProducto,
            marcaProducto,
            materialProducto,
            materialNombreProducto,
            matchPuntajeProducto
        );
    }
}

// ===== MODAL DE CANTIDAD =====
// ✅ Devuelve una Promise que resuelve al confirmar (true) o cancelar (false)
function mostrarModalCantidad(codigo, nombre, cantidadActual, esExistente, nombreNuevo, marcaNueva, materialNuevo, materialNombreNuevo, matchPuntaje) {
    return new Promise((resolve) => {
        modalAbierto = true;
        detenerFocoScanner();

        const existing = document.querySelector('.modal-overlay');
        if (existing) existing.remove();

        let cantidad = 1;

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
        function cerrarModal(resuelto = false) {
            if (resolvio) return;
            resolvio = true;
            modalAbierto = false;
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.remove();
                reiniciarFocoScanner();
            }, 300);
            resolve(resuelto);
        }

        document.getElementById('modalConfirm').addEventListener('click', () => {
            // ===== 1) Sumar al inventario global =====
            if (esExistente) {
                productos[codigo].cantidadCajas += cantidad;
                productos[codigo].timestamp = new Date().toISOString();
                // Actualizar material si el nuevo tiene mejor puntaje
                const puntajeActual = productos[codigo].matchPuntaje || 0;
                const puntajeNuevo = puntajeMostrar || 0;
                if (materialMostrar && (!productos[codigo].material || puntajeNuevo > puntajeActual)) {
                    productos[codigo].material = materialMostrar;
                    productos[codigo].materialNombre = materialNombreMostrar;
                    productos[codigo].matchPuntaje = puntajeMostrar;
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

            // ===== 2) Si hay tarima activa, sumar también al buffer =====
            if (tarimaActiva) {
                if (!tarimaActiva.escaneos[codigo]) {
                    tarimaActiva.escaneos[codigo] = {
                        cajas: 0,
                        piezas: 0,
                        nombre: nombre,
                        material: materialMostrar,
                        materialNombre: materialNombreMostrar
                    };
                }
                tarimaActiva.escaneos[codigo].cajas += cantidad;
                productos[codigo].tarima = tarimaActiva.id;
                guardarTarimaActiva();
                actualizarBannerTarima();
                showToast(`📦 +${cantidad} → ${tarimaActiva.id} (${productos[codigo].cantidadCajas} total)`);
            } else {
                if (esExistente) {
                    showToast(`📦 +${cantidad} cajas (total ${productos[codigo].cantidadCajas})`);
                } else {
                    const matMsg = materialMostrar ? ` · Mat ${materialMostrar}` : '';
                    showToast(`📦 ${nombre}${matMsg} | ${cantidad} caja(s)`);
                }
            }

            guardarDatos();
            renderizarProductos();
            actualizarEstadisticas();
            cerrarModal(true);   // ✅ resolve(true) = confirmado
        });

        document.getElementById('modalCancel').addEventListener('click', () => {
            cerrarModal(false);  // ✅ resolve(false) = cancelado
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cerrarModal(false);
        });

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                cerrarModal(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// ===== SISTEMA DE FOCO DEL SCANNER =====
let focoActivo = false;

function detenerFocoScanner() {
    focoActivo = false;
    if (focoInterval) {
        clearInterval(focoInterval);
        focoInterval = null;
    }
}

function reiniciarFocoScanner() {
    // ✅ No reactivar foco si estamos en la pestaña Inventario
    const tabInv = document.getElementById('tab-inventario');
    if (tabInv && tabInv.classList.contains('active')) return;

    if (focoActivo) return;
    focoActivo = true;
    enfocarScannerInmediato();
    focoInterval = setInterval(mantenerFocoUltra, 500);
}

function enfocarScannerInmediato() {
    const input = document.getElementById('scannerInput');
    if (input && !modalAbierto && !settingsAbierto && focoActivo) {
        input.value = '';
        input.focus();
    }
}

// IDs de inputs manuales que NO deben perder el foco
const USER_INPUT_IDS = ['manualCode', 'cajasQuantity', 'dbCodeInput', 'dbDescInput', 'dbBulkInput'];

function mantenerFocoUltra() {
    const activeEl = document.activeElement;

    // Si el usuario está escribiendo en un input manual, NO robar foco
    if (activeEl && activeEl.tagName === 'INPUT' && USER_INPUT_IDS.includes(activeEl.id)) {
        return;
    }
    if (activeEl && activeEl.tagName === 'TEXTAREA') {
        return;
    }
    if (modalAbierto || settingsAbierto) return;

    const input = document.getElementById('scannerInput');
    if (input && !input.matches(':focus')) {
        input.value = '';
        input.focus();
    }
}

// ===== ESCÁNER LÁSER (UNIFICADO) =====
function initLaserScanner() {
    const input = document.getElementById('scannerInput');
    if (!input) return;

    let inputListenerActivo = false;

    // Un solo listener global — evita doble disparo
    document.addEventListener('keydown', function(e) {
        if (modalAbierto || settingsAbierto) return;

        const t = e.target;
        // Si el usuario escribe en un input manual → ignorar
        if (t && t.tagName === 'INPUT' && USER_INPUT_IDS.includes(t.id)) return;
        if (t && t.tagName === 'TEXTAREA') return;

        // Si el foco está en el input del scanner, dejamos que su keydown lo maneje
        if (document.activeElement === input) return;
        if (inputListenerActivo) return;

        // Enter / Tab → procesar buffer
        if (e.key === 'Enter' || e.keyCode === 13 || e.key === 'Tab' || e.keyCode === 9) {
            if (scanBuffer.length >= 3) {
                procesarCodigoEscaneado(scanBuffer.trim());
            }
            scanBuffer = '';
            clearTimeout(scanTimeout);
            return;
        }

        // Caracteres válidos → acumular
        if (e.key && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            scanBuffer += e.key;
            clearTimeout(scanTimeout);
            scanTimeout = setTimeout(() => { scanBuffer = ''; }, 2000);
        }
    });

    // Listener del input del scanner — única ruta cuando tiene foco
    input.addEventListener('keydown', function(e) {
        if (modalAbierto || settingsAbierto) return;
        inputListenerActivo = true;

        if (e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 9) {
            const codigo = this.value.trim();
            if (codigo.length >= 3) {
                procesarCodigoEscaneado(codigo);
            }
            this.value = '';
            // mantener activo un momento para no colisionar con document
            setTimeout(() => { inputListenerActivo = false; }, 250);
            return;
        }
        setTimeout(() => { inputListenerActivo = false; }, 250);
    });

    input.addEventListener('input', function(e) {
        if (modalAbierto || settingsAbierto) {
            this.value = '';
            return;
        }
        const val = this.value;
        if (val.length >= 3 && (val.endsWith('\n') || val.endsWith('\r'))) {
            const codigo = val.replace(/[\r\n]/g, '').trim();
            if (codigo.length >= 3) {
                procesarCodigoEscaneado(codigo);
            }
            this.value = '';
        }
    });

    input.addEventListener('paste', function(e) {
        if (modalAbierto || settingsAbierto) {
            e.preventDefault();
            this.value = '';
            return;
        }
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        if (pasted && pasted.trim().length >= 3) {
            procesarCodigoEscaneado(pasted.trim());
        }
        this.value = '';
    });

    // Función interna de procesamiento (compartida)
    function procesarCodigoEscaneado(codigo) {
        if (modalAbierto || settingsAbierto) return;
        if (scanProcessing) return;

        const now = Date.now();
        if (now - lastScanTime < 600) return;
        lastScanTime = now;
        scanProcessing = true;

        const reader = document.getElementById('reader');
        if (reader) {
            reader.classList.add('flash');
            setTimeout(() => reader.classList.remove('flash'), 300);
        }

        if (navigator.vibrate) navigator.vibrate(50);

        const lastEl = document.getElementById("lastScanned");
        if (lastEl) lastEl.innerHTML = escapeHtml(codigo);
        showToast(`📸 Código: ${codigo}`, 'success');

        agregarProductoConBusqueda(codigo, 1);

        setTimeout(() => {
            scanProcessing = false;
        }, 1000);
    }

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && !modalAbierto && !settingsAbierto) {
            setTimeout(enfocarScannerInmediato, 50);
        }
    });

    input.addEventListener('blur', function() {
        if (modalAbierto || settingsAbierto) return;
        const activeEl = document.activeElement;
        // No robar foco si el usuario está en un input manual
        if (activeEl && activeEl.tagName === 'INPUT' && USER_INPUT_IDS.includes(activeEl.id)) return;
        if (activeEl && activeEl.tagName === 'TEXTAREA') return;
        if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) {
            setTimeout(enfocarScannerInmediato, 100);
        }
    });

    reiniciarFocoScanner();
    showToast('🔦 Escáner EDA5S listo', 'success');
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
        reiniciarFocoScanner();
    }
}

function onScanSuccess(decodedText, decodedResult) {
    if (modalAbierto || settingsAbierto) return;
    if (scanProcessing) return;

    scanProcessing = true;
    const lastEl = document.getElementById("lastScanned");
    if (lastEl) lastEl.innerHTML = escapeHtml(decodedText);

    const reader = document.getElementById('reader');
    if (reader) {
        reader.classList.add('flash');
        setTimeout(() => reader.classList.remove('flash'), 300);
    }

    if (navigator.vibrate) navigator.vibrate(50);

    agregarProductoConBusqueda(decodedText, 1);

    setTimeout(() => { scanProcessing = false; }, 1000);
}

let scanErrorCount = 0;
function onScanError(errorMessage) {
    scanErrorCount++;
    if (scanErrorCount % 50 === 0) {
        console.debug('Errores de escaneo (acumulados):', scanErrorCount);
    }
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
        reiniciarFocoScanner();
    }
}

// ==================================================================
// ===== SESIÓN DE TARIMA =====
// ==================================================================
function iniciarTarima(idTarima) {
    if (!idTarima) {
        showToast('Selecciona una tarima', 'error');
        return;
    }
    const tarimaRef = window.catalogs?.obtenerTarima(idTarima);
    if (!tarimaRef) {
        showToast(`❌ Tarima ${idTarima} no está en el archivo de referencia`, 'error');
        return;
    }
    tarimaActiva = {
        id: idTarima.toUpperCase(),
        inicio: new Date().toISOString(),
        escaneos: {}
    };
    guardarTarimaActiva();
    actualizarBannerTarima();
    actualizarHeaderTarimaBadge();
    showToast(`📦 Tarima ${tarimaActiva.id} iniciada`, 'success');
    enfocarScannerInmediato();
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
                        productos[cod].cantidadCajas -= item.cajas;
                        if (productos[cod].cantidadCajas <= 0) {
                            delete productos[cod];
                        } else if (productos[cod].tarima === tarimaActiva.id) {
                            delete productos[cod].tarima;
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
    ];

    for (const banner of banners) {
        if (!banner) continue;
        if (!tarimaActiva) {
            banner.style.display = 'none';
            banner.innerHTML = '';
            continue;
        }
        const nSKUs = Object.keys(tarimaActiva.escaneos).length;
        const nCajas = Object.values(tarimaActiva.escaneos).reduce((s, x) => s + x.cajas, 0);
        banner.style.display = 'block';
        banner.innerHTML = `
            <div class="card card-padded" style="background:linear-gradient(135deg,rgba(10,132,255,0.12),rgba(191,90,242,0.08));border:0.5px solid rgba(10,132,255,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <div style="min-width:0;">
                        <div style="font-size:0.72rem;color:var(--blue-bright);font-weight:700;letter-spacing:0.5px;">
                            📦 TARIMA ACTIVA
                        </div>
                        <div style="font-weight:800;font-size:1.1rem;letter-spacing:-0.3px;">
                            ${escapeHtml(tarimaActiva.id)}
                        </div>
                        <div style="font-size:0.72rem;color:var(--label);margin-top:2px;">
                            ${nSKUs} SKU · ${nCajas} cajas escaneadas
                        </div>
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
    }

    document.querySelectorAll('.btn-verificar-tarima').forEach(b => {
        b.addEventListener('click', validarTarima);
    });
    document.querySelectorAll('.btn-cancelar-tarima').forEach(b => {
        b.addEventListener('click', cancelarTarima);
    });
}

// ===== BADGE DE TARIMA EN HEADER =====
function actualizarHeaderTarimaBadge() {
    let badge = document.getElementById('headerTarimaBadge');
    const header = document.querySelector('.app-header-inner');
    if (!header) return;

    if (!tarimaActiva) {
        if (badge) badge.remove();
        return;
    }

    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'headerTarimaBadge';
        badge.style.cssText = 'position:absolute;top:calc(var(--safe-top) + 4px);left:50%;transform:translateX(-50%);background:rgba(10,132,255,0.9);color:white;font-size:0.62rem;font-weight:800;padding:3px 10px;border-radius:100px;letter-spacing:0.4px;box-shadow:0 2px 8px rgba(10,132,255,0.4);white-space:nowrap;pointer-events:none;z-index:5;';
        const headerEl = document.querySelector('.app-header');
        if (headerEl) {
            headerEl.style.position = 'sticky';
            headerEl.appendChild(badge);
        }
    }
    const nCajas = Object.values(tarimaActiva.escaneos).reduce((s, x) => s + x.cajas, 0);
    badge.innerHTML = `<i class="fas fa-pallet"></i> ${escapeHtml(tarimaActiva.id)} · ${nCajas}`;
}

// ===== VALIDACIÓN CONTRA REFERENCIA =====
function validarTarima() {
    if (!tarimaActiva) {
        showToast('No hay tarima activa', 'warning');
        return;
    }
    const refObj = window.catalogs?.obtenerTarima(tarimaActiva.id);
    if (!refObj) {
        showToast('❌ No hay referencia cargada para esta tarima', 'error');
        return;
    }

    const escaneado = tarimaActiva.escaneos;

    // 1) Agrupar lo escaneado por materialKey
    const escaneadoPorMaterial = {};
    for (const [cod, item] of Object.entries(escaneado)) {
        const codInfo = window.catalogs.buscar(cod);
        const materialKey = codInfo ? codInfo.descNorm : null;
        const descripcionEsc = codInfo ? codInfo.descripcion : (item.nombre || cod);

        if (!materialKey) {
            const key = '__sin_match__' + cod;
            escaneadoPorMaterial[key] = {
                descripcion: descripcionEsc,
                codigoOriginal: cod,
                codigos: [cod],
                cajas: item.cajas,
                match: false
            };
            continue;
        }

        if (!escaneadoPorMaterial[materialKey]) {
            escaneadoPorMaterial[materialKey] = {
                descripcion: descripcionEsc,
                codigoOriginal: cod,
                codigos: [],
                cajas: 0,
                match: true
            };
        }
        if (!escaneadoPorMaterial[materialKey].codigos.includes(cod)) {
            escaneadoPorMaterial[materialKey].codigos.push(cod);
        }
        escaneadoPorMaterial[materialKey].cajas += item.cajas;
    }

    // 2) Construir reporte respetando el ORDEN del archivo original
    const ordenOriginal = window.catalogs.obtenerOrdenTarima(tarimaActiva.id);
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
            material: ref.material,
            descripcion: ref.descripcion,
            referencia: tarimaActiva.id,
            cajas_esperadas: esperado,
            cajas_escaneadas: escaneadoCant,
            diferencia: diff,
            estado,
            match: esc.match
        });
        yaIncluidos.add(materialKey);
    }

    for (const [key, esc] of Object.entries(escaneadoPorMaterial)) {
        if (yaIncluidos.has(key)) continue;
        filasReporte.push({
            codigo: esc.codigoOriginal || '',
            codigos: esc.codigos || [],
            material: '',
            descripcion: esc.descripcion,
            referencia: tarimaActiva.id,
            cajas_esperadas: 0,
            cajas_escaneadas: esc.cajas,
            diferencia: esc.cajas,
            estado: 'EXTRA',
            match: esc.match
        });
    }

    // 3) Totales
    let totalEsperadoCajas = 0;
    let totalEscaneadoCajas = 0;
    let totalFaltantes = 0;
    let totalSobrantes = 0;
    let totalOK = 0;
    let totalExtras = 0;

    for (const f of filasReporte) {
        totalEsperadoCajas += f.cajas_esperadas;
        totalEscaneadoCajas += f.cajas_escaneadas;
        if (f.estado === 'FALTA') totalFaltantes++;
        else if (f.estado === 'SOBRA') totalSobrantes++;
        else if (f.estado === 'EXTRA') totalExtras++;
        else if (f.estado === 'OK') totalOK++;
    }

    const reporte = {
        tarima: tarimaActiva.id,
        filas: filasReporte,
        orden: ordenOriginal,
        totalEsperadoCajas,
        totalEscaneadoCajas,
        totalSKUsRef: Object.keys(refObj).length,
        totalSKUsEsc: Object.keys(escaneadoPorMaterial).length,
        resumen: { ok: totalOK, faltantes: totalFaltantes, sobrantes: totalSobrantes, extras: totalExtras }
    };

    window._ultimoReporteTarima = reporte;
    mostrarReporteTarima(reporte);
}

// ===== REPORTE MEJORADO: orden del archivo + faltantes + extras =====
function mostrarReporteTarima(rep) {
    modalAbierto = true;
    detenerFocoScanner();

    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    // ===== FILAS: SOLO FALTANTES Y EXTRA (SOBRA se omite) =====
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
                <div style="font-weight:700;font-size:1rem;color:var(--green);margin-bottom:6px;">
                    Todo coincide
                </div>
                <div style="font-size:0.8rem;color:var(--label);">
                    No hay diferencias con la referencia
                </div>
            </div>
        `;
    } else {
        // ===== BLOQUE 1: ESCANEADO EN ORDEN DEL ARCHIVO =====
        filasHtml += `
            <div style="font-size:0.7rem;font-weight:800;color:var(--label);letter-spacing:0.6px;margin:12px 0 8px 0;text-transform:uppercase;">
                📦 Escaneado (orden del archivo)
            </div>
        `;

        for (const materialKey of rep.orden) {
            const fila = rep.filas.find(f => f.descripcion && window.catalogs.normalizar(f.descripcion) === materialKey);
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
                            <div style="font-size:0.8rem;color:var(--text);line-height:1.3;word-break:break-word;">
                                ${escapeHtml(fila.descripcion)}
                            </div>
                            <div style="font-size:0.65rem;color:var(--label);margin-top:3px;">
                                Ref: <b style="color:var(--text);">${esp}</b>
                                · Esc: <b style="color:${color};">${esc}</b>
                            </div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-weight:800;font-size:1.15rem;color:${color};letter-spacing:-0.5px;line-height:1;">
                                ${signo}${diff}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // ===== BLOQUE 2: FALTANTES =====
        if (faltantes.length > 0) {
            filasHtml += `
                <div style="font-size:0.7rem;font-weight:800;color:var(--red);letter-spacing:0.6px;margin:16px 0 8px 0;text-transform:uppercase;">
                    🔴 Faltantes (${faltantes.length})
                </div>
            `;
            faltantes.forEach(f => {
                filasHtml += `
                    <div style="padding:9px 0;border-bottom:0.5px solid var(--separator);">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                            <div style="min-width:0;flex:1;">
                                ${f.material ? `<div style="font-family:'SF Mono',monospace;font-size:0.65rem;color:var(--purple);font-weight:700;margin-bottom:3px;">${escapeHtml(f.material)}</div>` : ''}
                                <div style="font-size:0.8rem;color:var(--text);line-height:1.3;word-break:break-word;">
                                    ${escapeHtml(f.descripcion)}
                                </div>
                                <div style="font-size:0.65rem;color:var(--label);margin-top:3px;">
                                    Ref: <b>${f.cajas_esperadas}</b> · Esc: <b style="color:var(--red);">${f.cajas_escaneadas}</b>
                                </div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div style="font-weight:800;font-size:1.15rem;color:var(--red);letter-spacing:-0.5px;line-height:1;">
                                    ${f.diferencia}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        // ===== BLOQUE 3: EXTRAS =====
        if (extras.length > 0) {
            filasHtml += `
                <div style="font-size:0.7rem;font-weight:800;color:var(--purple);letter-spacing:0.6px;margin:16px 0 8px 0;text-transform:uppercase;">
                    🟣 Extras (no en referencia) · ${extras.length}
                </div>
            `;
            extras.forEach(f => {
                filasHtml += `
                    <div style="padding:9px 0;border-bottom:0.5px solid var(--separator);">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                            <div style="min-width:0;flex:1;">
                                <div style="font-size:0.8rem;color:var(--text);line-height:1.3;word-break:break-word;">
                                    ${escapeHtml(f.descripcion)}
                                </div>
                                <div style="font-size:0.65rem;color:var(--label);margin-top:3px;">
                                    Escaneado: <b style="color:var(--purple);">${f.cajas_escaneadas}</b>
                                </div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div style="font-weight:800;font-size:1.15rem;color:var(--purple);letter-spacing:-0.5px;line-height:1;">
                                    +${f.diferencia}
                                </div>
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
            <div class="modal-title">
                ${perfecto ? 'Sin diferencias' : `Reporte · ${escapeHtml(rep.tarima)}`}
            </div>
            <div class="modal-message">
                ${perfecto
                    ? 'La mercancía física coincide con la referencia.'
                    : `${faltantes.length} faltante(s) · ${extras.length} extra(s)`}
            </div>

            <div class="modal-product-info" style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;padding:3px 0;">
                    <span style="color:var(--label);font-size:0.78rem;">SKUs referencia</span>
                    <b>${rep.totalSKUsRef}</b>
                </div>
                <div style="display:flex;justify-content:space-between;padding:3px 0;">
                    <span style="color:var(--label);font-size:0.78rem;">SKUs escaneados</span>
                    <b>${rep.totalSKUsEsc}</b>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0 3px 0;border-top:0.5px solid var(--separator);margin-top:5px;">
                    <span style="color:var(--label);font-size:0.78rem;">Cajas esperadas</span>
                    <b>${rep.totalEsperadoCajas}</b>
                </div>
                <div style="display:flex;justify-content:space-between;padding:3px 0;">
                    <span style="color:var(--label);font-size:0.78rem;">Cajas escaneadas</span>
                    <b style="color:${diffTotal === 0 ? 'var(--green)' : 'var(--red)'};">${rep.totalEscaneadoCajas}</b>
                </div>
                <div style="display:flex;justify-content:space-between;padding:3px 0;">
                    <span style="color:var(--label);font-size:0.78rem;">Diferencia total</span>
                    <b style="color:${diffTotal === 0 ? 'var(--green)' : 'var(--red)'};">
                        ${diffTotal > 0 ? '+' : ''}${diffTotal}
                    </b>
                </div>
            </div>

            <div style="max-height:42vh;overflow-y:auto;padding:0 16px;margin-bottom:12px;">
                ${filasHtml}
            </div>

            <div class="modal-actions">
                <button class="modal-btn modal-btn-primary" id="repConfirmar">
                    <i class="fas fa-check"></i> Finalizar tarima
                </button>
                <button class="modal-btn modal-btn-secondary" id="repExportar">
                    <i class="fas fa-file-export"></i> Exportar (CSV)
                </button>
                <button class="modal-btn modal-btn-secondary" id="repSeguir">
                    Seguir escaneando
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');

    const cerrar = () => {
        modalAbierto = false;
        overlay.classList.remove('active');
        setTimeout(() => { overlay.remove(); reiniciarFocoScanner(); }, 300);
    };

    document.getElementById('repConfirmar').addEventListener('click', () => {
        showToast(`✅ Tarima ${tarimaActiva.id} finalizada`, 'success');
        tarimaActiva = null;
        guardarTarimaActiva();
        actualizarBannerTarima();
        actualizarHeaderTarimaBadge();
        cerrar();
    });

    document.getElementById('repExportar').addEventListener('click', () => {
        exportarReporteTarimaCSV(rep, faltantes, extras);
    });

    document.getElementById('repSeguir').addEventListener('click', cerrar);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cerrar();
    });
}

// ===== EXPORTAR REPORTE (orden del archivo + faltantes + extras) =====
function exportarReporteTarimaCSV(rep, faltantes, extras) {
    if (!rep) {
        showToast('No hay reporte para exportar', 'warning');
        return;
    }

    const codigosDeFila = (f) => {
        if (Array.isArray(f.codigos) && f.codigos.length) return f.codigos.join(', ');
        return f.codigo || '';
    };

    const headers = ['codigo', 'material', 'descripcion', 'referencia', 'cajas_esperadas', 'cajas_escaneadas', 'diferencia', 'estado'];
    const rows = [headers];

    // Bloque 1: en orden del archivo
    rows.push(['# ESCANEADO EN ORDEN DEL ARCHIVO', '', '', '', '', '', '', '']);
    for (const materialKey of rep.orden) {
        const f = rep.filas.find(x => x.descripcion && window.catalogs.normalizar(x.descripcion) === materialKey);
        if (!f) continue;
        rows.push([
            codigosDeFila(f),
            f.material || '',
            f.descripcion || '',
            f.referencia || '',
            f.cajas_esperadas,
            f.cajas_escaneadas,
            f.diferencia,
            f.estado
        ]);
    }

    // Bloque 2: faltantes
    if (faltantes && faltantes.length > 0) {
        rows.push([]);
        rows.push(['# FALTANTES', '', '', '', '', '', '', '']);
        for (const f of faltantes) {
            rows.push([
                codigosDeFila(f),
                f.material || '',
                f.descripcion || '',
                f.referencia || '',
                f.cajas_esperadas,
                f.cajas_escaneadas,
                f.diferencia,
                'FALTA'
            ]);
        }
    }

    // Bloque 3: extras
    if (extras && extras.length > 0) {
        rows.push([]);
        rows.push(['# EXTRAS', '', '', '', '', '', '', '']);
        for (const f of extras) {
            rows.push([
                codigosDeFila(f),
                f.material || '',
                f.descripcion || '',
                f.referencia || '',
                f.cajas_esperadas,
                f.cajas_escaneadas,
                f.diferencia,
                'EXTRA'
            ]);
        }
    }

    // Resumen
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
    if (tarimas.length === 0) {
        showToast('⚠️ Sube un archivo de materiales con columna "referencia" primero', 'warning');
        return;
    }

    modalAbierto = true;
    detenerFocoScanner();

    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    let listaHtml = tarimas.map(tid => {
        const meta = window.catalogs.tarimasMeta[tid] || { skus: 0, totalCajas: 0 };
        return `
            <button class="modal-btn modal-btn-secondary" data-tarima="${escapeHtml(tid)}"
                style="text-align:left;display:flex;justify-content:space-between;align-items:center;padding:14px 16px;">
                <span>
                    <b style="font-size:1rem;">${escapeHtml(tid)}</b>
                    <small style="display:block;color:var(--label);font-weight:500;margin-top:2px;">
                        ${meta.skus} SKU · ${meta.totalCajas} cajas
                    </small>
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
            <div style="max-height:50vh;overflow-y:auto;padding:0 16px;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
                ${listaHtml}
            </div>
            <div class="modal-actions">
                <button class="modal-btn modal-btn-cancel" id="tarCancel">Cancelar</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');

    const cerrar = () => {
        modalAbierto = false;
        overlay.classList.remove('active');
        setTimeout(() => { overlay.remove(); reiniciarFocoScanner(); }, 300);
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
                enfocarScannerInmediato();
            }},
            { text: 'Cancelar', type: 'cancel', action: enfocarScannerInmediato }
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
                if (currentQty === 0) {
                    eliminarProducto(codigo);
                } else {
                    productos[codigo].cantidadCajas = currentQty;
                    productos[codigo].timestamp = new Date().toISOString();
                    guardarDatos();
                    renderizarProductos();
                    actualizarEstadisticas();
                    showToast(`Cantidad actualizada`);
                }
                enfocarScannerInmediato();
            }},
            { text: 'Cancelar', type: 'cancel', action: enfocarScannerInmediato }
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
                <div class="empty-state-icon">
                    <i class="fas fa-qrcode"></i>
                </div>
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
                        <div class="product-qty">
                            ${prod.cantidadCajas}
                            <small>Cajas</small>
                        </div>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="icon-btn edit-qty" data-code="${escapeHtml(prod.codigo)}">
                        <i class="fas fa-pen"></i> Editar
                    </button>
                    <button class="icon-btn danger delete-prod" data-code="${escapeHtml(prod.codigo)}">
                        <i class="fas fa-trash"></i> Eliminar
                    </button>
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
function showModal(options) {
    modalAbierto = true;
    detenerFocoScanner();

    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    let iconHtml = '';
    if (options.icon) {
        const iconClass = options.iconType === 'error' ? 'error' : options.iconType === 'warning' ? 'warning' : '';
        iconHtml = `<div class="scan-success-icon ${iconClass}"><i class="fas fa-${options.icon}"></i></div>`;
    }

    let productInfoHtml = '';
    if (options.productInfo) {
        productInfoHtml = `
            <div class="modal-product-info">
                <div class="modal-product-name">${escapeHtml(options.productInfo.name)}</div>
                <div class="modal-product-code">${escapeHtml(options.productInfo.code)}</div>
            </div>
        `;
    }

    let stepperHtml = '';
    if (options.stepper) {
        let val = options.stepper.value;
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
    options.actions.forEach((action, idx) => {
        if (action.type === 'cancel') {
            actionsHtml += `<button class="modal-btn modal-btn-cancel" data-action="cancel-${idx}">${escapeHtml(action.text)}</button>`;
        } else if (action.type === 'danger') {
            actionsHtml += `<button class="modal-btn modal-btn-danger" data-action="action-${idx}">${escapeHtml(action.text)}</button>`;
        } else if (action.type === 'secondary') {
            actionsHtml += `<button class="modal-btn modal-btn-secondary" data-action="action-${idx}">${escapeHtml(action.text)}</button>`;
        } else {
            actionsHtml += `<button class="modal-btn modal-btn-primary" data-action="action-${idx}">${escapeHtml(action.text)}</button>`;
        }
    });

    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="modal-handle"></div>
            ${iconHtml}
            <div class="modal-title">${escapeHtml(options.title)}</div>
            ${options.message ? `<div class="modal-message">${escapeHtml(options.message)}</div>` : ''}
            ${productInfoHtml}
            ${stepperHtml}
            <div class="modal-actions">
                ${actionsHtml}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('active');

    if (options.stepper) {
        let currentVal = options.stepper.value;
        const valEl = document.getElementById('modalStepValue');
        document.getElementById('modalStepDown').addEventListener('click', () => {
            if (currentVal > 0) {
                currentVal--;
                valEl.textContent = currentVal;
                options.stepper.onChange(currentVal);
            }
        });
        document.getElementById('modalStepUp').addEventListener('click', () => {
            currentVal++;
            valEl.textContent = currentVal;
            options.stepper.onChange(currentVal);
        });
    }

    options.actions.forEach((action, idx) => {
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
            const cancelAction = options.actions.find(a => a.type === 'cancel');
            if (cancelAction && cancelAction.action) cancelAction.action();
        }
    });

    function closeModal() {
        modalAbierto = false;
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
            reiniciarFocoScanner();
        }, 300);
    }

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}
window.showModal = showModal;

// ===== EXPORTAR CSV (inventario general) =====
function exportarCSV() {
    const productosArray = Object.values(productos);
    if (productosArray.length === 0) {
        showToast("No hay datos para exportar", "error");
        return;
    }
    let csvRows = [["Código", "Material", "Descripción Material", "Nombre Producto", "Marca", "Tarima", "Cantidad Cajas", "Match %", "Fecha Registro"]];
    for (let prod of productosArray) {
        csvRows.push([
            prod.codigo,
            prod.material || "",
            prod.materialNombre || "",
            prod.nombre || "Sin descripción",
            prod.marca || "N/A",
            prod.tarima || "",
            prod.cantidadCajas,
            prod.matchPuntaje || "",
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
                enfocarScannerInmediato();
            }},
            { text: 'Cancelar', type: 'cancel', action: enfocarScannerInmediato }
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
    initLaserScanner();
    actualizarHeaderTarimaBadge();

    // ===== BOTÓN INICIAR TARIMA =====
    const iniciarTarimaBtn = document.getElementById("iniciarTarimaBtn");
    if (iniciarTarimaBtn) {
        iniciarTarimaBtn.addEventListener("click", abrirSelectorTarima);
    }

    // ===== BOTÓN DE CÁMARA =====
    const startBtn = document.getElementById("startScannerBtn");
    if (startBtn) {
        startBtn.addEventListener("click", function() {
            if (isScanning) {
                detenerScanner();
            } else {
                showModal({
                    icon: 'camera',
                    iconType: 'normal',
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
                            reiniciarFocoScanner();
                        }},
                        { text: 'Cancelar', type: 'cancel' }
                    ]
                });
            }
        });
    }

    // ===== BOTÓN MANUAL (ahora vive en la pestaña Inventario) =====
    const addManualBtn = document.getElementById("addManualBtn");
    const manualCode = document.getElementById("manualCode");
    const cajasQuantity = document.getElementById("cajasQuantity");

    if (addManualBtn && manualCode && cajasQuantity) {
        addManualBtn.addEventListener("click", async () => {
            const code = manualCode.value.trim();
            const cant = cajasQuantity.value;
            if (code === "") {
                showToast("Ingresa un código", "error");
                manualCode.focus();
                return;
            }
            addManualBtn.disabled = true;
            try {
                await agregarProductoConBusqueda(code, parseInt(cant));
                manualCode.value = "";
                cajasQuantity.value = "1";
            } finally {
                addManualBtn.disabled = false;
            }
            // El foco lo maneja reiniciarFocoScanner() al cerrar el modal.
            // Mantener el foco en manualCode para seguir capturando:
            manualCode.focus();
        });

        manualCode.addEventListener("keypress", (e) => {
            if (e.key === "Enter") addManualBtn.click();
        });
    }

    // Exportar y reset
    const exportBtn = document.getElementById("exportExcelBtn");
    const resetBtn = document.getElementById("resetAllBtn");

    if (exportBtn) exportBtn.addEventListener("click", exportarCSV);
    if (resetBtn) resetBtn.addEventListener("click", resetSistema);

    // ===== CONFIGURACIÓN / BASE DE DATOS =====
    function abrirSettings() {
        settingsAbierto = true;
        detenerFocoScanner();

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
        settingsAbierto = false;
        const settingsOverlay = document.getElementById('settingsOverlay');
        if (settingsOverlay) settingsOverlay.classList.remove('active');
        setTimeout(() => {
            reiniciarFocoScanner();
            document.dispatchEvent(new CustomEvent('settings:closed'));
        }, 300);
    }
    window.cerrarSettings = cerrarSettings;

    const settingsClose = document.getElementById('settingsClose');
    if (settingsClose) {
        settingsClose.addEventListener('click', (e) => {
            e.preventDefault();
            cerrarSettings();
        });
    }

    const settingsOverlayEl = document.getElementById('settingsOverlay');
    if (settingsOverlayEl) {
        settingsOverlayEl.addEventListener('click', (e) => {
            if (e.target === settingsOverlayEl) cerrarSettings();
        });
    }

    // ===== INDICADOR DE ESTADO =====
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
        } catch (e) {
            console.error('❌ Error verificando DB:', e);
        }
    }, 500);

    window.addEventListener("beforeunload", () => {
        if (focoInterval) clearInterval(focoInterval);
        if (html5QrCode && isScanning) {
            html5QrCode.stop().catch(e => console.log(e));
        }
    });
});