/**
 * app.js
 * UI: pantalla de login, navegación entre vistas, hoja de registro rápido,
 * y renderizado del Dashboard / Tarjetas / Apartados / Ajustes.
 */

const state = {
  vista: 'inicio',
  tarjetaSeleccionada: null,
  movimientos: [],
  tarjetas: [],
  categorias: [],
  apartados: [],
  cuentas: [],
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
  document.getElementById('fab-add').addEventListener('click', () => {
    abrirSheet(state.vista === 'tarjeta-detalle' ? state.tarjetaSeleccionada : null);
  });
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
  state.cuentas = await Db.getAll('cuentas');
}

// ---------- Cálculos de saldo de cuentas y apartados ----------
// Saldo general de una cuenta = ingresos que entraron directo a esa cuenta
// (sin apartado) menos lo que se ha "apartado" (movido) desde esa cuenta.
// Nota: por ahora los gastos en efectivo todavía no se restan de ninguna
// cuenta específica — eso vendrá en un siguiente ajuste.
function saldoGeneralCuenta(nombreCuenta) {
  return state.movimientos.reduce((acc, m) => {
    if (m.cuenta !== nombreCuenta) return acc;
    if (m.tipo === 'ingreso' && !m.apartado) return acc + Number(m.monto || 0);
    if (m.tipo === 'apartado') return acc - Number(m.monto || 0);
    return acc;
  }, 0);
}

function saldoApartado(nombreCuenta, nombreApartado) {
  return state.movimientos.reduce((acc, m) => {
    if (m.cuenta !== nombreCuenta || m.apartado !== nombreApartado) return acc;
    if (m.tipo === 'ingreso' || m.tipo === 'apartado') return acc + Number(m.monto || 0);
    return acc;
  }, 0);
}

function saldoTotalApartados() {
  return state.apartados.reduce((acc, a) => acc + saldoApartado(a.cuenta, a.nombre), 0);
}

function cuentaPrincipal() {
  return state.cuentas.find((c) => c.es_principal === true || c.es_principal === 'true');
}

// Si varias cuentas comparten el mismo (o ningún) valor de orden — por
// ejemplo, las que ya existían antes de agregar esta función — les asigna
// un orden secuencial una sola vez, para que las flechas ▲▼ funcionen.
async function normalizarOrdenCuentas() {
  const activas = state.cuentas.filter((c) => c.estatus !== 'cancelada');
  const ordenes = activas.map((c) => Number(c.orden || 0));
  const hayDuplicados = new Set(ordenes).size !== ordenes.length;
  if (!hayDuplicados) return;
  for (let i = 0; i < activas.length; i++) {
    activas[i].orden = i + 1;
    await Sync.actualizarRegistro('Cuentas', activas[i]);
  }
  await cargarEstadoLocal();
}

// ---------- Navegación ----------
function cambiarVista(vista) {
  state.vista = vista;
  state.tarjetaSeleccionada = null;
  document.querySelectorAll('nav.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === vista);
  });
  if (vista === 'cuentas') {
    normalizarOrdenCuentas().then(renderVista);
  }
  renderVista();
}

function abrirDetalleTarjeta(nombre) {
  state.vista = 'tarjeta-detalle';
  state.tarjetaSeleccionada = nombre;
  renderVista();
}

