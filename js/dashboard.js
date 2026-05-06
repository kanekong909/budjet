if (!requireAuth()) void 0;

const u = usuario();
if (u) document.getElementById('header-nombre').textContent = u.nombre;

let obras = [];

async function cargarObras() {
    try {
    obras = await api.get('/api/obras');
    renderObras();
    } catch (err) {
    showToast('Error cargando obras', 'error');
    document.getElementById('obras-lista').innerHTML = `
        <div class="empty"><div class="empty-icon">⚠️</div>
        <div class="empty-msg">No se pudo conectar al servidor</div></div>`;
    }
}

function renderObras() {
    const container = document.getElementById('obras-lista');
    if (!obras.length) {
    container.innerHTML = `
        <div class="empty">
        <div class="empty-icon">🏗️</div>
        <div class="empty-msg">Aún no tienes obras.<br>¡Crea tu primera obra!</div>
        </div>`;
    return;
    }
    container.innerHTML = obras.map(o => `
    <div class="obra-list-item" onclick="abrirObra(${o.id})">
        <div class="obra-icon">
            <img src="./assets/icons/obra-icon.svg" alt="Obra" style="width:24px;height:24px">
        </div>
        <div class="obra-info">
        <div class="obra-info-nombre">${o.nombre}</div>
        <div class="obra-info-meta">${o.ubicacion || 'Sin ubicación'} · ${o.total_gastos_count} gastos${o.tareas_pendientes > 0 ? ` · <span style="color:var(--rojo);font-weight:700">⚠️ ${o.tareas_pendientes} tarea${o.tareas_pendientes > 1 ? 's' : ''} pendiente${o.tareas_pendientes > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="obra-info-total">${formatMoney(o.total_gastado)}</div>
        </div>
        <button onclick="event.stopPropagation();pedirEliminarObra(${o.id},'${o.nombre.replace(/'/g, "\\\'")}')" 
        style="background:none;border:none;padding:8px;color:var(--texto-3);font-size:1.1rem;cursor:pointer">
            <img src="./assets/icons/trash.svg" alt="Eliminar" style="width:16px;height:16px">
        </button>
    </div>
    `).join('');
}

function abrirObra(id) {
    const obra = obras.find(o => o.id === id);
    localStorage.setItem('og_obra', JSON.stringify(obra));
    window.location.href = 'obra.html';
}

async function abrirNuevaObra() {
    // const plan = await api.get('/api/pagos/mi-plan');
    // const obras = obras.length;
    // const limite = plan.max_obras || 2;

    // if (obras >= limite) {
    //   // Mostrar mensaje de upgrade
    //   document.getElementById('overlay-upgrade').classList.add('open');
    //   return;
    // }

    document.getElementById('obra-sheet-title').textContent = 'Nueva obra';
    document.getElementById('obra-edit-id').value = '';
    document.getElementById('obra-nombre').value = '';
    document.getElementById('obra-desc').value = '';
    document.getElementById('obra-ubicacion').value = '';
    document.getElementById('obra-presupuesto').value = '';
    document.getElementById('obra-presupuesto-display').value = '';
    document.getElementById('overlay-obra').classList.add('open');
}

function cerrarSheet(id) {
    document.getElementById(id).classList.remove('open');
}

document.getElementById('overlay-obra').addEventListener('click', function (e) {
    if (e.target === this) cerrarSheet('overlay-obra');
});

async function guardarObra(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-guardar-obra');
    const editId = document.getElementById('obra-edit-id').value;
    setLoading(btn, true);
    try {
    const data = {
        nombre: document.getElementById('obra-nombre').value.trim(),
        descripcion: document.getElementById('obra-desc').value.trim(),
        ubicacion: document.getElementById('obra-ubicacion').value.trim(),
        presupuesto: parseFloat(document.getElementById('obra-presupuesto').value) || 0
    };
    if (editId) {
        await api.put(`/api/obras/${editId}`, data);
        showToast('Obra actualizada ✓');
    } else {
        await api.post('/api/obras', data);
        showToast('Obra creada ✓');
    }
    cerrarSheet('overlay-obra');
    await cargarObras();
    } catch (err) {
    showToast(err.message, 'error');
    }
    setLoading(btn, false);
}

cargarObras();

// ── Formato presupuesto ──
const presupDisplay = document.getElementById('obra-presupuesto-display');
const presupHidden = document.getElementById('obra-presupuesto');
presupDisplay.addEventListener('input', function () {
    const raw = this.value.replace(/\D/g, '');
    presupHidden.value = raw;
    const cursor = this.selectionStart;
    const prevLen = this.value.length;
    this.value = raw ? parseInt(raw, 10).toLocaleString('es-CO').replace(/,/g, '.') : '';
    const diff = this.value.length - prevLen;
    this.setSelectionRange(cursor + diff, cursor + diff);
});

let obraAEliminarId = null;

function pedirEliminarObra(id, nombre) {
    obraAEliminarId = id;
    document.getElementById('confirmar-obra-nombre').textContent = nombre;
    document.getElementById('overlay-confirmar-obra').classList.add('open');
}

async function confirmarEliminarObra() {
    const btn = document.getElementById('btn-confirmar-eliminar-obra');
    setLoading(btn, true);
    try {
    await api.delete(`/api/obras/${obraAEliminarId}`);
    cerrarSheet('overlay-confirmar-obra');
    showToast('Obra eliminada');
    await cargarObras();
    } catch (err) {
    showToast(err.message, 'error');
    }
    setLoading(btn, false);
}