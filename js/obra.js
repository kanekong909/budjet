if (!requireAuth()) void 0;

let obra = obraActual();
if (!obra) window.location.href = 'dashboard.html';

let gastos = [], categorias = [], paginaActual = 1, totalPaginas = 1, sumaVisible = 0;
let gastoDetalleActual = null;
let catFiltro = '', busqFiltro = '';

// ── Inicializar ──
document.getElementById('header-obra-nombre').textContent = obra.nombre;
document.getElementById('g-fecha').value = todayISO();

cargarCategorias();
cargarGastos();
// Cargar tareas en segundo plano para mostrar badge desde el inicio
cargarTareas();

// ── Tabs ──
function mostrarTab(tab) {
    ['gastos', 'resumen', 'equipo', 'progreso', 'tareas'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.toggle('activa', t === tab);
        document.getElementById(`tab-btn-${t}`)?.classList.toggle('active', t === tab);
    });
    document.getElementById('fab-agregar').style.display = (tab === 'gastos' || tab === 'progreso' || tab === 'tareas') ? 'flex' : 'none';
    document.getElementById('total-bar').style.display = tab === 'gastos' ? 'flex' : 'none';
    if (tab === 'resumen') cargarResumen();
    if (tab === 'equipo') { cargarColaboradores(); renderCategorias(); }
    if (tab === 'progreso') cargarProgreso();
    if (tab === 'tareas') cargarTareas();
}
// Sincronizar nav tab buttons
['gastos', 'resumen', 'equipo', 'progreso', 'tareas'].forEach(t => {
    document.getElementById(`tab-btn-${t}`)?.addEventListener('click', () => {
        document.querySelectorAll('[id^="tab-btn-"]').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-btn-${t}`)?.classList.add('active');
    });
});

// ── Categorías ──
async function cargarCategorias() {
    categorias = await api.get(`/api/gastos/categorias?obra_id=${obra.id}`);
    renderSelectorCategorias([]);

    const filtros = document.getElementById('filtros-cat');
    filtros.innerHTML = `<div class="filtro-chip active" data-cat="" onclick="filtrarCategoria(this,'')">Todos</div>` +
        categorias.map(c => `<div class="filtro-chip" data-cat="${c.id}" onclick="filtrarCategoria(this,'${c.id}')" style="border-left:3px solid ${c.color}">${c.nombre}</div>`).join('');
}

function filtrarCategoria(el, catId) {
    document.querySelectorAll('#filtros-cat .filtro-chip').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    catFiltro = catId;
    paginaActual = 1;
    cargarGastos();
}

function filtrarBusqueda() {
    busqFiltro = document.getElementById('busqueda').value.toLowerCase();
    document.getElementById('btn-limpiar-busqueda').style.display = busqFiltro ? 'block' : 'none';
    renderGastos();
}

// ── Gastos ──
async function cargarGastos() {
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;
    let url = `/api/gastos?obra_id=${obra.id}&page=${paginaActual}&limit=50`;
    if (desde) url += `&fecha_desde=${desde}`;
    if (hasta) url += `&fecha_hasta=${hasta}`;
    if (catFiltro) url += `&categoria_id=${catFiltro}`;

    try {
        if (!isOnline) {
            // Usar cache local
            const cached = await obtenerGastosCache(obra.id);
            const pendientes = await dbGetAll('gastos_pendientes', 'obra_id', obra.id);
            gastos = [...pendientes.map(p => ({ ...p, _pendiente: true })), ...cached];
            sumaVisible = gastos.filter(g => !g.categorias?.some(c => c.tipo === 'ingreso'))
                .reduce((s, g) => s + parseFloat(g.monto || 0), 0);
            totalPaginas = 1;
            document.getElementById('total-visible').textContent = formatMoney(sumaVisible);
            renderGastos();
            showToast('📵 Mostrando datos guardados', 'ok');
            return;
        }
        const data = await api.get(url);
        gastos = data.gastos;
        totalPaginas = data.paginas;
        sumaVisible = data.suma;
        // Cachear para uso offline
        cachearGastos(data.gastos);
        sumaVisible = data.suma;
        const ingresos = data.suma_ingresos || 0;
        document.getElementById('total-visible').textContent = formatMoney(data.suma);
        if (ingresos > 0) {
            document.getElementById('total-ingresos-bar').textContent = `Capital: ${formatMoney(ingresos)}`;
            document.getElementById('total-disponible').textContent = `Disp: ${formatMoney(ingresos - data.suma)}`;
        } else {
            document.getElementById('total-ingresos-bar').textContent = '';
            document.getElementById('total-disponible').textContent = '';
        }
        renderGastos();
        renderPaginacion(data.total, data.paginas);
    } catch (err) {
        showToast('Error cargando gastos', 'error');
    }
}

let modoSeleccion = false;
let gastosSeleccionados = new Set();

function renderGastos() {
    const lista = document.getElementById('gastos-lista');
    let filtrados = gastos;
    if (busqFiltro) {
        filtrados = gastos.filter(g =>
            g.descripcion.toLowerCase().includes(busqFiltro) ||
            (g.proveedor || '').toLowerCase().includes(busqFiltro)
        );
    }
    if (!filtrados.length) {
        lista.innerHTML = `<div class="empty" style="padding:30px"><div class="empty-icon">📋</div><div class="empty-msg">Sin gastos${busqFiltro ? ' para "' + busqFiltro + '"' : ''}</div></div>`;
        return;
    }

    lista.className = modoSeleccion ? 'modo-seleccion' : '';
    lista.innerHTML = filtrados.map(g => `
        <div class="gasto-item${gastosSeleccionados.has(g.id) ? ' seleccionado' : ''}"
          id="gasto-row-${g.id}"
          onclick="clickGasto(${g.id})"
          ontouchstart="iniciarLongPress(${g.id})"
          ontouchend="cancelarLongPress()"
          ontouchmove="cancelarLongPress()"
          onmousedown="iniciarLongPress(${g.id})"
          onmouseup="cancelarLongPress()"
          onmouseleave="cancelarLongPress()">
          <div class="check-gasto">${gastosSeleccionados.has(g.id) ? '✓' : ''}</div>
          <div class="gasto-cat-dot" style="background:${g.categorias?.[0]?.color || g.categoria_color || '#aeaeb2'}"></div>
          <div class="gasto-info">
            <div class="gasto-desc">${g._pendiente ? '💾 ' : ''}${g.descripcion}</div>
            <div class="gasto-meta">${formatDate(g.fecha)} · ${g.categorias?.map(c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};margin-right:2px"></span>${c.nombre}`).join(', ') || 'Sin cat.'} ${g.proveedor ? '· ' + g.proveedor : ''}</div>
          </div>
          ${g.foto_url ? '<span class="gasto-foto">📷</span>' : ''}
          <div class="gasto-monto">${formatMoney(g.monto)}</div>
        </div>
      `).join('');

    // Actualizar total si hay filtro de búsqueda
    if (busqFiltro) {
        const suma = filtrados.reduce((s, g) => s + parseFloat(g.monto), 0);
        document.getElementById('total-visible').textContent = formatMoney(suma);
    }
}

function renderPaginacion(total, paginas) {
    const wrap = document.getElementById('paginacion');
    wrap.style.display = paginas > 1 ? 'flex' : 'none';
    document.getElementById('pag-info').textContent = `${paginaActual} / ${paginas}`;
    document.getElementById('btn-prev').disabled = paginaActual <= 1;
    document.getElementById('btn-next').disabled = paginaActual >= paginas;
}

function cambiarPagina(dir) {
    paginaActual = Math.max(1, Math.min(totalPaginas, paginaActual + dir));
    cargarGastos();
    window.scrollTo(0, 0);
}

// ── Ver detalle gasto ──
function verGasto(id) {
    gastoDetalleActual = gastos.find(g => g.id === id);
    const g = gastoDetalleActual;

    document.getElementById('detalle-desc').textContent = g.descripcion;
    document.getElementById('detalle-monto').textContent = formatMoney(g.monto);
    document.getElementById('detalle-fecha').textContent = formatDate(g.fecha);
    document.getElementById('detalle-cat').innerHTML = g.categorias?.length
        ? g.categorias.map(c => `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600;background:${c.color};color:#fff;margin:1px">${c.nombre}</span>`).join('')
        : '—';
    document.getElementById('detalle-prov').textContent = g.proveedor || '—';
    document.getElementById('detalle-usuario').textContent = `Registrado por: ${g.usuario_nombre || '—'}`;

    // Cantidad / unidad / valor unitario
    const cantWrap = document.getElementById('detalle-cant-wrap');
    if (g.cantidad && g.valor_unitario) {
        cantWrap.style.display = 'grid';
        document.getElementById('detalle-cantidad').textContent = `${parseFloat(g.cantidad).toLocaleString('es-CO')} ${g.unidad || 'und'}`;
        document.getElementById('detalle-vunitario').textContent = formatMoney(g.valor_unitario);
    } else if (g.cantidad) {
        cantWrap.style.display = 'grid';
        document.getElementById('detalle-cantidad').textContent = `${parseFloat(g.cantidad).toLocaleString('es-CO')} ${g.unidad || 'und'}`;
        document.getElementById('detalle-vunitario').textContent = '—';
    } else {
        cantWrap.style.display = 'none';
    }

    const notasWrap = document.getElementById('detalle-notas-wrap');
    if (g.notas) {
        notasWrap.style.display = 'block';
        document.getElementById('detalle-notas').textContent = g.notas;
    } else {
        notasWrap.style.display = 'none';
    }

    const fotoEl = document.getElementById('detalle-foto');
    if (g.foto_url) {
        fotoEl.src = g.foto_url;
        fotoEl.style.display = 'block';
    } else {
        fotoEl.style.display = 'none';
    }

    document.getElementById('overlay-detalle').classList.add('open');
}

function editarDesdeDetalle() {
    cerrarSheet('overlay-detalle');
    setTimeout(() => abrirGasto(gastoDetalleActual), 200);
}

function eliminarGasto() {
    document.getElementById('confirmar-desc').textContent = gastoDetalleActual.descripcion;
    document.getElementById('confirmar-monto').textContent = formatMoney(gastoDetalleActual.monto);
    document.getElementById('overlay-confirmar').classList.add('open');
}

async function confirmarEliminar() {
    try {
        await api.delete(`/api/gastos/${gastoDetalleActual.id}`);
        cerrarSheet('overlay-confirmar');
        cerrarSheet('overlay-detalle');
        showToast('Gasto eliminado');
        cargarGastos();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Agregar/editar gasto ──
function abrirGasto(g = null) {
    const isEdit = !!g;
    document.getElementById('gasto-sheet-title').textContent = isEdit ? 'Editar gasto' : 'Nuevo gasto';
    document.getElementById('gasto-edit-id').value = isEdit ? g.id : '';
    document.getElementById('g-desc').value = isEdit ? g.descripcion : '';
    const montoVal = isEdit ? g.monto : '';
    document.getElementById('g-monto').value = montoVal;
    document.getElementById('g-monto-display').value = montoVal ? formatMontoInput(String(Math.round(montoVal))) : '';
    document.getElementById('g-fecha').value = isEdit ? g.fecha?.split('T')[0] : todayISO();
    const selIds = isEdit && g.categorias ? g.categorias.map(c => c.id) : [];
    renderSelectorCategorias(selIds);
    document.getElementById('g-proveedor').value = isEdit ? (g.proveedor || '') : '';
    document.getElementById('g-notas').value = isEdit ? (g.notas || '') : '';
    document.getElementById('g-cantidad').value = isEdit ? (g.cantidad || '') : '';
    document.getElementById('g-unidad').value = isEdit ? (g.unidad || '') : '';
    const vu = isEdit && g.valor_unitario ? Math.round(g.valor_unitario) : '';
    document.getElementById('g-vunitario').value = vu;
    document.getElementById('g-vunitario-display').value = vu ? parseInt(vu).toLocaleString('es-CO').replace(/,/g, '.') : '';
    document.getElementById('g-foto').value = '';
    document.getElementById('g-foto-camara').value = '';
    document.getElementById('g-foto-galeria').value = '';
    document.getElementById('g-foto').dataset.borrar = '';
    const prev = document.getElementById('foto-preview');
    const wrap = document.getElementById('foto-preview-wrap');
    if (isEdit && g.foto_url) {
        prev.src = g.foto_url;
        prev.dataset.esUrl = '1'; // marca que es URL existente, no archivo nuevo
        wrap.style.display = 'block';
    } else {
        prev.src = '';
        prev.dataset.esUrl = '';
        wrap.style.display = 'none';
    }
    document.getElementById('overlay-gasto').classList.add('open');
}

function previewFoto(input) {
    const prev = document.getElementById('foto-preview');
    const wrap = document.getElementById('foto-preview-wrap');
    if (input.files[0] && input.files[0].type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => { prev.src = e.target.result; wrap.style.display = 'block'; };
        reader.readAsDataURL(input.files[0]);
    }
}

function seleccionarFotoGasto(input) {
    if (!input.files[0]) return;
    const dt = new DataTransfer();
    dt.items.add(input.files[0]);
    document.getElementById('g-foto').files = dt.files;
    // Limpiar referencia a foto anterior
    document.getElementById('foto-preview').dataset.esUrl = '';
    document.getElementById('g-foto').dataset.borrar = '';
    previewFoto(input);
}

function eliminarFotoGasto() {
    document.getElementById('g-foto').value = '';
    document.getElementById('g-foto-camara').value = '';
    document.getElementById('g-foto-galeria').value = '';
    const prev = document.getElementById('foto-preview');
    prev.src = '';
    prev.dataset.esUrl = '';
    document.getElementById('foto-preview-wrap').style.display = 'none';
    document.getElementById('g-foto').dataset.borrar = '1';
}

async function guardarGasto(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-guardar-gasto');
    const editId = document.getElementById('gasto-edit-id').value;
    setLoading(btn, true);

    const fd = new FormData();
    fd.append('descripcion', document.getElementById('g-desc').value.trim());
    fd.append('monto', document.getElementById('g-monto').value);
    fd.append('fecha', document.getElementById('g-fecha').value);
    fd.append('obra_id', obra.id);
    fd.append('categorias', JSON.stringify(catsSeleccionadas));
    fd.append('proveedor', document.getElementById('g-proveedor').value.trim());
    fd.append('notas', document.getElementById('g-notas').value.trim());
    fd.append('cantidad', document.getElementById('g-cantidad').value || '');
    fd.append('unidad', document.getElementById('g-unidad').value.trim());
    fd.append('valor_unitario', document.getElementById('g-vunitario').value || '');
    const fotoInput = document.getElementById('g-foto');
    const fotoFile = fotoInput.files[0];
    if (fotoFile) {
        fd.append('foto', fotoFile);
    } else if (fotoInput.dataset.borrar === '1') {
        fd.append('borrar_foto', '1');
    }

    try {
        if (editId) {
            await api.putForm(`/api/gastos/${editId}`, fd);
            showToast('Gasto actualizado ✓');
        } else {
            if (!isOnline) {
                await guardarGastoOffline(fd);
                cerrarSheet('overlay-gasto');
                mostrarBadgePendientes();
                cargarGastos();
                setLoading(btn, false);
                return;
            }
            await api.postForm('/api/gastos', fd);
            showToast('Gasto guardado ✓');
        }
        cerrarSheet('overlay-gasto');
        cargarGastos();
    } catch (err) {
        if (err.message === 'SIN_CONEXION' || !isOnline) {
            await guardarGastoOffline(fd);
            cerrarSheet('overlay-gasto');
            mostrarBadgePendientes();
            cargarGastos();
        } else {
            showToast(err.message, 'error');
        }
    }
    setLoading(btn, false);
}

function getLunesActual() {
    const hoy = new Date();
    // Usar fecha local del dispositivo, no UTC
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const d = hoy.getDate();
    const local = new Date(y, m, d); // medianoche local, sin UTC
    const dia = local.getDay(); // 0=Dom...6=Sáb
    const diffLunes = dia === 0 ? -6 : 1 - dia;
    local.setDate(d + diffLunes);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

// ── Resumen ──
async function cargarResumen() {
    try {
        const [data, semanal] = await Promise.all([
            api.get(`/api/obras/${obra.id}/resumen`),
            api.get(`/api/obras/${obra.id}/semanal?lunes=${getLunesActual()}`)
        ]);
        renderSemanal(semanal);
        const t = data.totales;
        document.getElementById('res-total').textContent = formatMoney(t.total_gastado);
        document.getElementById('res-cantidad').textContent = t.cantidad_gastos;
        // Mostrar disponible si hay ingresos
        if (t.total_ingresos > 0) {
            document.getElementById('res-total').innerHTML =
                formatMoney(t.total_gastado) +
                `<div style="font-size:.75rem;color:var(--verde);margin-top:4px">Capital: ${formatMoney(t.total_ingresos)}</div>` +
                `<div style="font-size:.75rem;color:${t.total_ingresos >= t.total_gastado ? 'var(--verde)' : 'var(--rojo)'};font-weight:700">Disp: ${formatMoney(t.total_ingresos - t.total_gastado)}</div>`;
        }

        if (data.obra.presupuesto > 0) {
            document.getElementById('card-presupuesto').style.display = 'block';
            const porc = Math.round((t.total_gastado / data.obra.presupuesto) * 100);
            document.getElementById('res-porc').textContent = porc + '%';
            document.getElementById('res-gastado').textContent = formatMoney(t.total_gastado);
            document.getElementById('res-presup').textContent = formatMoney(data.obra.presupuesto);
            const barra = document.getElementById('res-barra');
            barra.style.width = Math.min(porc, 100) + '%';
            barra.className = 'presupuesto-fill' + (porc > 100 ? ' danger' : porc > 80 ? ' warn' : '');
        }

        // Gráfica por categoría
        const maxVal = Math.max(...data.por_categoria.map(c => c.total), 1);
        document.getElementById('grafica-cats').innerHTML = data.por_categoria.length ?
            data.por_categoria.map(c => `
            <div class="bar-row">
              <div class="bar-label">${c.nombre}${c.tipo === 'ingreso' ? ' ↑' : ''}</div>
              <div class="bar-track">
                <div class="bar-fill" style="background:${c.color};width:${Math.round((c.total / maxVal) * 100)}%">
                </div>
              </div>
              <div class="bar-monto">${formatMoney(c.total)}</div>
            </div>
          `).join('') : '<div class="text-2">Sin datos</div>';

        // Top gastos — pedir ordenados por monto directamente
        const gastosSorted = await api.get(`/api/gastos?obra_id=${obra.id}&limit=100`);
        // Deduplicar por id y tomar los 5 mayores
        const unicos = Object.values(gastosSorted.gastos.reduce((acc, g) => { acc[g.id] = g; return acc; }, {}));
        const topSorted = unicos
            .filter(g => !g.categorias?.some(c => c.tipo === 'ingreso'))
            .sort((a, b) => b.monto - a.monto).slice(0, 5);
        document.getElementById('top-gastos').innerHTML = topSorted.map(g => `
          <div class="gasto-item">
            <div class="gasto-cat-dot" style="background:${g.categoria_color || '#aeaeb2'}"></div>
            <div class="gasto-info">
              <div class="gasto-desc">${g._pendiente ? '💾 ' : ''}${g.descripcion}</div>
              <div class="gasto-meta">${formatDate(g.fecha)}</div>
            </div>
            <div class="gasto-monto">${formatMoney(g.monto)}</div>
          </div>
        `).join('');
    } catch (err) {
        showToast('Error cargando resumen', 'error');
    }
}

function getDiaSemana(indiceLunes) {
    const lunesStr = getLunesActual();
    const [y, m, d] = lunesStr.split('-').map(Number);
    const lunes = new Date(y, m - 1, d); // sin zona horaria
    lunes.setDate(lunes.getDate() + indiceLunes);
    return lunes.getDate();
}

// ── Resumen semanal ──
function renderSemanal(s) {
    const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const hoy = new Date().getDay(); // 0=Dom...6=Sáb
    const diaIdx = hoy === 0 ? 6 : hoy - 1; // convertir a Lun=0

    const diffSemana = s.semana_anterior > 0
        ? Math.round(((s.semana_actual - s.semana_anterior) / s.semana_anterior) * 100)
        : null;
    const diffMes = s.mes_anterior > 0
        ? Math.round(((s.mes_actual - s.mes_anterior) / s.mes_anterior) * 100)
        : null;

    const flechaSemana = diffSemana === null ? '' : diffSemana > 0
        ? `<span style="color:var(--rojo);font-size:.75rem;font-weight:700">▲ ${diffSemana}%</span>`
        : diffSemana < 0
            ? `<span style="color:var(--verde);font-size:.75rem;font-weight:700">▼ ${Math.abs(diffSemana)}%</span>`
            : `<span style="color:var(--texto-3);font-size:.75rem">= igual</span>`;

    const flechaMes = diffMes === null ? '' : diffMes > 0
        ? `<span style="color:var(--rojo);font-size:.75rem;font-weight:700">▲ ${diffMes}%</span>`
        : diffMes < 0
            ? `<span style="color:var(--verde);font-size:.75rem;font-weight:700">▼ ${Math.abs(diffMes)}%</span>`
            : `<span style="color:var(--texto-3);font-size:.75rem">= igual</span>`;

    // Barra de días
    const maxDia = Math.max(...s.dias_semana, 1);
    const barrasDias = DIAS.map((nombre, i) => {
        const val = s.dias_semana[i] || 0;
        const alto = Math.round((val / maxDia) * 48);
        const esHoy = i === diaIdx;
        return `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
            <div style="font-size:.65rem;color:${val > 0 ? 'var(--texto)' : 'var(--texto-3)'};font-weight:${esHoy ? '700' : '400'}">${val > 0 ? formatMoney(val).replace('$', '').trim() : ''}</div>
            <div style="height:48px;display:flex;align-items:flex-end">
              <div style="width:100%;min-height:3px;height:${Math.max(alto, val > 0 ? 4 : 2)}px;background:${esHoy ? 'var(--amarillo)' : 'var(--gris-3)'};border-radius:4px 4px 0 0;min-width:10px;transition:height .4s"></div>
            </div>
            <div style="font-size:.7rem;color:${esHoy ? 'var(--amarillo)' : 'var(--texto-2)'};font-weight:${esHoy ? '700' : '400'};text-align:center;line-height:1.3">
              ${nombre}<br>
              <span style="font-size:.65rem;color:${esHoy ? 'var(--amarillo)' : 'var(--texto-3)'}">${getDiaSemana(i)}</span>
            </div>
          </div>
        `;
    }).join('');

    document.getElementById('semanal-contenido').innerHTML = `
        <!-- Comparativo semana -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
          <div class="stat-card">
            <div class="stat-label">Esta semana</div>
            <div class="stat-valor grande">${formatMoney(s.semana_actual)}</div>
            <div style="margin-top:4px">${flechaSemana}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Semana pasada</div>
            <div class="stat-valor grande" style="color:var(--texto-2)">${formatMoney(s.semana_anterior)}</div>
          </div>
        </div>

        <!-- Barra de días -->
        <div style="display:flex;gap:4px;align-items:flex-end;margin-bottom:16px;padding:8px 0">
          ${barrasDias}
        </div>

        <!-- Separador -->
        <div style="height:1px;background:var(--gris-linea);margin-bottom:14px"></div>

        <!-- Comparativo mes -->
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div class="stat-label">Este mes</div>
            <div class="fw-700" style="font-size:1rem">${formatMoney(s.mes_actual)}</div>
          </div>
          <div style="text-align:center">${flechaMes}</div>
          <div style="text-align:right">
            <div class="stat-label">Mes anterior</div>
            <div style="font-size:.9rem;color:var(--texto-2);font-weight:600">${formatMoney(s.mes_anterior)}</div>
          </div>
        </div>
      `;
}

// ── Equipo ──
async function cargarColaboradores() {
    const colabs = await api.get(`/api/obras/${obra.id}/colaboradores`);
    document.getElementById('colaboradores-lista').innerHTML = colabs.map(c => `
        <div class="colab-item">
          <div class="colab-avatar">${c.nombre.charAt(0).toUpperCase()}</div>
          <div style="flex:1">
            <div class="fw-700" style="font-size:.9rem">${c.nombre}</div>
            <div class="text-2">${c.email}</div>
          </div>
          <span class="badge-rol badge-${c.rol}">${c.rol}</span>
        </div>
      `).join('');
}

function abrirInvitar() {
    document.getElementById('inv-email').value = '';
    document.getElementById('overlay-invitar').classList.add('open');
}

async function invitar() {
    const btn = document.getElementById('btn-invitar');
    setLoading(btn, true);
    try {
        await api.post('/api/auth/invitar', {
            email: document.getElementById('inv-email').value.trim(),
            obra_id: obra.id,
            rol: document.getElementById('inv-rol').value
        });
        showToast('Colaborador agregado ✓');
        cerrarSheet('overlay-invitar');
        cargarColaboradores();
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

// ── Categorías ──
function renderCategorias() {
    document.getElementById('cats-lista').innerHTML = categorias.map(c => `
        <div class="row" style="padding:8px 0;border-bottom:1px solid var(--gris-linea);gap:8px">
          <div style="width:14px;height:14px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
          <div style="flex:1;font-size:.9rem;font-weight:500">${c.nombre}</div>
          ${c.tipo === 'ingreso' ? '<span style="font-size:.68rem;font-weight:700;color:var(--verde);background:#f0fdf4;padding:2px 6px;border-radius:10px">Ingreso</span>' : ''}
          ${c.es_global ? '<span class="text-2" style="font-size:.72rem">Global</span>' : ''}
          <button onclick="abrirEditarCategoria(${c.id})" style="width:28px;height:28px;background:var(--gris-bg);border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.8rem">✏️</button>
          ${!c.es_global ? `<button onclick="pedirEliminarCategoria(${c.id},'${c.nombre.replace(/'/g,"\\'")}' )" style="width:28px;height:28px;background:#fff0ef;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.8rem">🗑️</button>` : ''}
        </div>
    `).join('');
}

function abrirNuevaCat() {
    document.getElementById('overlay-cat').classList.add('open');
}

async function crearCategoria() {
    const nombre = document.getElementById('cat-nombre').value.trim();
    if (!nombre) return showToast('Escribe un nombre', 'error');
    try {
        await api.post('/api/gastos/categorias', {
            nombre,
            color: document.getElementById('cat-color').value,
            obra_id: obra.id
        });
        showToast('Categoría creada ✓');
        cerrarSheet('overlay-cat');
        await cargarCategorias();
        renderCategorias();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Editar obra ──
function abrirEditarObra() {
    document.getElementById('eo-nombre').value = obra.nombre;
    document.getElementById('eo-desc').value = obra.descripcion || '';
    document.getElementById('eo-ubic').value = obra.ubicacion || '';
    document.getElementById('eo-presup').value = obra.presupuesto || '';
    const pv = obra.presupuesto ? Math.round(parseFloat(obra.presupuesto)) : '';
    document.getElementById('eo-presup-display').value = pv ? pv.toLocaleString('es-CO').replace(/,/g, '.') : '';
    document.getElementById('eo-presup').value = pv || '';
    document.getElementById('overlay-edit-obra').classList.add('open');
}

async function actualizarObra(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-act-obra');
    setLoading(btn, true);
    try {
        await api.put(`/api/obras/${obra.id}`, {
            nombre: document.getElementById('eo-nombre').value.trim(),
            descripcion: document.getElementById('eo-desc').value.trim(),
            ubicacion: document.getElementById('eo-ubic').value.trim(),
            presupuesto: parseFloat(document.getElementById('eo-presup').value) || 0,
            activa: 1
        });
        obra.nombre = document.getElementById('eo-nombre').value.trim();
        obra.descripcion = document.getElementById('eo-desc').value.trim();
        obra.ubicacion = document.getElementById('eo-ubic').value.trim();
        obra.presupuesto = parseFloat(document.getElementById('eo-presup').value) || 0;
        localStorage.setItem('og_obra', JSON.stringify(obra));
        document.getElementById('header-obra-nombre').textContent = obra.nombre;
        // Refrescar los campos del form por si se vuelve a abrir
        document.getElementById('eo-presup-display').value = obra.presupuesto
            ? parseInt(obra.presupuesto).toLocaleString('es-CO').replace(/,/g, '.')
            : '';
        showToast('Obra actualizada ✓');
        cerrarSheet('overlay-edit-obra');
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

// ── Exportar CSV ──
async function exportarCSV() {
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;
    let url = `${API_URL}/api/gastos/exportar?obra_id=${obra.id}`;
    if (desde) url += `&fecha_desde=${desde}`;
    if (hasta) url += `&fecha_hasta=${hasta}`;

    const link = document.createElement('a');
    link.href = url + `&token=${api.token()}`;
    // Para que funcione la descarga con auth, hacer fetch manual
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${api.token()}` } });
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        link.href = blobUrl;
        link.download = `gastos-${obra.nombre.replace(/\s+/g, '-')}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        showToast('Exportando CSV…');
    } catch (err) {
        showToast('Error al exportar', 'error');
    }
}

// ── Selector múltiple de categorías ──
let catsSeleccionadas = [];

function renderSelectorCategorias(seleccionadas) {
    catsSeleccionadas = seleccionadas.map(Number);
    const wrap = document.getElementById('g-categorias-wrap');
    if (!wrap) return;
    wrap.innerHTML = categorias.map(c => {
        const activa = catsSeleccionadas.includes(c.id);
        return `<div onclick="toggleCategoria(${c.id})" style="
          padding:5px 12px;border-radius:20px;font-size:.8rem;font-weight:600;cursor:pointer;
          transition:all .15s;user-select:none;
          background:${activa ? c.color : 'var(--gris-bg)'};
          color:${activa ? '#fff' : 'var(--texto-2)'};
          border:2px solid ${activa ? c.color : 'transparent'};
        ">${c.nombre}</div>`;
    }).join('');
}

function toggleCategoria(id) {
    const idx = catsSeleccionadas.indexOf(id);
    if (idx === -1) catsSeleccionadas.push(id);
    else catsSeleccionadas.splice(idx, 1);
    renderSelectorCategorias(catsSeleccionadas);
}

// ── Calcular monto automático ──
function calcularMonto() {
    const cantidad = parseFloat(document.getElementById('g-cantidad').value) || 0;
    const vunitario = parseFloat(document.getElementById('g-vunitario').value) || 0;
    if (cantidad > 0 && vunitario > 0) {
        const total = Math.round(cantidad * vunitario);
        document.getElementById('g-monto').value = total;
        document.getElementById('g-monto-display').value = total.toLocaleString('es-CO').replace(/,/g, '.');
    }
}

// ── Formato valor unitario ──
const vuDisplay = document.getElementById('g-vunitario-display');
const vuHidden = document.getElementById('g-vunitario');

vuDisplay.addEventListener('input', function () {
    const raw = this.value.replace(/\D/g, '');
    vuHidden.value = raw;
    const cursor = this.selectionStart;
    const prevLen = this.value.length;
    this.value = raw ? parseInt(raw, 10).toLocaleString('es-CO').replace(/,/g, '.') : '';
    const diff = this.value.length - prevLen;
    this.setSelectionRange(cursor + diff, cursor + diff);
    calcularMonto(); // recalcular al cambiar valor unitario
});

// ── Formato de monto mientras se escribe ──
function formatMontoInput(val) {
    // Solo dígitos
    const digits = val.replace(/\D/g, '');
    if (!digits) return '';
    // Separador de miles con punto
    return parseInt(digits, 10).toLocaleString('es-CO').replace(/,/g, '.');
}

const montoDisplay = document.getElementById('g-monto-display');
const montoHidden = document.getElementById('g-monto');

montoDisplay.addEventListener('input', function () {
    const raw = this.value.replace(/\D/g, ''); // solo números
    montoHidden.value = raw;                    // guardar valor limpio
    const cursor = this.selectionStart;
    const prevLen = this.value.length;
    this.value = raw ? parseInt(raw, 10).toLocaleString('es-CO').replace(/,/g, '.') : '';
    // Ajustar cursor para que no salte al final mientras se escribe
    const diff = this.value.length - prevLen;
    this.setSelectionRange(cursor + diff, cursor + diff);
});

montoDisplay.addEventListener('blur', function () {
    if (!montoHidden.value) this.value = '';
});

// ── Formato presupuesto (editar obra) ──
const eoDisplay = document.getElementById('eo-presup-display');
const eoHidden = document.getElementById('eo-presup');

if (eoDisplay) {
    eoDisplay.addEventListener('input', function () {
        const raw = this.value.replace(/\D/g, '');
        eoHidden.value = raw;
        const cursor = this.selectionStart;
        const prevLen = this.value.length;
        this.value = raw ? parseInt(raw, 10).toLocaleString('es-CO').replace(/,/g, '.') : '';
        const diff = this.value.length - prevLen;
        this.setSelectionRange(cursor + diff, cursor + diff);
    });
}

// ── Progreso ──
let todasLasFotos = [], etapaFiltro = '', fotoActual = null;

function fabAccion() {
    const tabActivo = document.querySelector('[id^="tab-btn-"].active')?.id;
    if (tabActivo === 'tab-btn-tareas') {
        abrirNuevaTarea();
    } else if (tabActivo === 'tab-btn-progreso') {
        document.getElementById('overlay-fab-progreso').classList.add('open');
    } else {
        abrirGasto();
    }
}

function previewProgreso(input) {
    const prev = document.getElementById('p-foto-preview');
    if (input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => { prev.src = e.target.result; prev.style.display = 'block'; };
        reader.readAsDataURL(input.files[0]);
    }
}

function seleccionarFotoProgreso(input) {
    if (!input.files[0]) return;
    // Transferir el archivo al input principal que usa guardarProgreso()
    const dt = new DataTransfer();
    dt.items.add(input.files[0]);
    document.getElementById('p-foto').files = dt.files;
    previewProgreso(input);
}

// Bitacoras
let bitacora = [];

async function cargarProgreso() {
    try {
        [todasLasFotos, bitacora] = await Promise.all([
            api.get(`/api/progreso?obra_id=${obra.id}`),
            api.get(`/api/bitacora?obra_id=${obra.id}`)
        ]);
        renderProgreso();
    } catch (err) {
        showToast('Error cargando progreso', 'error');
    }
}

function filtrarEtapa(el, etapa) {
    document.querySelectorAll('#filtros-etapa .filtro-chip').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    etapaFiltro = etapa;
    renderProgreso();
}

function renderProgreso() {
    const container = document.getElementById('progreso-timeline');
    let fotos = etapaFiltro
        ? todasLasFotos.filter(f => f.etapa === etapaFiltro)
        : todasLasFotos;

    // Juntar todas las fechas (fotos + notas)
    const fechasSet = new Set([
        ...fotos.map(f => f.fecha?.substring(0, 10)),
        ...bitacora.map(b => b.fecha?.substring(0, 10))
    ]);
    const fechas = [...fechasSet].filter(Boolean).sort((a, b) => b.localeCompare(a));

    if (!fechas.length) {
        container.innerHTML = `<div class="empty"><div class="empty-icon">📷</div><div class="empty-msg">Sin registros aún.<br>Toca + para agregar.</div></div>`;
        return;
    }

    container.innerHTML = fechas.map(fecha => {
        const fotosDia = fotos.filter(f => f.fecha?.substring(0, 10) === fecha);
        const notaDia = bitacora.find(b => b.fecha?.substring(0, 10) === fecha);

        return `
          <div style="margin-bottom:20px">
            <!-- Cabecera de fecha -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div style="width:10px;height:10px;border-radius:50%;background:var(--amarillo);flex-shrink:0"></div>
              <div class="fw-700" style="font-size:.9rem">${formatDate(fecha)}</div>
              <div style="flex:1;height:1px;background:var(--gris-linea)"></div>
              ${fotosDia.length ? `<div class="text-2" style="font-size:.75rem">${fotosDia.length} foto${fotosDia.length > 1 ? 's' : ''}</div>` : ''}
              <button onclick="abrirNotaDia('${fecha}', ${notaDia ? notaDia.id : 'null'}, \`${(notaDia?.nota || '').replace(/`/g, '\\`')}\`)"
                style="background:${notaDia ? 'var(--gris-obra)' : 'var(--gris-bg)'};border:none;border-radius:8px;padding:4px 8px;font-size:.75rem;font-weight:600;color:${notaDia ? 'var(--amarillo)' : 'var(--texto-2)'};cursor:pointer;flex-shrink:0">
                ${notaDia ? '📝' : '+ Nota'}
              </button>
            </div>

            <!-- Nota del día -->
            ${notaDia ? `
              <div style="background:#fffbf0;border-left:3px solid var(--amarillo);border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px;position:relative">
                <div style="font-size:.85rem;line-height:1.5;white-space:pre-wrap">${notaDia.nota}</div>
                <div style="font-size:.72rem;color:var(--texto-3);margin-top:4px">✍️ ${notaDia.autor_nombre || '—'}</div>
                <button onclick="eliminarNota(${notaDia.id})" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--texto-3);font-size:.8rem;cursor:pointer">✕</button>
              </div>
            ` : ''}

            <!-- Fotos del día -->
            ${fotosDia.length ? `
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
                ${fotosDia.map(f => `
                  <div onclick="verFotoProgreso(${f.id})" style="position:relative;cursor:pointer">
                    <img src="${f.foto_url}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px">
                    ${f.etapa ? `<div style="position:absolute;bottom:4px;left:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;font-size:.6rem;font-weight:600;padding:2px 5px;border-radius:6px;text-align:center">${f.etapa}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
    }).join('');
}

// ── Carrusel ──
let carruselIndex = 0;
let carruselFotos = [];
let touchStartX = 0;

function verFotoProgreso(id) {
    // Usar las fotos filtradas actualmente visibles
    const fotosVisibles = etapaFiltro
        ? todasLasFotos.filter(f => f.etapa === etapaFiltro)
        : todasLasFotos;
    carruselFotos = fotosVisibles;
    carruselIndex = carruselFotos.findIndex(f => f.id === id);
    if (carruselIndex === -1) carruselIndex = 0;
    abrirSheet('overlay-ver-foto');
    renderCarrusel();
    iniciarSwipe();
}

function renderCarrusel() {
    const f = carruselFotos[carruselIndex];
    if (!f) return;
    fotoActual = f;

    document.getElementById('carrusel-img').src = f.foto_url;
    document.getElementById('carrusel-contador').textContent = `${carruselIndex + 1} / ${carruselFotos.length}`;
    document.getElementById('carrusel-fecha').textContent = formatDate(f.fecha);
    document.getElementById('carrusel-etapa').textContent = f.etapa || 'Sin etapa';
    document.getElementById('carrusel-usuario').textContent = `📷 ${f.usuario_nombre || '—'}`;

    // Flechas
    document.getElementById('carrusel-prev').style.display = carruselFotos.length > 1 ? 'flex' : 'none';
    document.getElementById('carrusel-next').style.display = carruselFotos.length > 1 ? 'flex' : 'none';
    document.getElementById('carrusel-prev').style.opacity = carruselIndex === 0 ? '0.3' : '1';
    document.getElementById('carrusel-next').style.opacity = carruselIndex === carruselFotos.length - 1 ? '0.3' : '1';

    // Thumbnails
    document.getElementById('carrusel-thumbs').innerHTML = carruselFotos.map((f2, i) => `
        <img onclick="carruselIrA(${i})" src="${f2.foto_url}"
          style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;cursor:pointer;
                 border:2px solid ${i === carruselIndex ? 'var(--amarillo)' : 'transparent'};
                 opacity:${i === carruselIndex ? '1' : '0.5'};transition:all .2s">
      `).join('');

    // Scroll thumbnail activo a la vista
    setTimeout(() => {
        const thumbs = document.getElementById('carrusel-thumbs');
        const active = thumbs.children[carruselIndex];
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 50);
}

function carruselNavegar(dir) {
    const nuevo = carruselIndex + dir;
    if (nuevo >= 0 && nuevo < carruselFotos.length) {
        carruselIndex = nuevo;
        renderCarrusel();
    }
}

function carruselIrA(i) {
    carruselIndex = i;
    renderCarrusel();
}

function iniciarSwipe() {
    const img = document.getElementById('carrusel-img');
    img.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    img.addEventListener('touchend', e => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) carruselNavegar(diff > 0 ? 1 : -1);
    }, { passive: true });
}

function editarFotoProgreso() {
    guardarEdicionFoto
    document.getElementById('editar-foto-id').value = fotoActual.id;
    document.getElementById('editar-foto-fecha').value = fotoActual.fecha?.substring(0, 10) || '';
    document.getElementById('editar-foto-etapa').value = fotoActual.etapa || '';
    abrirSheet('overlay-editar-foto');
}

async function guardarEdicionFoto() {
    const btn = document.getElementById('btn-guardar-editar-foto');
    setLoading(btn, true);
    try {
        await api.put(`/api/progreso/${fotoActual.id}`, {
            fecha: document.getElementById('editar-foto-fecha').value,
            etapa: document.getElementById('editar-foto-etapa').value
        });
        cerrarSheet('overlay-editar-foto');
        showToast('Foto actualizada ✓');
        await cargarProgreso();
        // Actualizar carrusel con datos nuevos
        const fotosActualizadas = etapaFiltro ? todasLasFotos.filter(f => f.etapa === etapaFiltro) : todasLasFotos;
        carruselFotos = fotosActualizadas;
        fotoActual = carruselFotos[carruselIndex];
        renderCarrusel();
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

async function guardarProgreso() {
    const btn = document.getElementById('btn-guardar-progreso');
    const file = document.getElementById('p-foto').files[0];
    if (!file) return showToast('Selecciona una foto', 'error');
    setLoading(btn, true);
    try {
        const fd = new FormData();
        fd.append('foto', file);
        fd.append('obra_id', obra.id);
        fd.append('fecha', document.getElementById('p-fecha').value || todayISO());
        fd.append('etapa', document.getElementById('p-etapa').value);
        await api.postForm('/api/progreso', fd);
        cerrarSheet('overlay-progreso');
        showToast('Foto guardada ✓');
        await cargarProgreso();
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

function eliminarFotoProgreso() {
    cerrarSheet('overlay-ver-foto');
    setTimeout(() => abrirSheet('overlay-confirmar-foto'), 200);
}

async function confirmarEliminarFoto() {
    try {
        await api.delete(`/api/progreso/${fotoActual.id}`);
        cerrarSheet('overlay-confirmar-foto');
        showToast('Foto eliminada');
        await cargarProgreso();
        // Si quedan fotos, seguir mostrando carrusel
        if (todasLasFotos.length > 0) {
            const fotosActualizadas = etapaFiltro ? todasLasFotos.filter(f => f.etapa === etapaFiltro) : todasLasFotos;
            if (fotosActualizadas.length > 0) {
                carruselFotos = fotosActualizadas;
                carruselIndex = Math.min(carruselIndex, carruselFotos.length - 1);
                abrirSheet('overlay-ver-foto');
                renderCarrusel();
            }
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Tareas ──
let todasLasTareas = [], estadoFiltro = '', tareaActual = null;

const ESTADO_CONFIG = {
    pendiente: { label: 'Pendiente', color: 'var(--rojo)', emoji: '🔴', next: 'en_progreso' },
    en_progreso: { label: 'En progreso', color: 'var(--amarillo)', emoji: '🟡', next: 'hecho' },
    hecho: { label: 'Hecho', color: 'var(--verde)', emoji: '🟢', next: 'pendiente' }
};

async function cargarTareas() {
    try {
        if (!isOnline) {
            const cached = await obtenerTareasCache(obra.id);
            const pendientes = await dbGetAll('tareas_pendientes', 'obra_id', obra.id);
            todasLasTareas = [...pendientes.map(p => ({ ...p, _pendiente: true })), ...cached];
            renderTareas();
            return;
        }
        todasLasTareas = await api.get(`/api/tareas?obra_id=${obra.id}`);
        cachearTareas(todasLasTareas);
        renderTareas();
    } catch (err) {
        showToast('Error cargando tareas', 'error');
    }
}

function filtrarTareas(el, estado) {
    document.querySelectorAll('#filtros-estado .filtro-chip').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    estadoFiltro = estado;
    renderTareas();
}

function renderTareas() {
    const container = document.getElementById('tareas-lista');

    // Solo mostrar pendientes y en progreso en la vista principal
    const activas = estadoFiltro
        ? todasLasTareas.filter(t => t.estado === estadoFiltro && t.estado !== 'hecho')
        : todasLasTareas.filter(t => t.estado !== 'hecho');

    const hechas = todasLasTareas.filter(t => t.estado === 'hecho');

    // Badge
    const badge = document.getElementById('badge-tareas');
    const nActivas = todasLasTareas.filter(t => t.estado !== 'hecho').length;
    if (nActivas > 0) { badge.textContent = nActivas; badge.style.display = 'inline'; }
    else badge.style.display = 'none';

    // Contador
    const pendientes = todasLasTareas.filter(t => t.estado === 'pendiente').length;
    const enProgreso = todasLasTareas.filter(t => t.estado === 'en_progreso').length;

    // Botón historial
    const btnHistorial = document.getElementById('btn-historial');
    if (hechas.length > 0) {
        btnHistorial.style.display = 'block';
        btnHistorial.textContent = `📋 Historial de completadas (${hechas.length})`;
    } else {
        btnHistorial.style.display = 'none';
    }

    if (!activas.length) {
        container.innerHTML = `
          <div class="stats-row" style="margin-bottom:12px">
            <div class="stat-card" style="text-align:center;padding:10px">
              <div style="font-size:1.1rem;font-weight:700;color:var(--rojo)">${pendientes}</div>
              <div class="stat-label">Pendiente</div>
            </div>
            <div class="stat-card" style="text-align:center;padding:10px">
              <div style="font-size:1.1rem;font-weight:700;color:var(--amarillo)">${enProgreso}</div>
              <div class="stat-label">En progreso</div>
            </div>
          </div>
          <div class="empty"><div class="empty-icon">✅</div>
          <div class="empty-msg">${hechas.length ? '¡Todo completado!' : 'Sin tareas. Toca + para agregar.'}</div></div>`;
        return;
    }

    container.innerHTML = `
        <div class="stats-row" style="margin-bottom:12px">
          <div class="stat-card" style="text-align:center;padding:10px">
            <div style="font-size:1.1rem;font-weight:700;color:var(--rojo)">${pendientes}</div>
            <div class="stat-label">Pendiente</div>
          </div>
          <div class="stat-card" style="text-align:center;padding:10px">
            <div style="font-size:1.1rem;font-weight:700;color:var(--amarillo)">${enProgreso}</div>
            <div class="stat-label">En progreso</div>
          </div>
        </div>
        ${activas.map(t => {
        const cfg = ESTADO_CONFIG[t.estado];
        const vencida = t.fecha_limite && new Date(t.fecha_limite) < new Date();
        return `
            <div class="card" style="margin-bottom:8px;padding:12px 14px">
              <div class="row-between" style="align-items:flex-start;gap:8px">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:.95rem">${t.titulo}</div>
                  ${t.descripcion ? `<div class="text-2" style="margin-top:3px">${t.descripcion}</div>` : ''}
                  <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap">
                    <span style="font-size:.72rem;font-weight:700;color:${cfg.color}">${cfg.emoji} ${cfg.label}</span>
                    ${t.fecha_limite ? `<span style="font-size:.72rem;color:${vencida ? 'var(--rojo)' : 'var(--texto-2)'};font-weight:${vencida ? '700' : '400'}">${vencida ? '⚠️ Vencida: ' : '📅 '}${formatDate(t.fecha_limite)}</span>` : ''}
                    <span style="font-size:.72rem;color:var(--texto-3)">Por: ${t.creador_nombre || '—'}</span>
                  </div>
                </div>
                <div class="row" style="gap:6px;flex-shrink:0">
                  <button onclick="cambiarEstadoTarea(${t.id},'${cfg.next}')"
                    style="background:${cfg.color};color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:.75rem;font-weight:600;cursor:pointer;white-space:nowrap">
                    ${cfg.next === 'en_progreso' ? '▶ Iniciar' : '✓ Listo'}
                  </button>
                  <button onclick="verHistorialTarea(${t.id})" style="width:28px;height:28px;padding:4px;background:var(--gris-bg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0" title="Ver historial">
                    🕐
                  </button>
                  <button onclick="abrirEditarTarea(${t.id})" style="width:28px;height:28px;padding:4px;background:var(--gris-bg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <img src="./assets/icons/ed.svg" alt="Editar" style="width:14px;height:14px">
                  </button>
                  <button onclick="pedirEliminarTarea(${t.id})" style="width:28px;height:28px;padding:4px;background:var(--gris-bg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <img src="./assets/icons/trash.svg" alt="Eliminar" style="width:14px;height:14px">
                  </button>
                </div>
              </div>
            </div>`;
    }).join('')}`;

    // Renderizar historial si está visible
    if (document.getElementById('tareas-historial').style.display !== 'none') {
        renderHistorial(hechas);
    }
}

function renderHistorial(hechas) {
    document.getElementById('historial-lista').innerHTML = hechas.map(t => `
        <div class="card" style="margin-bottom:8px;padding:12px 14px;opacity:.65">
          <div class="row-between" style="align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.9rem;text-decoration:line-through">${t.titulo}</div>
              ${t.descripcion ? `<div class="text-2" style="margin-top:2px">${t.descripcion}</div>` : ''}
              <div class="row" style="gap:8px;margin-top:4px;flex-wrap:wrap">
                <span style="font-size:.72rem;color:var(--verde);font-weight:700">🟢 Completada</span>
                ${t.completado_en ? `<span style="font-size:.72rem;color:var(--texto-3)">${formatDate(t.completado_en)}</span>` : ''}
                ${t.completado_por_nombre ? `<span style="font-size:.72rem;color:var(--texto-3)">por ${t.completado_por_nombre}</span>` : ''}
              </div>
            </div>
            <button onclick="cambiarEstadoTarea(${t.id},'pendiente')"
              style="background:var(--gris-bg);color:var(--texto);border:none;border-radius:8px;padding:6px 10px;font-size:.75rem;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">
              ↩ Reabrir
            </button>
          </div>
        </div>
      `).join('') || '<div class="text-2" style="padding:12px 0">Sin tareas completadas aún.</div>';
}

function toggleHistorial() {
    const wrap = document.getElementById('tareas-historial');
    const btn = document.getElementById('btn-historial');
    const visible = wrap.style.display !== 'none';
    wrap.style.display = visible ? 'none' : 'block';
    const hechas = todasLasTareas.filter(t => t.estado === 'hecho');
    btn.textContent = visible
        ? `📋 Historial de completadas (${hechas.length})`
        : `🔼 Ocultar historial`;
    if (!visible) renderHistorial(hechas);
}

function abrirNuevaTarea() {
    document.getElementById('tarea-sheet-title').textContent = 'Nueva tarea';
    document.getElementById('tarea-edit-id').value = '';
    document.getElementById('t-titulo').value = '';
    document.getElementById('t-desc').value = '';
    document.getElementById('t-fecha').value = '';
    abrirSheet('overlay-tarea');
}

function abrirEditarTarea(id) {
    tareaActual = todasLasTareas.find(t => t.id === id);
    document.getElementById('tarea-sheet-title').textContent = 'Editar tarea';
    document.getElementById('tarea-edit-id').value = tareaActual.id;
    document.getElementById('t-titulo').value = tareaActual.titulo;
    document.getElementById('t-desc').value = tareaActual.descripcion || '';
    document.getElementById('t-fecha').value = tareaActual.fecha_limite?.substring(0, 10) || '';
    abrirSheet('overlay-tarea');
}

async function guardarTarea() {
    const btn = document.getElementById('btn-guardar-tarea');
    const titulo = document.getElementById('t-titulo').value.trim();
    if (!titulo) return showToast('Escribe un título', 'error');
    const editId = document.getElementById('tarea-edit-id').value;
    setLoading(btn, true);
    try {
        const data = {
            titulo,
            descripcion: document.getElementById('t-desc').value.trim(),
            fecha_limite: document.getElementById('t-fecha').value || null,
            obra_id: obra.id
        };
        if (editId) {
            await api.put(`/api/tareas/${editId}`, data);
            showToast('Tarea actualizada ✓');
        } else {
            if (!isOnline) {
                await guardarTareaOffline(data);
                cerrarSheet('overlay-tarea');
                mostrarBadgePendientes();
                await cargarTareas();
                setLoading(btn, false);
                return;
            }
            await api.post('/api/tareas', data);
            showToast('Tarea creada ✓');
        }
        cerrarSheet('overlay-tarea');
        await cargarTareas();
    } catch (err) {
        if (!isOnline) {
            await guardarTareaOffline(data);
            cerrarSheet('overlay-tarea');
            mostrarBadgePendientes();
            await cargarTareas();
        } else {
            showToast(err.message, 'error');
        }
    }
    setLoading(btn, false);
}

async function cambiarEstadoTarea(id, nuevoEstado) {
    try {
        await api.put(`/api/tareas/${id}/estado`, { estado: nuevoEstado });
        await cargarTareas();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function pedirEliminarTarea(id) {
    tareaActual = todasLasTareas.find(t => t.id === id);
    document.getElementById('confirmar-tarea-titulo').textContent = tareaActual.titulo;
    abrirSheet('overlay-confirmar-tarea');
}

async function confirmarEliminarTarea() {
    try {
        await api.delete(`/api/tareas/${tareaActual.id}`);
        cerrarSheet('overlay-confirmar-tarea');
        showToast('Tarea eliminada');
        await cargarTareas();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Historial de tarea ──
async function verHistorialTarea(id) {
    const tarea = todasLasTareas.find(t => t.id === id);
    document.getElementById('historial-tarea-titulo').textContent = tarea?.titulo || 'Historial';
    document.getElementById('historial-tarea-contenido').innerHTML =
        '<div class="empty"><div class="empty-icon">⏳</div></div>';
    abrirSheet('overlay-historial-tarea');

    const ESTADO_LABELS = {
        pendiente: { emoji: '🔴', label: 'Pendiente' },
        en_progreso: { emoji: '🟡', label: 'En progreso' },
        hecho: { emoji: '🟢', label: 'Hecho' }
    };

    try {
        const historial = await api.get(`/api/tareas/${id}/historial`);
        if (!historial.length) {
            document.getElementById('historial-tarea-contenido').innerHTML =
                '<div class="text-2" style="padding:16px 0;text-align:center">Sin cambios de estado aún.</div>';
            return;
        }

        document.getElementById('historial-tarea-contenido').innerHTML = historial.map(h => {
            const ant = ESTADO_LABELS[h.estado_anterior] || { emoji: '⚪', label: h.estado_anterior };
            const nuevo = ESTADO_LABELS[h.estado_nuevo] || { emoji: '⚪', label: h.estado_nuevo };
            const fecha = new Date(h.cambiado_en);
            const fechaStr = fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
            const horaStr = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            return `
            <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--gris-linea)">
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">
                <div style="font-size:1rem">${nuevo.emoji}</div>
                <div style="width:1px;flex:1;background:var(--gris-linea)"></div>
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-size:.88rem;font-weight:600">
                  ${ant.emoji} ${ant.label} → ${nuevo.emoji} ${nuevo.label}
                </div>
                <div style="font-size:.78rem;color:var(--texto-2);margin-top:3px">
                  👤 ${h.usuario_nombre || '—'}
                </div>
                <div style="font-size:.75rem;color:var(--texto-3);margin-top:2px">
                  📅 ${fechaStr} · ${horaStr}
                </div>
              </div>
            </div>
          `;
        }).join('');
    } catch (err) {
        document.getElementById('historial-tarea-contenido').innerHTML =
            '<div class="text-2" style="padding:16px 0;text-align:center">Error cargando historial.</div>';
    }
}

// ── Bitácora ──
let notaEditandoId = null;
let notaEditandoFecha = null;

function abrirNotaDia(fecha, notaId, textoActual) {
    notaEditandoFecha = fecha;
    notaEditandoId = notaId;
    document.getElementById('nota-fecha-label').textContent = formatDate(fecha);
    document.getElementById('nota-texto').value = textoActual || '';
    abrirSheet('overlay-nota');
}

async function guardarNota() {
    const btn = document.getElementById('btn-guardar-nota');
    const texto = document.getElementById('nota-texto').value.trim();
    if (!texto) return showToast('Escribe algo en la nota', 'error');
    setLoading(btn, true);
    try {
        await api.post('/api/bitacora', {
            obra_id: obra.id,
            fecha: notaEditandoFecha,
            nota: texto
        });
        cerrarSheet('overlay-nota');
        showToast('Nota guardada ✓');
        await cargarProgreso();
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

async function eliminarNota(id) {
    if (!confirm('¿Eliminar esta nota?')) return;
    try {
        await api.delete(`/api/bitacora/${id}`);
        showToast('Nota eliminada');
        await cargarProgreso();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Selección múltiple ──
let longPressTimer = null;

function iniciarLongPress(id) {
    longPressTimer = setTimeout(() => {
        if (!modoSeleccion) activarModoSeleccion();
        toggleSeleccion(id);
    }, 500);
}

function cancelarLongPress() {
    clearTimeout(longPressTimer);
}

function clickGasto(id) {
    clearTimeout(longPressTimer);
    if (modoSeleccion) {
        toggleSeleccion(id);
    } else {
        verGasto(id);
    }
}

function activarModoSeleccion() {
    modoSeleccion = true;
    gastosSeleccionados = new Set();
    document.getElementById('seleccion-bar').classList.add('activa');
    document.getElementById('fab-agregar').style.display = 'none';
    document.getElementById('total-bar').style.display = 'none';
    renderGastos();
}

function cancelarSeleccion() {
    modoSeleccion = false;
    gastosSeleccionados = new Set();
    document.getElementById('seleccion-bar').classList.remove('activa');
    document.getElementById('fab-agregar').style.display = 'flex';
    document.getElementById('total-bar').style.display = 'flex';
    renderGastos();
}

function toggleSeleccion(id) {
    if (gastosSeleccionados.has(id)) {
        gastosSeleccionados.delete(id);
    } else {
        gastosSeleccionados.add(id);
    }
    // Actualizar visualmente solo la fila tocada
    const row = document.getElementById(`gasto-row-${id}`);
    if (row) {
        row.classList.toggle('seleccionado', gastosSeleccionados.has(id));
        const check = row.querySelector('.check-gasto');
        if (check) check.textContent = gastosSeleccionados.has(id) ? '✓' : '';
    }
    actualizarBarraSeleccion();
}

function seleccionarTodos() {
    const filtrados = gastos.filter(g =>
        !busqFiltro ||
        g.descripcion.toLowerCase().includes(busqFiltro) ||
        (g.proveedor || '').toLowerCase().includes(busqFiltro)
    );
    if (gastosSeleccionados.size === filtrados.length) {
        // Deseleccionar todos
        gastosSeleccionados = new Set();
    } else {
        filtrados.forEach(g => gastosSeleccionados.add(g.id));
    }
    renderGastos();
    actualizarBarraSeleccion();
}

function actualizarBarraSeleccion() {
    const n = gastosSeleccionados.size;
    document.getElementById('seleccion-count').textContent =
        `${n} seleccionado${n !== 1 ? 's' : ''}`;
}

function verSumaSeleccion() {
    if (!gastosSeleccionados.size) return showToast('No hay gastos seleccionados', 'error');
    const seleccionados = gastos.filter(g => gastosSeleccionados.has(g.id));
    const suma = seleccionados.reduce((s, g) => s + parseFloat(g.monto), 0);
    const n = seleccionados.length;
    document.getElementById('confirmar-suma-n').textContent = n;
    document.getElementById('confirmar-suma-total').textContent = formatMoney(suma);
    document.getElementById('confirmar-suma-prom').textContent = formatMoney(suma / n);
    abrirSheet('overlay-suma');
}

// -- Edicion Masiva --
function abrirEdicionMasiva() {
    if (!gastosSeleccionados.size) return showToast('No hay gastos seleccionados', 'error');
    document.getElementById('bulk-count').textContent = gastosSeleccionados.size;
    document.getElementById('bulk-campo').value = '';
    document.getElementById('bulk-valor-wrap').style.display = 'none';
    abrirSheet('overlay-edicion-masiva');
}

function mostrarCampoBulk() {
    const campo = document.getElementById('bulk-campo').value;
    const wrap = document.getElementById('bulk-valor-wrap');
    if (!campo) { wrap.style.display = 'none'; return; }

    wrap.style.display = 'block';
    if (campo === 'proveedor') {
        wrap.innerHTML = `<div class="field"><label>Proveedor</label>
          <input type="text" id="bulk-valor" placeholder="Nombre del proveedor"></div>`;
    } else if (campo === 'fecha') {
        wrap.innerHTML = `<div class="field"><label>Fecha</label>
          <input type="date" id="bulk-valor" value="${todayISO()}"></div>`;
    } else if (campo === 'notas') {
        wrap.innerHTML = `<div class="field"><label>Notas</label>
          <textarea id="bulk-valor" rows="3" placeholder="Nota para todos los gastos…"></textarea></div>`;
    } else if (campo === 'categoria_id') {
        wrap.innerHTML = `<div class="field"><label>Categoría</label>
          <select id="bulk-valor">
            <option value="">Sin categoría</option>
            ${categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
          </select></div>`;
    }
}

async function guardarEdicionMasiva() {
    const campo = document.getElementById('bulk-campo').value;
    const valor = document.getElementById('bulk-valor')?.value?.trim();
    if (!campo) return showToast('Selecciona un campo', 'error');

    const btn = document.getElementById('btn-bulk-guardar');
    setLoading(btn, true);
    try {
        const ids = [...gastosSeleccionados];
        await api.put('/api/gastos/bulk', {
            ids,
            campo,
            valor: valor || null,
            obra_id: obra.id
        });
        cerrarSheet('overlay-edicion-masiva');
        cancelarSeleccion();
        showToast(`✅ ${ids.length} gastos actualizados`);
        cargarGastos();
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

// Limpiar busqueda
function limpiarBusqueda() {
    document.getElementById('busqueda').value = '';
    document.getElementById('btn-limpiar-busqueda').style.display = 'none';
    busqFiltro = '';
    renderGastos();
}

function limpiarFecha(cual) {
    if (cual === 'desde') {
        document.getElementById('fecha-desde').value = '';
        document.getElementById('btn-limpiar-desde').style.display = 'none';
    } else {
        document.getElementById('fecha-hasta').value = '';
        document.getElementById('btn-limpiar-hasta').style.display = 'none';
    }
    cargarGastos();
}

function actualizarBtnFechas() {
    document.getElementById('btn-limpiar-desde').style.display =
        document.getElementById('fecha-desde').value ? 'block' : 'none';
    document.getElementById('btn-limpiar-hasta').style.display =
        document.getElementById('fecha-hasta').value ? 'block' : 'none';
}

// ── Editar / eliminar categoría ──
let catEditandoId = null;

function abrirEditarCategoria(id) {
    const cat = categorias.find(c => c.id === id);
    if (!cat) return;
    catEditandoId = id;
    document.getElementById('edit-cat-nombre').value = cat.nombre;
    document.getElementById('edit-cat-color').value = cat.color || '#6366f1';
    document.getElementById('edit-cat-tipo').value = cat.tipo || 'egreso';
    abrirSheet('overlay-edit-cat');
}

async function guardarEditCategoria() {
    const btn = document.getElementById('btn-guardar-edit-cat');
    const nombre = document.getElementById('edit-cat-nombre').value.trim();
    if (!nombre) return showToast('Escribe un nombre', 'error');
    setLoading(btn, true);
    try {
        await api.put(`/api/gastos/categorias/${catEditandoId}`, {
            nombre,
            color: document.getElementById('edit-cat-color').value,
            tipo: document.getElementById('edit-cat-tipo').value
        });
        showToast('Categoría actualizada ✓');
        cerrarSheet('overlay-edit-cat');
        await cargarCategorias();
        renderCategorias();
    } catch (err) {
        showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

let catAEliminarId = null;
function pedirEliminarCategoria(id, nombre) {
    catAEliminarId = id;
    document.getElementById('confirmar-cat-nombre').textContent = nombre;
    abrirSheet('overlay-confirmar-cat');
}

async function confirmarEliminarCategoria() {
    try {
        await api.delete(`/api/gastos/categorias/${catAEliminarId}`);
        cerrarSheet('overlay-confirmar-cat');
        showToast('Categoría eliminada');
        await cargarCategorias();
        renderCategorias();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Cerrar sheets al hacer clic fuera ──
document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', function (e) {
        if (e.target === this) this.classList.remove('open');
    });
});