function renderVista() {
  const root = document.getElementById('view-root');
  actualizarHero();
  if (state.vista === 'inicio') root.innerHTML = renderInicio();
  else if (state.vista === 'tarjetas') root.innerHTML = renderTarjetas();
  else if (state.vista === 'tarjeta-detalle') root.innerHTML = renderTarjetaDetalle();
  else if (state.vista === 'cuentas') root.innerHTML = renderCuentas();
  else if (state.vista === 'ajustes') root.innerHTML = renderAjustes();

  document.querySelectorAll('[data-eliminar-mov]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); eliminarMovimiento(btn.dataset.eliminarMov); });
  });

  if (state.vista === 'tarjetas') {
    document.querySelectorAll('[data-abrir-tarjeta]').forEach((el) => {
      el.addEventListener('click', () => abrirDetalleTarjeta(el.dataset.abrirTarjeta));
    });
  }

  if (state.vista === 'tarjeta-detalle') {
    document.getElementById('btn-volver-tarjetas')?.addEventListener('click', () => cambiarVista('tarjetas'));
  }

  if (state.vista === 'ajustes') {
    document.getElementById('btn-exportar')?.addEventListener('click', exportarExcel);
    document.getElementById('btn-agregar-tarjeta')?.addEventListener('click', agregarTarjeta);
    document.getElementById('btn-agregar-categoria')?.addEventListener('click', agregarCategoria);
    document.querySelectorAll('[data-toggle-tarjeta]').forEach((btn) => {
      btn.addEventListener('click', () => alternarEstatusTarjeta(btn.dataset.toggleTarjeta));
    });
    document.querySelectorAll('[data-eliminar-categoria]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarCategoria(btn.dataset.eliminarCategoria));
    });
  }

  if (state.vista === 'cuentas') {
    document.getElementById('btn-agregar-cuenta')?.addEventListener('click', agregarCuenta);
    document.getElementById('btn-agregar-apartado')?.addEventListener('click', agregarApartado);
    document.querySelectorAll('[data-eliminar-apartado]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarApartado(btn.dataset.eliminarApartado));
    });
    document.querySelectorAll('[data-editar-apartado]').forEach((btn) => {
      btn.addEventListener('click', () => renombrarApartado(btn.dataset.editarApartado));
    });
    document.querySelectorAll('[data-eliminar-cuenta]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarCuenta(btn.dataset.eliminarCuenta));
    });
    document.querySelectorAll('[data-marcar-principal]').forEach((btn) => {
      btn.addEventListener('click', () => marcarCuentaPrincipal(btn.dataset.marcarPrincipal));
    });
    document.querySelectorAll('[data-toggle-no-contable]').forEach((btn) => {
      btn.addEventListener('click', () => alternarNoContable(btn.dataset.toggleNoContable));
    });
    document.querySelectorAll('[data-subir-cuenta]').forEach((btn) => {
      btn.addEventListener('click', () => moverCuenta(btn.dataset.subirCuenta, 'arriba'));
    });
    document.querySelectorAll('[data-bajar-cuenta]').forEach((btn) => {
      btn.addEventListener('click', () => moverCuenta(btn.dataset.bajarCuenta, 'abajo'));
    });
  }
}

async function eliminarMovimiento(id) {
  if (!confirm('¿Borrar este movimiento? No se puede deshacer.')) return;
  await Sync.eliminarRegistro('Movimientos', id);
  await cargarEstadoLocal();
  renderVista();
}

