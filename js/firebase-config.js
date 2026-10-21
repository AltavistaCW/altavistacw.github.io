/*
 * Conexión a Firebase (base de datos + login del equipo).
 *
 * Mientras esto sea null, la app funciona en MODO DEMO: los datos se guardan solo
 * en el navegador y se entra con las cuentas de prueba.
 *
 * Para usarla de verdad: reemplazar null por el objeto "firebaseConfig" que entrega
 * la consola de Firebase (ver README, sección "Conectar Firebase"). Ejemplo:
 *
 * window.FIREBASE_CONFIG = {
 *   apiKey: "AIza...",
 *   authDomain: "altavista-carwash.firebaseapp.com",
 *   projectId: "altavista-carwash",
 *   storageBucket: "altavista-carwash.appspot.com",
 *   messagingSenderId: "123456789",
 *   appId: "1:123456789:web:abc123"
 * };
 *
 * Estos datos no son secretos (Firebase los pensó para ir en páginas públicas);
 * la seguridad la dan las reglas del archivo firestore.rules.
 */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC6PdJQEo_526CSoY3JRKjSx5h9LgmaYxM',
  authDomain: 'altavista-carwash.firebaseapp.com',
  projectId: 'altavista-carwash',
  storageBucket: 'altavista-carwash.firebasestorage.app',
  messagingSenderId: '467985021498',
  appId: '1:467985021498:web:203411eb1954217e26d303'
};
