/**
 * app.js
 * UI: pantalla de login, navegación entre vistas, hoja de registro rápido,
 * y renderizado del Dashboard / Tarjetas / Apartados / Ajustes.
 */

const state = {
  vista: 'inicio',
  movimientos: [],
  tarjetas: [],
  categorias: [],
  apartados: [],
};

// ---------- Arranque ----------
window.addEventListener('DOMContentLoaded', async () => {
  Auth.init();
  Sync.iniciarListeners();
  registrarServiceWorker();

  document.getElementById('btn-login').addEventListener('click', iniciarSesion);
  document.querySelectorAll('nav.tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => cambiarVista(btn.dataset.view));
  });
  document.getElementById('fab-add').addEventListener('click', abrirSheet);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarSheet);
  document.getElementById('sheet-backdrop').addEventListener('click', cerrarSheet);
  document.getElementById('btn-guardar').addEventListener('click', guardarMovimiento);
  document.querySelectorAll('#type-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => seleccionarTipo(btn.dataset.type));
  });

  // Si ya hubo sesión antes, reintenta silenciosamente para no mostrar login
  // cada vez que se abre la app.
  if (Auth.hasEverSignedIn()) {
    try {
      await iniciarSesion(true);
    } catch (e) {
      // el usuario tendrá que tocar "Conectar con Google" manualmente
    }
  }
});

async function iniciarSesion(silencioso = false) {
  await Auth.signIn();
  localStorage.setItem('finanzas-ever-signed-in', '1');

  let spreadsheetId = await Db.getConfig('spreadsheetId');
  if (!spreadsheetId) {
    spreadsheetId = await SheetsApi.crearHojaInicial();
    await Db.setConfig('spreadsheetId', spreadsheetId);
  }

  await Sync.sincronizarDesdeCero(spreadsheetId);
  await cargarEstadoLocal();

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  renderVista();
}

async function cargarEstadoLocal() {
  state.movimientos = (await Db.getAll('movimientos')).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  state.tarjetas = await Db.getAll('tarjetas');
  state.categorias = await Db.getAll('categorias');
  state.apartados = await Db.getAll('apartados');
}

// ---------- Navegación ----------
function cambiarVista(vista) {
  state.vista = vista;
  document.querySelectorAll('nav.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === vista);
  });
  renderVista();
}

function renderVista() {
  const root = document.getElementById('view-root');
  actualizarHero();
  if (state.vista === 'inicio') root.innerHTML = renderInicio();
  else if (state.vista === 'tarjetas') root.innerHTML = renderTarjetas();
  else if (state.vista === 'apartados') root.innerHTML = renderApartados();
  else if (state.vista === 'ajustes') root.innerHTML = renderAjustes();

  if (state.vista === 'ajustes') {
    document.getElementById('btn-exportar')?.addEventListener('click', exportarExcel);
  }
}

function actualizarHero() {
  const disponible = state.movimientos.reduce((acc, m) => {
    if (m.tipo === 'ingreso') return acc + Number(m.monto || 0);
    if (m.tipo === 'gasto' || m.tipo === 'compra_normal' || m.tipo === 'compra_msi') return acc - Number(m.monto || 0);
    return acc;
  }, 0);
  const el = document.getElementById('hero-amount');
  el.textContent = formatoMoneda(disponible);
  el.classList.toggle('negative', disponible < 0);
  el.classList.toggle('positive', disponible >= 0);
}

