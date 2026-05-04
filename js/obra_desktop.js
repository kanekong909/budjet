// ═══════════════════════════════════════════════════════
// OBRA_DESKTOP.JS — Lógica de sincronización desktop
// Agrega esto al final de obra.js o en un script separado
// ═══════════════════════════════════════════════════════

const esDesktop = () => window.innerWidth >= 768;

// ── Inicializar sidebar con datos de la obra ──
function initSidebar() {
  if (!esDesktop()) return;
  const o = obra;
  const nombreEl = document.getElementById('sidebar-obra-nombre');
  const ubicEl = document.getElementById('sidebar-obra-ubicacion');
  if (nombreEl) nombreEl.textContent = o.nombre;
  if (ubicEl) ubicEl.textContent = o.ubicacion || 'Sin ubicación';
  // NO tocar display — el CSS con media query lo maneja
}

// ── Sincronizar tabs sidebar con tabs móvil ──
function sincronizarSidebarTab(tab) {
  if (!esDesktop()) return;

  // Nav items sidebar
  ['gastos','resumen','equipo','progreso','tareas'].forEach(t => {
    document.getElementById(`snav-${t}`)?.classList.toggle('active', t === tab);
  });

  // Tabs desktop
  ['gastos','resumen','equipo','progreso','tareas'].forEach(t => {
    const el = document.getElementById(`dtab-${t}`);
    if (el) el.style.display = t === tab ? (t === 'gastos' ? 'grid' : 'block') : 'none';
  });

  // Topbar título
  const titulos = { gastos:'Gastos', resumen:'Resumen', equipo:'Equipo', progreso:'Progreso', tareas:'Tareas' };
  const el = document.getElementById('topbar-tab-titulo');
  if (el) el.textContent = titulos[tab] || tab;

  // Botones topbar según tab
  const btnAgregar = document.getElementById('topbar-btn-agregar');
  const btnExport = document.getElementById('topbar-btn-export');
  const totalWrap = document.getElementById('desktop-total-wrap');

  if (btnAgregar) {
    if (tab === 'gastos') { btnAgregar.textContent = '+ Agregar gasto'; btnAgregar.onclick = () => abrirGasto(); btnAgregar.style.display = ''; }
    else if (tab === 'tareas') { btnAgregar.textContent = '+ Nueva tarea'; btnAgregar.onclick = () => abrirNuevaTarea(); btnAgregar.style.display = ''; }
    else if (tab === 'progreso') { btnAgregar.textContent = '📷 Foto'; btnAgregar.onclick = () => { document.getElementById('p-fecha').value = todayISO(); abrirSheet('overlay-progreso'); }; btnAgregar.style.display = ''; }
    else btnAgregar.style.display = 'none';
  }
  if (btnExport) btnExport.style.display = tab === 'gastos' ? '' : 'none';
  if (totalWrap) totalWrap.style.display = tab === 'gastos' ? '' : 'none';
}

// ── Actualizar total en topbar desktop ──
function actualizarTotalDesktop(suma, sumaIngresos) {
  if (!esDesktop()) return;
  const montoEl = document.getElementById('desktop-total-monto');
  const dispWrap = document.getElementById('desktop-disponible-wrap');
  const dispEl = document.getElementById('desktop-disponible');
  if (montoEl) montoEl.textContent = formatMoney(suma);
  if (sumaIngresos > 0 && dispWrap && dispEl) {
    dispWrap.style.display = '';
    dispEl.textContent = formatMoney(sumaIngresos - suma);
    dispEl.style.color = sumaIngresos >= suma ? 'var(--verde)' : 'var(--rojo)';
  } else if (dispWrap) {
    dispWrap.style.display = 'none';
  }
}

