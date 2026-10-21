// ===== CONSULTA A BASE DE DATOS LOCAL (SIN API EXTERNA) =====
async function buscarProducto(codigo) {
    await database.esperarInicializacion();

    // 1) Catálogo de códigos
    if (window.catalogs) {
        const enCatalogo = window.catalogs.buscar(codigo);
        if (enCatalogo) {
            // ✅ Si tiene material asignado, usar catálogo completo
            if (enCatalogo.material) {
                console.log('✅ Encontrado en catálogo (con material):', enCatalogo);
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

            // ✅ Código existe pero SIN material: usar su descripción propia
            if (enCatalogo.descripcion) {
                console.log('✅ Encontrado en catálogo (sin material, usando descripción):', enCatalogo);
                return {
                    nombre: enCatalogo.descripcion,
                    marca: null,
                    material: null,
                    materialNombre: null,
                    matchPuntaje: 0,
                    encontrado: true,
                    origen: 'catalogo_sin_material'
                };
            }
        }
    }

    // 2) DB local
    const productoLocal = database.buscarProducto(codigo);
    if (productoLocal && productoLocal.descripcion) {
        console.log('✅ Producto encontrado en DB local:', productoLocal);
        return {
            nombre: productoLocal.descripcion,
            marca: "Base de datos local",
            material: null,
            encontrado: true,
            origen: 'local'
        };
    }

    // 3) No encontrado
    console.log('❌ Código no encontrado en fuentes locales:', codigo);
    return {
        nombre: null,
        marca: null,
        material: null,
        encontrado: false,
        origen: 'none'
    };
}