// ---------- Vista: Inicio (ledger de movimientos) ----------
function renderInicio() {
  if (!state.movimientos.length) {
    return `<div class="empty-state">Aún no tienes movimientos. Toca “+” para registrar el primero.</div>`;
  }
  const filas = state.movimientos.slice(0, 50).map((m) => `
    <div class="ledger-row">
      <div class="ledger-main">
        <p class="ledger-desc">${escapeHtml(m.descripcion || sinDescripcion(m.tipo))}</p>
        <p class="ledger-meta">${formatoFecha(m.fecha)} · ${m.categoria || '—'}${m.tarjeta ? ' · ' + escapeHtml(m.tarjeta) : ''}</p>
      </div>
      <div class="ledger-amount ${m.tipo === 'ingreso' ? 'ingreso' : 'gasto'} num">
        ${m.tipo === 'ingreso' ? '+' : '−'}${formatoMoneda(Math.abs(Number(m.monto || 0)))}
      </div>
    </div>
  `).join('');
  return `<div class="section"><p class="section-title">Movimientos recientes</p></div><div class="ledger">${filas}</div>`;
}

function sinDescripcion(tipo) {
  return { pago_tarjeta: 'Pago de tarjeta', transferencia: 'Transferencia', apartado: 'Apartado' }[tipo] || 'Movimiento';
}

