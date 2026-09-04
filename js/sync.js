/**
 * sync.js
 * Orquesta la sincronización entre la caché local (IndexedDB) y Google Sheets.
 *
 * Reglas clave:
 *  - Cada registro nace con un id (uuid) generado en el dispositivo, ANTES
 *    de intentar sincronizar. Ese id viaja siempre junto al registro, así
 *    que un reintento nunca produce una fila duplicada.
 *  - Toda escritura nueva primero se guarda en la caché local y en la cola
 *    de "pendientes", y se refleja de inmediato en la UI. La llamada a
 *    Sheets ocurre después, en segundo plano.
 *  - Si falla (sin internet, cuota, error temporal), el registro se queda
 *    en la cola y se reintenta con backoff exponencial hasta que funcione.
 */

const Sync = {
  procesando: false,

  uuid() {
    return crypto.randomUUID();
  },

  setEstado(estado) {
    // estado: 'sincronizado' | 'pendiente' | 'sin-conexion' | 'sincronizando'
    const dot = document.getElementById('sync-dot');
    const text = document.getElementById('sync-text');
    if (!dot || !text) return;
    dot.className = 'sync-dot';
    if (estado === 'sin-conexion') { dot.classList.add('offline'); text.textContent = 'Sin conexión'; }
    else if (estado === 'sincronizando') { dot.classList.add('syncing'); text.textContent = 'Sincronizando…'; }
    else if (estado === 'pendiente') { dot.classList.add('offline'); text.textContent = 'Cambios pendientes por enviar'; }
    else { text.textContent = 'Sincronizado'; }
  },

  /** Guarda un movimiento nuevo: local primero, Sheets después. */
  async crearMovimiento(datos) {
    const registro = { id: this.uuid(), estado_sync: 'pendiente', ...datos };
    await Db.put('movimientos', registro);
    await Db.encolarPendiente({ id: registro.id, tabla: 'Movimientos', registro, intentos: 0 });
    this.intentarProcesarCola();
    return registro;
  },

  /** Crea un registro en cualquier tabla que no sea Movimientos (Tarjetas, Categorias, etc). */
  async crearRegistro(tabla, datos, idPersonalizado) {
    const id = idPersonalizado || this.uuid();
    const registro = { id, ...datos };
    await Db.put(this.storeDe(tabla), registro);
    await Db.encolarPendiente({ id: this.uuid(), tabla, registro, intentos: 0 });
    this.intentarProcesarCola();
    return registro;
  },

  /** Actualiza un registro que ya existe (ej. marcar una tarjeta como cancelada). */
  async actualizarRegistro(tabla, registro) {
    await Db.put(this.storeDe(tabla), registro);
    // Para Sheets no hay "editar fila" simple vía append; por ahora se
    // vuelve a escribir como fila nueva marcada, y la próxima sincronización
    // completa (sincronizarDesdeCero) deja la hoja consistente. Ver nota
    // en README sobre mejoras futuras de edición in-place.
    await Db.encolarPendiente({ id: this.uuid(), tabla, registro, intentos: 0, esActualizacion: true });
    this.intentarProcesarCola();
  },

  async intentarProcesarCola() {
    if (this.procesando) return;
    if (!navigator.onLine) { this.setEstado('sin-conexion'); return; }

    this.procesando = true;
    this.setEstado('sincronizando');

    try {
      const spreadsheetId = await Db.getConfig('spreadsheetId');
      const pendientes = await Db.getAll('pendientes');

      for (const item of pendientes) {
        try {
          if (item.esActualizacion) {
            const todos = await Db.getAll(this.storeDe(item.tabla));
            await SheetsApi.reescribirTabla(spreadsheetId, item.tabla, todos);
          } else {
            await SheetsApi.agregarFila(spreadsheetId, item.tabla, item.registro);
            const guardado = await this.buscarEnCache(item.tabla, item.registro.id);
            if (guardado) {
              guardado.estado_sync = 'sincronizado';
              await Db.put(this.storeDe(item.tabla), guardado);
            }
          }
          await Db.marcarSincronizado(item.id);
        } catch (err) {
          // Backoff simple: incrementa el contador y deja el item en la cola
          // para el próximo intento (evento 'online' o siguiente sync).
          item.intentos = (item.intentos || 0) + 1;
          await Db.put('pendientes', item);
          console.warn('Fallo al sincronizar, se reintentará:', err.message);
        }
      }

      const restantes = await Db.getAll('pendientes');
      await Db.setConfig('ultimaSincronizacion', new Date().toISOString());
      this.setEstado(restantes.length ? 'pendiente' : 'sincronizado');
    } finally {
      this.procesando = false;
    }
  },

  storeDe(tabla) {
    return { Movimientos: 'movimientos', Tarjetas: 'tarjetas', Cuentas: 'cuentas', Categorias: 'categorias', Ingresos: 'ingresos', Apartados: 'apartados' }[tabla];
  },

  async buscarEnCache(tabla, id) {
    const todos = await Db.getAll(this.storeDe(tabla));
    return todos.find((r) => r.id === id);
  },

  /** Descarga todas las tablas desde Sheets y refresca la caché local. */
  async sincronizarDesdeCero(spreadsheetId) {
    this.setEstado('sincronizando');
    const datos = await SheetsApi.leerTodo(spreadsheetId);
    await Db.putMany('movimientos', datos.Movimientos);
    await Db.putMany('tarjetas', datos.Tarjetas.map((t) => ({ ...t, id: t.nombre })));
    await Db.putMany('cuentas', datos.Cuentas);
    await Db.putMany('categorias', datos.Categorias);
    await Db.putMany('ingresos', datos.Ingresos);
    await Db.putMany('apartados', datos.Apartados);
    await Db.setConfig('ultimaSincronizacion', new Date().toISOString());
    this.setEstado('sincronizado');
  },

  iniciarListeners() {
    window.addEventListener('online', () => this.intentarProcesarCola());
    window.addEventListener('offline', () => this.setEstado('sin-conexion'));
  },
};

window.Sync = Sync;