function actualizarHero() {
  const principal = cuentaPrincipal();
  let disponible;
  if (principal) {
    disponible = saldoGeneralCuenta(principal.nombre);
  } else {
    // Mientras no haya una cuenta marcada como principal, usamos el cálculo
    // anterior (ingresos menos gastos) para no dejar el número en blanco.
    disponible = state.movimientos.reduce((acc, m) => {
      if (m.tipo === 'ingreso') return acc + Number(m.monto || 0);
      if (m.tipo === 'gasto' || m.tipo === 'compra_normal' || m.tipo === 'compra_msi') return acc - Number(m.monto || 0);
      return acc;
    }, 0);
  }
  const el = document.getElementById('hero-amount');
  el.textContent = formatoMoneda(disponible);
  el.classList.toggle('negative', disponible < 0);
  el.classList.toggle('positive', disponible >= 0);
  const label = document.getElementById('hero-label');
  if (label) label.textContent = principal ? `Disponible en ${principal.nombre}` : 'Disponible';
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
        <p class="ledger-meta">${formatoFecha(m.fecha)} · ${m.categoria || '—'}${m.tarjeta ? ' · ' + escapeHtml(m.tarjeta) : ''}${m.cuenta ? ' · ' + escapeHtml(m.cuenta) + (m.apartado ? ' → ' + escapeHtml(m.apartado) : '') : ''}</p>
      </div>
      <div class="ledger-amount ${(m.tipo === 'ingreso' || m.tipo === 'apartado') ? 'ingreso' : 'gasto'} num">
        ${(m.tipo === 'ingreso' || m.tipo === 'apartado') ? '+' : '−'}${formatoMoneda(Math.abs(Number(m.monto || 0)))}
      </div>
      <button class="btn-text" style="width:auto;padding:0 0 0 6px;font-size:16px;" data-eliminar-mov="${m.id}" title="Borrar">×</button>
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
      <div class="tarjeta-block" style="cursor:pointer;" data-abrir-tarjeta="${escapeHtml(t.nombre)}">
        <p class="tarjeta-nombre">${escapeHtml(t.nombre)}</p>
        <div class="tarjeta-row"><span>Saldo</span><span class="num">${formatoMoneda(saldo)}</span></div>
        <div class="tarjeta-row"><span>MSI activos</span><span class="num">${msiActivos.length}</span></div>
        <div class="tarjeta-row"><span>Movimientos</span><span class="num">${compras.length}</span></div>
      </div>
    `;
  }).join('');
}

// ---------- Vista: Detalle de una tarjeta ----------
function renderTarjetaDetalle() {
  const nombre = state.tarjetaSeleccionada;
  const t = state.tarjetas.find((tt) => tt.nombre === nombre);
  if (!t) return `<div class="empty-state">Esta tarjeta ya no existe.</div>`;

  const movs = state.movimientos.filter((m) => m.tarjeta === nombre);
  const msi = movs.filter((m) => m.tipo === 'compra_msi').sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const normales = movs.filter((m) => m.tipo === 'compra_normal').sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const pagos = movs.filter((m) => m.tipo === 'pago_tarjeta');
  const saldo = [...msi, ...normales].reduce((a, m) => a + Number(m.monto || 0), 0) - pagos.reduce((a, m) => a + Number(m.monto || 0), 0);

  const filaCompra = (m) => `
    <div class="ledger-row">
      <div class="ledger-main">
        <p class="ledger-desc">${escapeHtml(m.descripcion || 'Compra')}</p>
        <p class="ledger-meta">${formatoFecha(m.fecha)} · ${m.categoria || '—'}${m.tipo === 'compra_msi' ? ` · ${m.msi_restantes}/${m.num_msi} MSI restantes` : ''}</p>
      </div>
      <div class="ledger-amount gasto num">${formatoMoneda(m.monto)}</div>
      <button class="btn-text" style="width:auto;padding:0 0 0 6px;font-size:16px;" data-eliminar-mov="${m.id}" title="Borrar">×</button>
    </div>
  `;

  return `
    <div class="section" style="display:flex; align-items:center; gap:10px;">
      <button id="btn-volver-tarjetas" class="btn-text" style="width:auto;padding:4px 0;">← Tarjetas</button>
    </div>
    <div class="tarjeta-block">
      <p class="tarjeta-nombre">${escapeHtml(nombre)}</p>
      <div class="tarjeta-row"><span>Saldo</span><span class="num">${formatoMoneda(saldo)}</span></div>
      <div class="tarjeta-row"><span>Día de corte</span><span class="num">${t.dia_corte || '—'}</span></div>
      <div class="tarjeta-row"><span>Día de pago</span><span class="num">${t.dia_pago || '—'}</span></div>
    </div>

    ${msi.length ? `<div class="section"><p class="section-title">Compras a MSI</p></div><div class="ledger">${msi.map(filaCompra).join('')}</div>` : ''}

    <div class="section"><p class="section-title">Compras de contado</p></div>
    <div class="ledger">${normales.length ? normales.map(filaCompra).join('') : '<div class="empty-state">Sin compras de contado todavía.</div>'}</div>
  `;
}

// ---------- Vista: Cuentas (bancos) con sus apartados anidados ----------
function renderCuentas() {
  const activas = state.cuentas
    .filter((c) => c.estatus !== 'cancelada')
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0));
  const sinCuenta = state.apartados.filter((a) => !a.cuenta || !activas.some((c) => c.nombre === a.cuenta));

  const balanceGeneral = activas
    .filter((c) => !(c.excluir_balance === true || c.excluir_balance === 'true'))
    .reduce((acc, c) => acc + saldoGeneralCuenta(c.nombre) + state.apartados.filter((a) => a.cuenta === c.nombre).reduce((s, a) => s + saldoApartado(c.nombre, a.nombre), 0), 0);

  const totalAparte = activas
    .filter((c) => c.excluir_balance === true || c.excluir_balance === 'true')
    .reduce((acc, c) => acc + saldoGeneralCuenta(c.nombre) + state.apartados.filter((a) => a.cuenta === c.nombre).reduce((s, a) => s + saldoApartado(c.nombre, a.nombre), 0), 0);

  const bloqueCuenta = (c, idx) => {
    const esPrincipal = c.es_principal === true || c.es_principal === 'true';
    const esNoContable = c.excluir_balance === true || c.excluir_balance === 'true';
    const saldoGeneral = saldoGeneralCuenta(c.nombre);
    const apartadosDeEsta = state.apartados.filter((a) => a.cuenta === c.nombre);

    const filasApartados = apartadosDeEsta.map((a) => {
      const acumulado = saldoApartado(c.nombre, a.nombre);
      const pct = a.monto_meta ? Math.min(100, Math.round((acumulado / a.monto_meta) * 100)) : 0;
      return `
        <div class="tarjeta-row" style="align-items:center; padding-left:12px; border-left:2px solid var(--line);">
          <span>${escapeHtml(a.nombre)}<br><span class="ledger-meta">${formatoMoneda(acumulado)}${a.monto_meta ? ` de ${formatoMoneda(a.monto_meta)} · ${pct}%` : ''}</span></span>
          <span>
            <button class="btn-text" style="width:auto;padding:4px 6px;font-size:13px;" data-editar-apartado="${a.id}" title="Renombrar">✎</button>
            <button class="btn-text" style="width:auto;padding:4px 6px;font-size:14px;" data-eliminar-apartado="${a.id}" title="Borrar">×</button>
          </span>
        </div>
      `;
    }).join('') || '<p class="ledger-meta" style="padding-left:12px;">Sin apartados en esta cuenta.</p>';

    const flechas = `
      <span>
        <button class="btn-text" style="width:auto;padding:4px 6px;font-size:13px;" data-subir-cuenta="${escapeHtml(c.nombre)}" ${idx === 0 ? 'disabled' : ''} title="Subir">▲</button>
        <button class="btn-text" style="width:auto;padding:4px 6px;font-size:13px;" data-bajar-cuenta="${escapeHtml(c.nombre)}" ${idx === activas.length - 1 ? 'disabled' : ''} title="Bajar">▼</button>
      </span>
    `;

    return `
      <div class="tarjeta-block">
        <div class="tarjeta-row" style="align-items:center;">
          <p class="tarjeta-nombre">${flechas} ${escapeHtml(c.nombre)} ${esPrincipal ? '<span style="color:var(--accent);font-size:12px;">· Principal</span>' : ''} ${esNoContable ? '<span style="color:var(--text-muted);font-size:12px;">· No cuenta para tu balance</span>' : ''}</p>
          <button class="btn-text" style="width:auto;padding:4px 8px;font-size:13px;" data-eliminar-cuenta="${escapeHtml(c.nombre)}" title="Borrar cuenta">×</button>
        </div>
        <div class="tarjeta-row"><span>Disponible (fuera de apartados)</span><span class="num">${formatoMoneda(saldoGeneral)}</span></div>
        <div class="tarjeta-row" style="gap:8px;">
          ${!esPrincipal ? `<button class="btn-text" style="width:auto;padding:4px 0;font-size:13px;" data-marcar-principal="${escapeHtml(c.nombre)}">Marcar como principal</button>` : ''}
          <button class="btn-text" style="width:auto;padding:4px 0;font-size:13px;" data-toggle-no-contable="${escapeHtml(c.nombre)}">${esNoContable ? 'Contar en mi balance' : 'No contar en mi balance (caja chica, préstamos, reembolsos)'}</button>
        </div>
        <div class="section" style="padding:10px 0 4px;"><p class="section-title" style="font-size:12px;">Apartados</p></div>
        ${filasApartados}
      </div>
    `;
  };

  const listaCuentas = activas.map(bloqueCuenta).join('') || '<div class="empty-state">Agrega tu primera cuenta (banco) para empezar a organizar tus apartados.</div>';

  const bloqueBalance = activas.length ? `
    <div class="tarjeta-block" style="background:var(--surface-2, var(--surface));">
      <div class="tarjeta-row"><span>Balance general</span><span class="num">${formatoMoneda(balanceGeneral)}</span></div>
      ${totalAparte ? `<div class="tarjeta-row"><span class="ledger-meta">Dinero aparte (no cuenta para tu balance)</span><span class="num ledger-meta">${formatoMoneda(totalAparte)}</span></div>` : ''}
    </div>
  ` : '';

  const bloqueSinCuenta = sinCuenta.length ? `
    <div class="section"><p class="section-title">Apartados sin cuenta asignada</p></div>
    <div class="tarjeta-block">
      ${sinCuenta.map((a) => `
        <div class="tarjeta-row" style="align-items:center;">
          <span>${escapeHtml(a.nombre)}</span>
          <button class="btn-text" style="width:auto;padding:4px 8px;font-size:14px;" data-eliminar-apartado="${a.id}" title="Borrar">×</button>
        </div>
      `).join('')}
      <p class="ledger-meta">Estos quedaron de antes de organizar por cuenta. Bórralos y créalos de nuevo ya dentro de la cuenta que corresponda.</p>
    </div>
  ` : '';

  const opcionesCuentaSelect = activas.map((c) => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('');

  return `
    ${bloqueBalance}
    ${listaCuentas}
    ${bloqueSinCuenta}

    <div class="section"><p class="section-title">Nueva cuenta (banco)</p></div>
    <div class="tarjeta-block">
      <div class="field">
        <label for="ncu-nombre">Nombre (ej. "BBVA")</label>
        <input type="text" id="ncu-nombre" />
      </div>
      <div class="field" style="flex-direction:row;align-items:center;gap:8px;">
        <input type="checkbox" id="ncu-no-contable" style="width:auto;" />
        <label for="ncu-no-contable" style="margin:0;">No contar en mi balance (caja chica, préstamos, reembolsos)</label>
      </div>
      <button id="btn-agregar-cuenta" class="btn-primary">Crear cuenta</button>
    </div>

    ${activas.length ? `
    <div class="section"><p class="section-title">Nuevo apartado dentro de una cuenta</p></div>
    <div class="tarjeta-block">
      <div class="field">
        <label for="na-cuenta">Cuenta</label>
        <select id="na-cuenta">${opcionesCuentaSelect}</select>
      </div>
      <div class="field">
        <label for="na-nombre">Nombre (ej. "Viaje fin de año")</label>
        <input type="text" id="na-nombre" />
      </div>
      <div class="field">
        <label for="na-meta">Monto meta (opcional)</label>
        <input type="number" id="na-meta" class="num" placeholder="0.00" />
      </div>
      <button id="btn-agregar-apartado" class="btn-primary">Crear apartado</button>
    </div>
    ` : ''}
  `;
}

async function agregarCuenta() {
  const nombre = document.getElementById('ncu-nombre').value.trim();
  if (!nombre) return;
  const excluirBalance = document.getElementById('ncu-no-contable').checked;
  const activas = state.cuentas.filter((c) => c.estatus !== 'cancelada');
  const esPrimera = !activas.length;
  const ordenMax = activas.reduce((max, c) => Math.max(max, Number(c.orden || 0)), 0);

  await Sync.crearRegistro('Cuentas', {
    nombre,
    tipo: 'banco',
    fecha_alta: new Date().toISOString().slice(0, 10),
    fecha_baja: '',
    estatus: 'activa',
    es_principal: esPrimera && !excluirBalance, // una cuenta no-contable no debería ser la principal
    orden: ordenMax + 1,
    excluir_balance: excluirBalance,
  }, nombre);

  await cargarEstadoLocal();
  renderVista();
}

async function alternarNoContable(nombre) {
  const cuenta = state.cuentas.find((c) => c.nombre === nombre);
  if (!cuenta) return;
  cuenta.excluir_balance = !(cuenta.excluir_balance === true || cuenta.excluir_balance === 'true');
  await Sync.actualizarRegistro('Cuentas', cuenta);
  await cargarEstadoLocal();
  renderVista();
}

async function moverCuenta(nombre, direccion) {
  const activas = state.cuentas
    .filter((c) => c.estatus !== 'cancelada')
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0));
  const idx = activas.findIndex((c) => c.nombre === nombre);
  const idxVecino = direccion === 'arriba' ? idx - 1 : idx + 1;
  if (idx === -1 || idxVecino < 0 || idxVecino >= activas.length) return;

  const actual = activas[idx];
  const vecino = activas[idxVecino];
  const ordenActual = Number(actual.orden || 0);
  const ordenVecino = Number(vecino.orden || 0);
  actual.orden = ordenVecino;
  vecino.orden = ordenActual;

  await Sync.actualizarRegistro('Cuentas', actual);
  await Sync.actualizarRegistro('Cuentas', vecino);
  await cargarEstadoLocal();
  renderVista();
}

async function renombrarApartado(id) {
  const apartado = state.apartados.find((a) => a.id === id);
  if (!apartado) return;
  const nuevoNombre = prompt('Nuevo nombre del apartado:', apartado.nombre);
  if (!nuevoNombre || !nuevoNombre.trim() || nuevoNombre.trim() === apartado.nombre) return;
  const nombreAnterior = apartado.nombre;
  apartado.nombre = nuevoNombre.trim();
  await Sync.actualizarRegistro('Apartados', apartado);

  // Reasigna también los movimientos ya guardados que apuntaban al nombre
  // anterior, para no perder el historial de aportaciones de ese apartado.
  const afectados = state.movimientos.filter((m) => m.cuenta === apartado.cuenta && m.apartado === nombreAnterior);
  for (const mov of afectados) {
    mov.apartado = apartado.nombre;
    await Sync.actualizarRegistro('Movimientos', mov);
  }

  await cargarEstadoLocal();
  renderVista();
}

async function marcarCuentaPrincipal(nombre) {
  for (const c of state.cuentas) {
    const debeSerPrincipal = c.nombre === nombre;
    if ((c.es_principal === true || c.es_principal === 'true') !== debeSerPrincipal) {
      c.es_principal = debeSerPrincipal;
      await Sync.actualizarRegistro('Cuentas', c);
    }
  }
  await cargarEstadoLocal();
  renderVista();
}

async function eliminarCuenta(nombre) {
  const tieneApartados = state.apartados.some((a) => a.cuenta === nombre);
  if (tieneApartados) {
    alert('Esta cuenta todavía tiene apartados dentro. Bórralos primero o muévelos.');
    return;
  }
  if (!confirm(`¿Eliminar la cuenta "${nombre}"? No se puede deshacer.`)) return;
  await Sync.eliminarRegistro('Cuentas', nombre);
  await cargarEstadoLocal();
  renderVista();
}

async function agregarApartado() {
  const cuenta = document.getElementById('na-cuenta').value;
  const nombre = document.getElementById('na-nombre').value.trim();
  if (!nombre || !cuenta) return;
  const montoMeta = Number(document.getElementById('na-meta').value || 0);

  await Sync.crearRegistro('Apartados', {
    nombre,
    cuenta,
    monto_meta: montoMeta,
    fecha_meta: '',
    estatus: 'activo',
  });
  await cargarEstadoLocal();
  renderVista();
}

async function eliminarApartado(id) {
  if (!confirm('¿Eliminar este apartado? El dinero que tenía queda reflejado en el saldo general de la cuenta.')) return;
  await Sync.eliminarRegistro('Apartados', id);
  await cargarEstadoLocal();
  renderVista();
}

// ---------- Vista: Ajustes ----------
function renderAjustes() {
  const filasTarjetas = state.tarjetas.map((t) => `
    <div class="tarjeta-row" style="align-items:center;">
      <span>${escapeHtml(t.nombre)} ${t.estatus === 'cancelada' ? '(cancelada)' : ''}</span>
      <button class="btn-text" style="width:auto;padding:4px 10px;" data-toggle-tarjeta="${escapeHtml(t.nombre)}">
        ${t.estatus === 'cancelada' ? 'Reactivar' : 'Cancelar'}
      </button>
    </div>
  `).join('') || '<p class="ledger-meta">Aún no agregas ninguna tarjeta.</p>';

  const filasCategorias = state.categorias.map((c) => `
    <div class="tarjeta-row" style="align-items:center;">
      <span>${escapeHtml(c.nombre)} <span style="color:var(--text-muted);">· ${c.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</span></span>
      <button class="btn-text" style="width:auto;padding:4px 10px;font-size:16px;" data-eliminar-categoria="${c.id}" title="Borrar">×</button>
    </div>
  `).join('') || '<p class="ledger-meta">Aún no agregas ninguna categoría.</p>';

  return `
    <div class="section"><p class="section-title">Tarjetas</p></div>
    <div class="tarjeta-block">
      ${filasTarjetas}
      <div style="display:flex; gap:8px; margin-top:12px;">
        <input type="text" id="nt-nombre" placeholder="Ej. Oro BBVA" style="flex:2; background:var(--surface-raised); border:1px solid var(--line); border-radius:8px; padding:10px; color:var(--text);" />
        <input type="number" id="nt-corte" placeholder="Día corte" style="flex:1; background:var(--surface-raised); border:1px solid var(--line); border-radius:8px; padding:10px; color:var(--text);" />
        <input type="number" id="nt-pago" placeholder="Día pago" style="flex:1; background:var(--surface-raised); border:1px solid var(--line); border-radius:8px; padding:10px; color:var(--text);" />
      </div>
      <button id="btn-agregar-tarjeta" class="btn-primary" style="margin-top:10px;">Agregar tarjeta</button>
    </div>

    <div class="section"><p class="section-title">Categorías</p></div>
    <div class="tarjeta-block">
      ${filasCategorias}
      <div style="display:flex; gap:8px; margin-top:12px;">
        <input type="text" id="nc-nombre" placeholder="Ej. Gasolina" style="flex:2; background:var(--surface-raised); border:1px solid var(--line); border-radius:8px; padding:10px; color:var(--text);" />
        <select id="nc-tipo" style="flex:1; background:var(--surface-raised); border:1px solid var(--line); border-radius:8px; padding:10px; color:var(--text);">
          <option value="gasto">Gasto</option>
          <option value="ingreso">Ingreso</option>
        </select>
      </div>
      <button id="btn-agregar-categoria" class="btn-primary" style="margin-top:10px;">Agregar categoría</button>
    </div>

    <div class="section">
      <p class="section-title">Datos</p>
    </div>
    <div style="padding: 0 20px;">
      <button id="btn-exportar" class="btn-primary" style="margin-bottom:10px;">Exportar a Excel</button>
      <button id="btn-logout" class="btn-text" onclick="Auth.signOut(); location.reload();">Cerrar sesión</button>
    </div>
  `;
}

async function agregarTarjeta() {
  const nombre = document.getElementById('nt-nombre').value.trim();
  if (!nombre) return;
  const diaCorte = document.getElementById('nt-corte').value;
  const diaPago = document.getElementById('nt-pago').value;

  await Sync.crearRegistro('Tarjetas', {
    nombre,
    dia_corte: diaCorte,
    dia_pago: diaPago,
    fecha_alta: new Date().toISOString().slice(0, 10),
    fecha_baja: '',
    estatus: 'activa',
  }, nombre); // el nombre es el identificador único, como acordamos

  await cargarEstadoLocal();
  renderVista();
}

async function alternarEstatusTarjeta(nombre) {
  const tarjeta = state.tarjetas.find((t) => t.nombre === nombre);
  if (!tarjeta) return;
  if (tarjeta.estatus === 'cancelada') {
    tarjeta.estatus = 'activa';
    tarjeta.fecha_baja = '';
  } else {
    tarjeta.estatus = 'cancelada';
    tarjeta.fecha_baja = new Date().toISOString().slice(0, 10);
  }
  await Sync.actualizarRegistro('Tarjetas', tarjeta);
  await cargarEstadoLocal();
  renderVista();
}

async function agregarCategoria() {
  const nombre = document.getElementById('nc-nombre').value.trim();
  if (!nombre) return;
  const tipo = document.getElementById('nc-tipo').value;

  await Sync.crearRegistro('Categorias', { nombre, tipo });
  await cargarEstadoLocal();
  renderVista();
}

async function eliminarCategoria(id) {
  if (!confirm('¿Borrar esta categoría? Los movimientos que ya la usan conservan el nombre, pero dejará de aparecer como opción.')) return;
  await Sync.eliminarRegistro('Categorias', id);
  await cargarEstadoLocal();
  renderVista();
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

function abrirSheet(tarjetaPreset) {
  poblarSelects();
  if (tarjetaPreset) {
    document.getElementById('f-metodo').value = tarjetaPreset;
    actualizarCamposPorTipo();
  }
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
  actualizarCamposPorTipo();
}

function actualizarCamposPorTipo() {
  const metodoSel = document.getElementById('f-metodo');
  const esTarjeta = metodoSel && metodoSel.value !== 'efectivo';
  const tipo = tipoSeleccionado;

  document.getElementById('field-msi').style.display = (tipo === 'gasto' && esTarjeta) ? '' : 'none';
  document.getElementById('field-categoria').style.display = (tipo === 'apartado') ? 'none' : '';
  document.getElementById('field-metodo').style.display = (tipo === 'ingreso' || tipo === 'apartado') ? 'none' : '';
  document.getElementById('field-cuenta').style.display = (tipo === 'ingreso' || tipo === 'apartado') ? '' : 'none';
  document.getElementById('field-apartado').style.display = (tipo === 'apartado') ? '' : 'none';

  const cuentaLabel = document.querySelector('label[for="f-cuenta"]');
  if (tipo === 'apartado') {
    if (cuentaLabel) cuentaLabel.textContent = 'Cuenta (de dónde sale el dinero)';
  } else {
    if (cuentaLabel) cuentaLabel.textContent = 'Cuenta destino (siempre va al saldo disponible, fuera de apartados)';
  }

  poblarApartadosDeCuenta();
}

function poblarApartadosDeCuenta() {
  const cuentaSel = document.getElementById('f-cuenta');
  const apartadoSel = document.getElementById('f-apartado');
  if (!cuentaSel || !apartadoSel) return;
  const cuentaElegida = cuentaSel.value;
  const opciones = state.apartados.filter((a) => a.cuenta === cuentaElegida);
  apartadoSel.innerHTML = opciones.map((a) => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`).join('') || '<option value="">Esta cuenta no tiene apartados</option>';
}