// ---------- Vista: Tarjetas ----------
function renderTarjetas() {
  const activas = state.tarjetas.filter((t) => t.estatus !== 'cancelada');
  if (!activas.length) {
    return `<div class="empty-state">Agrega tus tarjetas desde Ajustes para verlas aquí.</div>`;
  }
  return activas.map((t) => {
    const movs = state.movimientos.filter((m) => m.tarjeta === t.nombre);
    const compras = movs.filter((m) => m.tipo === 'compra_normal' || m.tipo === 'compra_msi');
    const pagos = movs.filter((m) => m.tipo === 'pago_tarjeta').reduce((a, m) => a + Number(m.monto || 0), 0);
    const totalCompras = compras.reduce((a, m) => a + Number(m.monto || 0), 0);
    const saldo = totalCompras - pagos;
    const msiActivos = compras.filter((m) => m.tipo === 'compra_msi' && Number(m.msi_restantes) > 0);

    return `
      <div class="tarjeta-block">
        <p class="tarjeta-nombre">${escapeHtml(t.nombre)}</p>
        <div class="tarjeta-row"><span>Saldo</span><span class="num">${formatoMoneda(saldo)}</span></div>
        <div class="tarjeta-row"><span>MSI activos</span><span class="num">${msiActivos.length}</span></div>
        ${msiActivos.map((m) => `
          <div class="msi-item">
            <span>${escapeHtml(m.descripcion)} — ${formatoMoneda(m.mensualidad)}/${m.num_msi} MSI</span>
            <span class="num">${m.msi_restantes} restantes</span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

// ---------- Vista: Apartados ----------
function renderApartados() {
  if (!state.apartados.length) {
    return `<div class="empty-state">No tienes apartados activos todavía.</div>`;
  }
  return state.apartados.map((a) => {
    const acumulado = state.movimientos
      .filter((m) => m.tipo === 'apartado' && m.categoria === a.nombre)
      .reduce((acc, m) => acc + Number(m.monto || 0), 0);
    const pct = a.monto_meta ? Math.min(100, Math.round((acumulado / a.monto_meta) * 100)) : 0;
    return `
      <div class="tarjeta-block">
        <p class="tarjeta-nombre">${escapeHtml(a.nombre)}</p>
        <div class="tarjeta-row"><span>Acumulado</span><span class="num">${formatoMoneda(acumulado)} de ${formatoMoneda(a.monto_meta)}</span></div>
        <div class="tarjeta-row"><span>Avance</span><span class="num">${pct}%</span></div>
      </div>
    `;
  }).join('');
}

// ---------- Vista: Ajustes ----------
function renderAjustes() {
  return `
    <div class="section">
      <p class="section-title">Datos</p>
    </div>
    <div style="padding: 0 20px;">
      <button id="btn-exportar" class="btn-primary" style="margin-bottom:10px;">Exportar a Excel</button>
      <button id="btn-logout" class="btn-text" onclick="Auth.signOut(); location.reload();">Cerrar sesión</button>
    </div>
  `;
}

async function exportarExcel() {
  const wb = XLSX.utils.book_new();
  const tablas = { Movimientos: 'movimientos', Tarjetas: 'tarjetas', Cuentas: 'cuentas', Categorias: 'categorias', Ingresos: 'ingresos', Apartados: 'apartados' };
  for (const [hoja, store] of Object.entries(tablas)) {
    const datos = await Db.getAll(store);
    const ws = XLSX.utils.json_to_sheet(datos);
    XLSX.utils.book_append_sheet(wb, ws, hoja);
  }
  XLSX.writeFile(wb, `Finanzas_respaldo_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- Registro rápido (+ botón) ----------
let tipoSeleccionado = 'gasto';

function abrirSheet() {
  poblarSelects();
  document.getElementById('sheet-backdrop').classList.add('open');
  document.getElementById('add-sheet').classList.add('open');
  document.getElementById('f-monto').focus();
}

function cerrarSheet() {
  document.getElementById('sheet-backdrop').classList.remove('open');
  document.getElementById('add-sheet').classList.remove('open');
  document.getElementById('f-monto').value = '';
  document.getElementById('f-desc').value = '';
}

function seleccionarTipo(tipo) {
  tipoSeleccionado = tipo;
  document.querySelectorAll('#type-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === tipo));
  document.getElementById('field-msi').style.display = tipo === 'gasto' ? '' : 'none';
}

function poblarSelects() {
  const catSel = document.getElementById('f-categoria');
  catSel.innerHTML = state.categorias.map((c) => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('') || '<option value="General">General</option>';

  const metodoSel = document.getElementById('f-metodo');
  const opcionesEfectivo = '<option value="efectivo">Efectivo</option>';
  const opcionesTarjetas = state.tarjetas.filter((t) => t.estatus !== 'cancelada').map((t) => `<option value="${escapeHtml(t.nombre)}">${escapeHtml(t.nombre)}</option>`).join('');
  metodoSel.innerHTML = opcionesEfectivo + opcionesTarjetas;

  metodoSel.onchange = () => {
    const esTarjeta = metodoSel.value !== 'efectivo';
    document.getElementById('field-msi').style.display = esTarjeta && tipoSeleccionado === 'gasto' ? '' : 'none';
  };
}

async function guardarMovimiento() {
  const monto = Number(document.getElementById('f-monto').value);
  if (!monto || monto <= 0) return;

  const descripcion = document.getElementById('f-desc').value.trim();
  const categoria = document.getElementById('f-categoria').value;
  const metodo = document.getElementById('f-metodo').value;
  const esTarjeta = metodo !== 'efectivo';
  const msiMeses = Number(document.getElementById('f-msi').value || 0);

  let tipo = tipoSeleccionado;
  if (tipo === 'gasto' && esTarjeta) tipo = msiMeses > 0 ? 'compra_msi' : 'compra_normal';

  const registro = {
    fecha: new Date().toISOString().slice(0, 10),
    tipo,
    descripcion,
    categoria,
    monto,
    metodo_pago: esTarjeta ? 'tarjeta' : 'efectivo',
    tarjeta: esTarjeta ? metodo : '',
    compra_relacionada_id: '',
    num_msi: msiMeses || '',
    mensualidad: msiMeses > 0 ? Math.round((monto / msiMeses) * 100) / 100 : '',
    msi_pagadas: msiMeses > 0 ? 0 : '',
    msi_restantes: msiMeses > 0 ? msiMeses : '',
    fecha_inicio: msiMeses > 0 ? new Date().toISOString().slice(0, 10) : '',
    fecha_fin: '',
  };

  await Sync.crearMovimiento(registro);
  await cargarEstadoLocal();
  cerrarSheet();
  renderVista();
}

// ---------- Utilidades ----------
function formatoMoneda(n) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
}

function formatoFecha(f) {
  if (!f) return '';
  const d = new Date(f + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW no registrado:', e));
  }
}
