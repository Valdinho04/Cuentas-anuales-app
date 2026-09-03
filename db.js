/**
 * db.js
 * Capa de almacenamiento local (IndexedDB).
 *
 * Responsabilidades:
 *  - Guardar una copia en caché de cada tabla (Movimientos, Tarjetas, Cuentas,
 *    Categorías, Ingresos, Apartados) para que la app cargue instantáneo y
 *    funcione sin conexión.
 *  - Mantener una cola de "pendientes" (movimientos creados sin conexión, o
 *    que fallaron al escribir en Sheets) para reintentarlos después.
 *  - Guardar configuración local (id de la hoja, última sincronización).
 *
 * Nunca se usa localStorage/sessionStorage: todo vive en IndexedDB.
 */

const DB_NAME = 'finanzas-db';
const DB_VERSION = 1;

const STORES = [
  'movimientos',
  'tarjetas',
  'cuentas',
  'categorias',
  'ingresos',
  'apartados',
  'pendientes', // cola de escrituras no sincronizadas
  'config',
];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          const keyPath = store === 'config' ? 'clave' : 'id';
          db.createObjectStore(store, { keyPath });
        }
      });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

const Db = {
  async getAll(store) {
    return withStore(store, 'readonly', (s) => {
      return new Promise((resolve, reject) => {
        const req = s.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }).then((p) => p); // getAll ya regresa promesa dentro de la promesa externa
  },

  async put(store, record) {
    return withStore(store, 'readwrite', (s) => s.put(record));
  },

  async putMany(store, records) {
    return withStore(store, 'readwrite', (s) => {
      records.forEach((r) => s.put(r));
    });
  },

  async delete(store, id) {
    return withStore(store, 'readwrite', (s) => s.delete(id));
  },

  async clear(store) {
    return withStore(store, 'readwrite', (s) => s.clear());
  },

  // --- Configuración (clave/valor simple) ---
  async setConfig(clave, valor) {
    return this.put('config', { clave, valor });
  },

  async getConfig(clave) {
    return withStore('config', 'readonly', (s) => {
      return new Promise((resolve, reject) => {
        const req = s.get(clave);
        req.onsuccess = () => resolve(req.result ? req.result.valor : null);
        req.onerror = () => reject(req.error);
      });
    }).then((p) => p);
  },

  // --- Cola de pendientes ---
  async encolarPendiente(item) {
    // item: { id, tabla, operacion: 'crear'|'editar'|'eliminar', datos, intentos: 0 }
    return this.put('pendientes', item);
  },

  async marcarSincronizado(id) {
    return this.delete('pendientes', id);
  },
};

// getAll tiene una promesa anidada por el helper genérico; lo simplificamos aquí:
Db.getAll = async function (store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

Db.getConfig = async function (clave) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('config', 'readonly');
    const req = tx.objectStore('config').get(clave);
    req.onsuccess = () => resolve(req.result ? req.result.valor : null);
    req.onerror = () => reject(req.error);
  });
};

window.Db = Db;
