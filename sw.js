/*
 * Service worker: guarda una copia de la app en el celular.
 * Estrategia "primero internet": si hay conexión se usa siempre la versión más nueva
 * (precios al día); si no hay, se muestra la última copia guardada.
 * Al agregar archivos nuevos a la app, sumarlos a ARCHIVOS y subir la versión de CACHE.
 */
const CACHE = 'altavista-v2';
const ARCHIVOS = [
  './', 'index.html', 'cliente.html', 'dueno.html', 'ingreso.html', 'trabajador.html',
  'css/estilos.css',
  'js/iconos.js', 'js/firebase-config.js', 'js/almacen.js', 'js/datos.js', 'js/ui.js',
  'js/inicio.js', 'js/cliente.js', 'js/dueno.js', 'js/trabajador.js', 'js/ingreso.js', 'js/pwa.js',
  'data/negocio.json', 'data/servicios.json', 'data/reservas-demo.json', 'data/equipo-demo.json',
  'iconos/icono-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // fuentes y WhatsApp pasan directo

  e.respondWith(
    fetch(req)
      .then(resp => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
