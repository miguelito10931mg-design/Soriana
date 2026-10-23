// ============================================================
// SCANNER-STATE.JS
// Máquina de estados única para foco / buffer / escaneo láser.
// Reemplaza: focoActivo, focoInterval, scanBuffer, scanTimeout,
//            mantenerFocoUltra, enfocarScannerInmediato,
//            detenerFocoScanner, reiniciarFocoScanner,
//            modalAbierto, settingsAbierto, scanProcessing
// ============================================================

(function () {
    'use strict';

    const CONFIG = {
        FOCUS_INTERVAL_MS: 500,
        BLUR_REFOCUS_MS: 100,
        VISIBILITY_REFOCUS_MS: 50,
        BUFFER_TIMEOUT_MS: 2000,
        MIN_CODE_LEN: 3,
        SCAN_DEBOUNCE_MS: 600,
        PROCESSING_COOLDOWN_MS: 400,
        UNBLOCK_DELAY_MS: 300,
    };

    const INPUT_ID = 'scannerInput';
    const USER_INPUT_IDS = ['manualCode', 'cajasQuantity', 'dbCodeInput', 'dbDescInput', 'dbBulkInput'];

    const state = {
        mode: 'idle',
        blockedBy: null,
        blockedToken: 0,
        focusTimer: null,
        buffer: '',
        bufferTimer: null,
        lastScanAt: 0,
        processing: false,
        onScan: null,
        onFlash: null,
        onVibrate: null,
        initialized: false,
    };

    function getInput() { return document.getElementById(INPUT_ID); }

    function isUserTyping() {
        const el = document.activeElement;
        if (!el) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName === 'INPUT' && USER_INPUT_IDS.includes(el.id)) return true;
        return false;
    }

    function isBlocked() { return state.blockedBy !== null && state.blockedBy.size > 0; }
    function canFocus() { return state.mode === 'active' && !isBlocked() && !isUserTyping(); }
    function canScan() { return state.mode === 'active' && !isBlocked() && !state.processing; }

    function clearBuffer() {
        state.buffer = '';
        if (state.bufferTimer) { clearTimeout(state.bufferTimer); state.bufferTimer = null; }
    }

    function doFocus() {
        const input = getInput();
        if (!input) return;
        if (!canFocus()) return;
        if (input.matches(':focus')) return;
        input.value = '';
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }

    const ScannerState = {
        init({ onScan, onFlash, onVibrate } = {}) {
            if (state.initialized) return;
            state.initialized = true;
            state.onScan = typeof onScan === 'function' ? onScan : null;
            state.onFlash = typeof onFlash === 'function' ? onFlash : null;
            state.onVibrate = typeof onVibrate === 'function' ? onVibrate : null;

            const input = getInput();
            if (!input) { console.warn('ScannerState: no existe #' + INPUT_ID); return; }

            input.addEventListener('keydown', (e) => {
                if (isBlocked()) return;
                if (e.key === 'Enter' || e.keyCode === 13 || e.key === 'Tab' || e.keyCode === 9) {
                    const codigo = input.value.trim();
                    input.value = '';
                    clearBuffer();
                    if (codigo.length >= CONFIG.MIN_CODE_LEN) this._dispatch(codigo, 'input-keydown');
                }
            });

            input.addEventListener('input', () => {
                if (isBlocked()) { input.value = ''; return; }
                const val = input.value;
                if (val.length >= CONFIG.MIN_CODE_LEN && (val.endsWith('\n') || val.endsWith('\r'))) {
                    const codigo = val.replace(/[\r\n]/g, '').trim();
                    input.value = '';
                    clearBuffer();
                    if (codigo.length >= CONFIG.MIN_CODE_LEN) this._dispatch(codigo, 'input');
                }
            });

            input.addEventListener('paste', (e) => {
                if (isBlocked()) { e.preventDefault(); input.value = ''; return; }
                e.preventDefault();
                const pasted = (e.clipboardData || window.clipboardData).getData('text');
                input.value = '';
                clearBuffer();
                if (pasted && pasted.trim().length >= CONFIG.MIN_CODE_LEN) this._dispatch(pasted.trim(), 'paste');
            });

            input.addEventListener('blur', () => {
                if (!canFocus()) return;
                setTimeout(() => doFocus(), CONFIG.BLUR_REFOCUS_MS);
            });

            document.addEventListener('focusin', (e) => {
                const t = e.target;
                if (t && t.tagName === 'INPUT' && USER_INPUT_IDS.includes(t.id)) clearBuffer();
            });

            document.addEventListener('keydown', (e) => {
                if (isBlocked()) return;
                if (isUserTyping()) return;
                if (document.activeElement === input) return;

                if (e.key === 'Enter' || e.keyCode === 13 || e.key === 'Tab' || e.keyCode === 9) {
                    if (state.buffer.length >= CONFIG.MIN_CODE_LEN) {
                        const buffered = state.buffer;
                        clearBuffer();
                        this._dispatch(buffered, 'buffer');
                    } else { clearBuffer(); }
                    return;
                }

                if (e.key && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    state.buffer += e.key;
                    if (state.bufferTimer) clearTimeout(state.bufferTimer);
                    state.bufferTimer = setTimeout(() => clearBuffer(), CONFIG.BUFFER_TIMEOUT_MS);
                }
            });

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && canFocus()) setTimeout(() => doFocus(), CONFIG.VISIBILITY_REFOCUS_MS);
            });

            if (state.focusTimer) clearInterval(state.focusTimer);
            state.focusTimer = setInterval(() => {
                if (!canFocus()) return;
                doFocus();
            }, CONFIG.FOCUS_INTERVAL_MS);
        },

        activate() { state.mode = 'active'; doFocus(); },
        deactivate() {
            state.mode = 'idle';
            const input = getInput();
            if (input) input.value = '';
            clearBuffer();
        },

        block(reason) {
            if (!state.blockedBy) state.blockedBy = new Set();
            state.blockedBy.add(reason);
            state.blockedToken++;
            const input = getInput();
            if (input) input.blur();
        },

        unblock(reason) {
            const myToken = ++state.blockedToken;
            if (state.blockedBy) state.blockedBy.delete(reason);
            setTimeout(() => {
                if (myToken !== state.blockedToken) return;
                if (isBlocked()) return;
                if (!canFocus()) return;
                doFocus();
            }, CONFIG.UNBLOCK_DELAY_MS);
        },

        canScan() { return canScan(); },

        notifyScan(codigo) {
            if (!canScan()) return false;
            const now = Date.now();
            if (now - state.lastScanAt < CONFIG.SCAN_DEBOUNCE_MS) return false;
            state.lastScanAt = now;
            state.processing = true;
            if (state.onFlash) { try { state.onFlash(); } catch (e) {} }
            if (state.onVibrate) { try { state.onVibrate(); } catch (e) {} }
            if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }
            return true;
        },

        finishScan() {
            setTimeout(() => { state.processing = false; }, CONFIG.PROCESSING_COOLDOWN_MS);
        },

        _dispatch(codigo, origen) {
            if (!this.notifyScan(codigo)) return;
            if (state.onScan) {
                try { state.onScan(codigo, origen); } catch (e) { console.error('onScan error:', e); }
            }
        },

        _debug() {
            return {
                mode: state.mode,
                blockedBy: state.blockedBy ? Array.from(state.blockedBy) : [],
                buffer: state.buffer,
                processing: state.processing,
                activeElement: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
                canScan: canScan(),
                canFocus: canFocus(),
            };
        },
    };

    window.ScannerState = ScannerState;
})();