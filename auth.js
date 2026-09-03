/**
 * auth.js
 * Autenticación con Google Identity Services (OAuth 2.0, solo cliente).
 *
 * IMPORTANTE: reemplaza CLIENT_ID por el tuyo, generado en Google Cloud
 * Console (ver guía de configuración). El Client ID no es secreto: Google
 * solo acepta peticiones desde los dominios que tú autorizaste ahí.
 *
 * Scopes usados:
 *  - drive.file: la app solo puede ver/editar archivos que ella misma crea
 *    o que abres explícitamente con ella. NO tiene acceso a todo tu Drive.
 *  - spreadsheets: leer/escribir en esa hoja específica.
 *
 * El token de acceso vive solo en memoria del navegador (nunca en
 * localStorage ni en el código) y se renueva automáticamente mientras haya
 * sesión activa.
 */

const CLIENT_ID = '1025282620285-vu9nr6i0giiilm8rmusin7vc5tmr6kle.apps.googleusercontent.com'; // <- reemplazar
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

const Auth = {
  init() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: '', // se define dinámicamente en cada solicitud
    });
  },

  isSignedIn() {
    return !!accessToken && Date.now() < tokenExpiresAt;
  },

  /** Abre el selector de cuenta de Google y resuelve con el access token. */
  signIn() {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) {
          reject(resp);
          return;
        }
        accessToken = resp.access_token;
        // Los tokens de GIS duran típicamente 3600s; restamos margen de seguridad.
        tokenExpiresAt = Date.now() + (resp.expires_in - 120) * 1000;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: this.hasEverSignedIn() ? '' : 'consent' });
    });
  },

  hasEverSignedIn() {
    return !!localStorage.getItem('finanzas-ever-signed-in');
    // Nota: esto NO guarda credenciales, solo una bandera para no forzar
    // pantalla de consentimiento cada vez. El token nunca se persiste.
  },

  /** Regresa un token válido, renovándolo silenciosamente si expiró. */
  async getValidToken() {
    if (this.isSignedIn()) return accessToken;
    return this.signIn();
  },

  signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    tokenExpiresAt = 0;
  },
};

window.Auth = Auth;