// ── Renderizar gastos en desktop ──
function renderGastosDesktop(gastosData) {
  if (!esDesktop()) return;
  const lista = document.getElementById('gastos-lista-d');
  if (!lista) return;

  let filtrados = gastosData;
  const busq = document.getElementById('busqueda-d')?.value?.toLowerCase() || '';
  if (busq) {
    filtrados = gastosData.filter(g =>
      g.descripcion.toLowerCase().includes(busq) ||
      (g.proveedor || '').toLowerCase().includes(busq)
    );
  }

  if (!filtrados.length) {
    lista.innerHTML = `<div class="empty" style="padding:40px"><div class="empty-icon">📋</div><div class="empty-msg">Sin gastos</div></div>`;
    return;
  }

  lista.innerHTML = filtrados.map(g => `
    <div class="gasto-item${gastosSeleccionados?.has(g.id) ? ' seleccionado' : ''}"
      id="gasto-row-d-${g.id}"
      onclick="clickGasto(${g.id})"
      onmousedown="iniciarLongPress(${g.id})"
      onmouseup="cancelarLongPress()"
      onmouseleave="cancelarLongPress()">
      <div class="check-gasto">${gastosSeleccionados?.has(g.id) ? '✓' : ''}</div>
      <div class="gasto-cat-dot" style="background:${g.categorias?.[0]?.color || '#aeaeb2'}"></div>
      <div class="gasto-info">
        <div class="gasto-desc">${g._pendiente ? '💾 ' : ''}${g.descripcion}</div>
        <div class="gasto-meta">${formatDate(g.fecha)} · ${g.categorias?.map(c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};margin-right:2px"></span>${c.nombre}`).join(', ') || 'Sin cat.'} ${g.proveedor ? '· ' + g.proveedor : ''}</div>
      </div>
      ${g.foto_url ? '<span class="gasto-foto">📷</span>' : ''}
      <div class="gasto-monto">${formatMoney(g.monto)}</div>
    </div>
  `).join('');
}

// ── Filtros categorías desktop ──
function renderFiltrosCatsDesktop() {
  if (!esDesktop()) return;
  const wrap = document.getElementById('filtros-cat-d');
  if (!wrap) return;
  wrap.innerHTML = `<div class="filtro-chip active" data-cat="" onclick="filtrarCategoriaD(this,'')">Todos</div>` +
    categorias.map(c => `<div class="filtro-chip" data-cat="${c.id}" onclick="filtrarCategoriaD(this,'${c.id}')" style="border-left:3px solid ${c.color}">${c.nombre}</div>`).join('');
}

function filtrarCategoriaD(el, catId) {
  document.querySelectorAll('#filtros-cat-d .filtro-chip').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  catFiltro = catId;
  paginaActual = 1;
  cargarGastos();
}

// ── Búsqueda desktop ──
function filtrarBusquedaD() {
  const val = document.getElementById('busqueda-d').value.toLowerCase();
  busqFiltro = val;
  document.getElementById('btn-limpiar-busqueda-d').style.display = val ? 'block' : 'none';
  renderGastos();
}
function limpiarBusquedaD() {
  document.getElementById('busqueda-d').value = '';
  document.getElementById('btn-limpiar-busqueda-d').style.display = 'none';
  busqFiltro = '';
  renderGastos();
}
function limpiarFechaD(cual) {
  if (cual === 'desde') { document.getElementById('fecha-desde-d').value = ''; document.getElementById('btn-limpiar-desde-d').style.display = 'none'; }
  else { document.getElementById('fecha-hasta-d').value = ''; document.getElementById('btn-limpiar-hasta-d').style.display = 'none'; }
  cargarGastos();
}
function actualizarBtnFechasD() {
  document.getElementById('btn-limpiar-desde-d').style.display = document.getElementById('fecha-desde-d').value ? 'block' : 'none';
  document.getElementById('btn-limpiar-hasta-d').style.display = document.getElementById('fecha-hasta-d').value ? 'block' : 'none';
}

// ── Paginación desktop ──
function cambiarPaginaD(dir) {
  paginaActual = Math.max(1, Math.min(totalPaginas, paginaActual + dir));
  cargarGastos();
}

// ── Badge tareas sidebar ──
function actualizarBadgeSidebar(n) {
  const badge = document.getElementById('badge-tareas-sidebar');
  if (!badge) return;
  if (n > 0) { badge.textContent = n; badge.style.display = 'inline'; }
  else badge.style.display = 'none';
}

// ── Info selección en panel derecho ──
function actualizarInfoSeleccionDesktop() {
  if (!esDesktop()) return;
  const wrap = document.getElementById('desktop-seleccion-info');
  if (!wrap) return;
  const n = gastosSeleccionados?.size || 0;
  if (n > 0 && modoSeleccion) {
    wrap.style.display = 'block';
    document.getElementById('dsel-count').textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;
    const selec = gastos.filter(g => gastosSeleccionados.has(g.id));
    const suma = selec.reduce((s, g) => s + parseFloat(g.monto), 0);
    document.getElementById('dsel-suma').textContent = `Total: ${formatMoney(suma)}`;
  } else {
    wrap.style.display = 'none';
  }
}

// ── Tareas desktop ──
let estadoFiltroD = '';
function filtrarTareasD(el, estado) {
  document.querySelectorAll('#filtros-estado-d .filtro-chip').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  estadoFiltroD = estado;
  renderTareasDesktop();
}

function renderTareasDesktop() {
  if (!esDesktop()) return;
  const container = document.getElementById('tareas-lista-d');
  if (!container) return;
  const lista = estadoFiltroD
    ? todasLasTareas.filter(t => t.estado === estadoFiltroD && t.estado !== 'hecho')
    : todasLasTareas.filter(t => t.estado !== 'hecho');

  // Badge sidebar
  actualizarBadgeSidebar(todasLasTareas.filter(t => t.estado !== 'hecho').length);

  if (!lista.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-msg">Sin tareas activas</div></div>`;
    return;
  }
  container.innerHTML = lista.map(t => {
    const cfg = ESTADO_CONFIG[t.estado];
    const vencida = t.fecha_limite && t.estado !== 'hecho' && new Date(t.fecha_limite) < new Date();
    return `
      <div class="card" style="margin-bottom:8px;padding:12px 14px">
        <div class="row-between" style="align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.9rem">${t.titulo}</div>
            ${t.descripcion ? `<div class="text-2" style="margin-top:3px;font-size:.78rem">${t.descripcion}</div>` : ''}
            <div class="row" style="gap:8px;margin-top:5px;flex-wrap:wrap">
              <span style="font-size:.72rem;font-weight:700;color:${cfg.color}">${cfg.emoji} ${cfg.label}</span>
              ${t.fecha_limite ? `<span style="font-size:.72rem;color:${vencida ? 'var(--rojo)' : 'var(--texto-2)'}">${vencida ? '⚠️ ' : '📅 '}${formatDate(t.fecha_limite)}</span>` : ''}
            </div>
          </div>
          <div class="row" style="gap:6px;flex-shrink:0">
            <button onclick="cambiarEstadoTarea(${t.id},'${cfg.next}')"
              style="background:${cfg.color};color:#fff;border:none;border-radius:8px;padding:5px 9px;font-size:.72rem;font-weight:600;cursor:pointer;white-space:nowrap">
              ${cfg.next === 'en_progreso' ? '▶ Iniciar' : '✓ Listo'}
            </button>
            <button onclick="abrirEditarTarea(${t.id})" style="width:28px;height:28px;padding:4px;background:var(--gris-bg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">✏️</button>
            <button onclick="pedirEliminarTarea(${t.id})" style="width:28px;height:28px;padding:4px;background:var(--gris-bg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleHistorialD() {
  const wrap = document.getElementById('tareas-historial-d');
  const btn = document.getElementById('btn-historial-d');
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'block';
  const hechas = todasLasTareas.filter(t => t.estado === 'hecho');
  btn.textContent = visible ? `📋 Ver completadas (${hechas.length})` : '🔼 Ocultar';
  if (!visible) {
    document.getElementById('historial-lista-d').innerHTML = hechas.map(t => `
      <div class="card" style="margin-bottom:8px;padding:10px 14px;opacity:.65">
        <div class="row-between">
          <div style="font-weight:600;font-size:.85rem;text-decoration:line-through">${t.titulo}</div>
          <button onclick="cambiarEstadoTarea(${t.id},'pendiente')" style="background:var(--gris-bg);border:none;border-radius:8px;padding:4px 8px;font-size:.72rem;cursor:pointer">↩</button>
        </div>
      </div>`).join('');
  }
}

// ── Progreso desktop ──
let etapaFiltroD = '';
function filtrarEtapaD(el, etapa) {
  document.querySelectorAll('#filtros-etapa-d .filtro-chip').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  etapaFiltroD = etapa;
  renderProgresoDesktop();
}

function renderProgresoDesktop() {
  if (!esDesktop()) return;
  const container = document.getElementById('progreso-timeline-d');
  if (!container) return;

  let fotos = etapaFiltroD ? todasLasFotos.filter(f => f.etapa === etapaFiltroD) : todasLasFotos;
  const fechasSet = new Set([
    ...fotos.map(f => f.fecha?.substring(0, 10)),
    ...bitacora.map(b => b.fecha?.substring(0, 10))
  ]);
  const fechas = [...fechasSet].filter(Boolean).sort((a, b) => b.localeCompare(a));

  if (!fechas.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">📷</div><div class="empty-msg">Sin registros</div></div>`;
    return;
  }

  container.innerHTML = fechas.map(fecha => {
    const fotosDia = fotos.filter(f => f.fecha?.substring(0, 10) === fecha);
    const notaDia = bitacora.find(b => b.fecha?.substring(0, 10) === fecha);
    return `
      <div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--amarillo);flex-shrink:0"></div>
          <div class="fw-700" style="font-size:.9rem">${formatDate(fecha)}</div>
          <div style="flex:1;height:1px;background:var(--gris-linea)"></div>
          <button onclick="abrirNotaDia('${fecha}', ${notaDia ? notaDia.id : 'null'}, \`${(notaDia?.nota || '').replace(/\`/g, '\\`')}\`)"
            style="background:${notaDia ? 'var(--gris-obra)' : 'var(--gris-bg)'};border:none;border-radius:8px;padding:4px 10px;font-size:.75rem;font-weight:600;color:${notaDia ? 'var(--amarillo)' : 'var(--texto-2)'};cursor:pointer">
            ${notaDia ? '📝 Nota' : '+ Nota'}
          </button>
        </div>
        ${notaDia ? `<div style="background:#fffbf0;border-left:3px solid var(--amarillo);border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px"><div style="font-size:.85rem;white-space:pre-wrap">${notaDia.nota}</div></div>` : ''}
        ${fotosDia.length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
            ${fotosDia.map(f => `
              <div onclick="verFotoProgreso(${f.id})" style="position:relative;cursor:pointer;border-radius:10px;overflow:hidden">
                <img src="${f.foto_url}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">
                ${f.etapa ? `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:.65rem;font-weight:600;padding:4px 6px">${f.etapa}</div>` : ''}
              </div>`).join('')}
          </div>` : ''}
      </div>`;
  }).join('');
}

// ── Resumen desktop ──
function renderResumenDesktop(data, semanal) {
  if (!esDesktop()) return;
  const t = data.totales;
  const totalIngresos = t.total_ingresos || 0;

  // Stats
  const resTotal = document.getElementById('res-total-d');
  if (resTotal) {
    resTotal.innerHTML = formatMoney(t.total_gastado);
    if (totalIngresos > 0) {
      resTotal.innerHTML += `<div style="font-size:.72rem;color:var(--verde);margin-top:3px">Capital: ${formatMoney(totalIngresos)}</div>
        <div style="font-size:.72rem;color:${totalIngresos >= t.total_gastado ? 'var(--verde)' : 'var(--rojo)'};font-weight:700">Disp: ${formatMoney(totalIngresos - t.total_gastado)}</div>`;
    }
  }
  const resCant = document.getElementById('res-cantidad-d');
  if (resCant) resCant.textContent = t.cantidad_gastos;

  // Presupuesto
  if (data.obra.presupuesto > 0) {
    document.getElementById('card-presupuesto-d').style.display = 'block';
    const porc = Math.round((t.total_gastado / data.obra.presupuesto) * 100);
    document.getElementById('res-porc-d').textContent = porc + '%';
    document.getElementById('res-gastado-d').textContent = formatMoney(t.total_gastado);
    document.getElementById('res-presup-d').textContent = formatMoney(data.obra.presupuesto);
    const barra = document.getElementById('res-barra-d');
    if (barra) { barra.style.width = Math.min(porc, 100) + '%'; barra.className = 'presupuesto-fill' + (porc > 100 ? ' danger' : porc > 80 ? ' warn' : ''); }
  }

  // Gráfica cats
  const maxVal = Math.max(...data.por_categoria.map(c => c.total), 1);
  const graficaEl = document.getElementById('grafica-cats-d');
  if (graficaEl) {
    graficaEl.innerHTML = data.por_categoria.length
      ? data.por_categoria.map(c => `
        <div class="bar-row">
          <div class="bar-label">${c.nombre}${c.tipo === 'ingreso' ? ' ↑' : ''}</div>
          <div class="bar-track"><div class="bar-fill" style="background:${c.color};width:${Math.round((c.total / maxVal) * 100)}%"></div></div>
          <div class="bar-monto">${formatMoney(c.total)}</div>
        </div>`).join('')
      : '<div class="text-2">Sin datos</div>';
  }

  // Semanal
  if (semanal) {
    const semEl = document.getElementById('semanal-contenido-d');
    if (semEl) renderSemanalEl(semanal, semEl);
  }
}

// Función genérica para renderizar semanal en cualquier contenedor
function renderSemanalEl(s, container) {
  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const hoyD = new Date().getDay();
  const diaIdx = hoyD === 0 ? 6 : hoyD - 1;
  const diffSemana = s.semana_anterior > 0 ? Math.round(((s.semana_actual - s.semana_anterior) / s.semana_anterior) * 100) : null;
  const flechaSemana = diffSemana === null ? '' : diffSemana > 0
    ? `<span style="color:var(--rojo);font-size:.75rem;font-weight:700">▲ ${diffSemana}%</span>`
    : `<span style="color:var(--verde);font-size:.75rem;font-weight:700">▼ ${Math.abs(diffSemana)}%</span>`;
  const maxDia = Math.max(...s.dias_semana, 1);
  const barrasDias = DIAS.map((nombre, i) => {
    const val = s.dias_semana[i] || 0;
    const alto = Math.round((val / maxDia) * 48);
    const esHoy = i === diaIdx;
    const lunes = new Date(getLunesActual().replace(/-/g, '/'));
    const fecha = new Date(lunes); fecha.setDate(lunes.getDate() + i);
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="font-size:.62rem;color:${val > 0 ? 'var(--texto)' : 'var(--texto-3)'}">${val > 0 ? formatMoney(val).replace('$','').trim() : ''}</div>
      <div style="height:48px;display:flex;align-items:flex-end">
        <div style="width:100%;min-height:3px;height:${Math.max(alto, val > 0 ? 4 : 2)}px;background:${esHoy ? 'var(--amarillo)' : 'var(--gris-3)'};border-radius:4px 4px 0 0;min-width:10px"></div>
      </div>
      <div style="font-size:.68rem;color:${esHoy ? 'var(--amarillo)' : 'var(--texto-2)'};font-weight:${esHoy ? '700' : '400'};text-align:center;line-height:1.3">
        ${nombre}<br><span style="font-size:.62rem;color:${esHoy ? 'var(--amarillo)' : 'var(--texto-3)'}">${fecha.getDate()}</span>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">Esta semana</div><div class="stat-valor grande">${formatMoney(s.semana_actual)}</div><div style="margin-top:4px">${flechaSemana}</div></div>
      <div class="stat-card"><div class="stat-label">Semana pasada</div><div class="stat-valor grande" style="color:var(--texto-2)">${formatMoney(s.semana_anterior)}</div></div>
    </div>
    <div style="display:flex;gap:4px;align-items:flex-end;margin-bottom:14px;padding:8px 0">${barrasDias}</div>
    <div style="height:1px;background:var(--gris-linea);margin-bottom:12px"></div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div><div class="stat-label">Este mes</div><div class="fw-700">${formatMoney(s.mes_actual)}</div></div>
      <div style="text-align:right"><div class="stat-label">Mes anterior</div><div style="font-size:.9rem;color:var(--texto-2);font-weight:600">${formatMoney(s.mes_anterior)}</div></div>
    </div>`;
}

// ── Equipo desktop ──
function renderEquipoDesktop(colabs) {
  if (!esDesktop()) return;
  const el = document.getElementById('colaboradores-lista-d');
  if (el) el.innerHTML = colabs.map(c => `
    <div class="colab-item">
      <div class="colab-avatar">${c.nombre.charAt(0).toUpperCase()}</div>
      <div style="flex:1"><div class="fw-700" style="font-size:.88rem">${c.nombre}</div><div class="text-2">${c.email}</div></div>
      <span class="badge-rol badge-${c.rol}">${c.rol}</span>
    </div>`).join('');
}

function renderCatsDesktop() {
  if (!esDesktop()) return;
  const el = document.getElementById('cats-lista-d');
  if (el) el.innerHTML = categorias.map(c => `
    <div class="row" style="padding:7px 0;border-bottom:1px solid var(--gris-linea)">
      <div style="width:12px;height:12px;border-radius:50%;background:${c.color}"></div>
      <div style="flex:1;font-size:.88rem">${c.nombre}</div>
      ${c.es_global ? '<span class="text-2" style="font-size:.72rem">Global</span>' : ''}
    </div>`).join('');
}

// ── Top gastos desktop ──
function renderTopGastosDesktop(topSorted) {
  if (!esDesktop()) return;
  const el = document.getElementById('top-gastos-d');
  if (!el) return;
  el.innerHTML = topSorted.map(g => `
    <div class="gasto-item">
      <div class="gasto-cat-dot" style="background:${g.categorias?.[0]?.color || '#aeaeb2'}"></div>
      <div class="gasto-info">
        <div class="gasto-desc">${g.descripcion}</div>
        <div class="gasto-meta">${formatDate(g.fecha)}</div>
      </div>
      <div class="gasto-monto">${formatMoney(g.monto)}</div>
    </div>`).join('');
}

// ── Init ──
window.addEventListener('DOMContentLoaded', () => {
  if (esDesktop()) {
    initSidebar();
    sincronizarSidebarTab('gastos');
  }
});
window.addEventListener('resize', () => {
  if (esDesktop()) {
    initSidebar();
    sincronizarSidebarTab(tabActualDesktop || 'gastos');
  }
});

let tabActualDesktop = 'gastos';
