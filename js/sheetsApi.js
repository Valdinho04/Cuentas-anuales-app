/**
 * sheetsApi.js
 * Toda la comunicación con Google Sheets API v4 y Drive API v3.
 * No usa la librería gapi (evitamos su peso); hace fetch directo con el
 * access token de Auth en el header Authorization.
 */

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

// Encabezados exactos de cada tabla, en el orden en que se guardan.
const ESQUEMA = {
  Movimientos: ['id', 'fecha', 'tipo', 'descripcion', 'categoria', 'monto', 'metodo_pago', 'tarjeta', 'compra_relacionada_id', 'num_msi', 'mensualidad', 'msi_pagadas', 'msi_restantes', 'fecha_inicio', 'fecha_fin'],
  Tarjetas: ['nombre', 'dia_corte', 'dia_pago', 'fecha_alta', 'fecha_baja', 'estatus'],
  Cuentas: ['id', 'nombre', 'tipo', 'estatus'],
  Categorias: ['id', 'nombre', 'tipo'],
  Ingresos: ['id', 'fecha', 'descripcion', 'categoria', 'monto', 'cuenta_destino'],
  Apartados: ['id', 'nombre', 'monto_meta', 'fecha_meta', 'estatus'],
};

async function authFetch(url, options = {}) {
  const token = await Auth.getValidToken();
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API error ${resp.status}: ${body}`);
  }
  return resp.json();
}

const SheetsApi = {
  /**
   * Crea la hoja de cálculo con las 6 pestañas de datos + Configuración,
   * ya con encabezados. Se llama solo la primera vez que se usa la app.
   */
  async crearHojaInicial() {
    const sheets = Object.keys(ESQUEMA).map((titulo) => ({ properties: { title: titulo } }));
    sheets.push({ properties: { title: 'Configuracion' } });

    const data = await authFetch(SHEETS_BASE, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: 'Mis Finanzas (datos de la app)' },
        sheets,
      }),
    });

    const spreadsheetId = data.spreadsheetId;

    // Escribe encabezados de cada tabla en una sola llamada batchUpdate.
    const requests = Object.entries(ESQUEMA).map(([titulo, columnas]) => ({
      range: `${titulo}!A1`,
      values: [columnas],
    }));

    await authFetch(`${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: requests,
      }),
    });

    return spreadsheetId;
  },

  /** Lee todas las tablas de datos en una sola llamada. */
  async leerTodo(spreadsheetId) {
    const rangos = Object.keys(ESQUEMA).map((t) => `${t}!A2:Z10000`);
    const params = rangos.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const data = await authFetch(`${SHEETS_BASE}/${spreadsheetId}/values:batchGet?${params}`);

    const resultado = {};
    Object.keys(ESQUEMA).forEach((titulo, i) => {
      const filas = data.valueRanges[i].values || [];
      const columnas = ESQUEMA[titulo];
      resultado[titulo] = filas.map((fila) => {
        const obj = {};
        columnas.forEach((col, idx) => { obj[col] = fila[idx] ?? ''; });
        return obj;
      });
    });
    return resultado;
  },

  /** Agrega una fila nueva al final de una tabla. */
  async agregarFila(spreadsheetId, tabla, registro) {
    const columnas = ESQUEMA[tabla];
    const fila = columnas.map((c) => registro[c] ?? '');
    return authFetch(`${SHEETS_BASE}/${spreadsheetId}/values/${tabla}!A1:append?valueInputOption=RAW`, {
      method: 'POST',
      body: JSON.stringify({ values: [fila] }),
    });
  },
};

window.SheetsApi = SheetsApi;
window.ESQUEMA = ESQUEMA;