function poblarSelects() {
  const catSel = document.getElementById('f-categoria');
  catSel.innerHTML = state.categorias.map((c) => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('') || '<option value="General">General</option>';

  const metodoSel = document.getElementById('f-metodo');
  const opcionesEfectivo = '<option value="efectivo">Efectivo</option>';
  const opcionesTarjetas = state.tarjetas.filter((t) => t.estatus !== 'cancelada').map((t) => `<option value="${escapeHtml(t.nombre)}">${escapeHtml(t.nombre)}</option>`).join('');
  metodoSel.innerHTML = opcionesEfectivo + opcionesTarjetas;

  const cuentaSel = document.getElementById('f-cuenta');
  const cuentasActivas = state.cuentas.filter((c) => c.estatus !== 'cancelada');
  cuentaSel.innerHTML = cuentasActivas.map((c) => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('') || '<option value="">Agrega una cuenta en la pestaña Cuentas</option>';
  cuentaSel.onchange = poblarApartadosDeCuenta;

  metodoSel.onchange = actualizarCamposPorTipo;

  actualizarCamposPorTipo();
}

async function guardarMovimiento() {
  const monto = Number(document.getElementById('f-monto').value);
  if (!monto || monto <= 0) return;

  const descripcion = document.getElementById('f-desc').value.trim();
  const categoria = document.getElementById('f-categoria').value;
  const metodo = document.getElementById('f-metodo').value;
  const esTarjeta = metodo !== 'efectivo';
  const msiMeses = Number(document.getElementById('f-msi').value || 0);
  const cuenta = document.getElementById('f-cuenta').value;
  const apartado = document.getElementById('f-apartado').value;

  let tipo = tipoSeleccionado;
  if (tipo === 'gasto' && esTarjeta) tipo = msiMeses > 0 ? 'compra_msi' : 'compra_normal';

  if ((tipo === 'ingreso' || tipo === 'apartado') && !cuenta) {
    alert('Elige a qué cuenta va este movimiento. Si no tienes ninguna, crea una primero en la pestaña Cuentas.');
    return;
  }
  if (tipo === 'apartado' && !apartado) {
    alert('Elige a qué apartado va este movimiento.');
    return;
  }

  const registro = {
    fecha: new Date().toISOString().slice(0, 10),
    tipo,
    descripcion: descripcion || (tipo === 'apartado' ? `Aportación a ${apartado}` : ''),
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
    cuenta: (tipo === 'ingreso' || tipo === 'apartado') ? cuenta : '',
    apartado: (tipo === 'apartado') ? apartado : '',
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
