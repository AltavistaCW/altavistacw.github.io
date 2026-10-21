/*
 * Almacén: dónde viven los datos y quién inició sesión.
 * Tiene dos motores con las mismas funciones:
 *   - "demo": todo en este navegador (localStorage). Para probar sin internet ni cuentas reales.
 *   - "nube": Firebase (Firestore + Authentication), compartido entre todos los celulares.
 * Se elige solo: si js/firebase-config.js tiene datos, se usa la nube.
 * Solo datos.js usa este archivo; las pantallas nunca hablan directo con él.
 */
const Almacen = (() => {
  const CONFIG = window.FIREBASE_CONFIG;
  const VERSION_SDK = '10.14.1';

  // Filtros: [campo, operador, valor] con operadores == >= <= > <
  function cumple(doc, [campo, op, valor]) {
    const v = doc[campo];
    switch (op) {
      case '==': return v === valor;
      case '>=': return v >= valor;
      case '<=': return v <= valor;
      case '>': return v > valor;
      case '<': return v < valor;
      default: return false;
    }
  }

  // Quita el id (va en la "dirección" del documento) y los campos vacíos, que Firebase rechaza.
  const limpiar = (datos) => Object.fromEntries(
    Object.entries(datos).filter(([k, v]) => k !== 'id' && v !== undefined));

  const errorConCodigo = (code, message = '') => Object.assign(new Error(message), { code });

  // ===== Motor demo: navegador =====
  function motorDemo() {
    const CLAVE = 'lavado.demo';
    const CLAVE_SESION = 'lavado.demo.sesion';
    const vacia = () => ({ colecciones: {}, cuentas: {} });
    let db = vacia();
    let sesionActual = null;

    const leer = (clave) => { try { return JSON.parse(localStorage.getItem(clave)); } catch { return null; } };
    const escribir = () => { try { localStorage.setItem(CLAVE, JSON.stringify(db)); } catch { /* sin acceso: queda en memoria */ } };
    const col = (nombre) => (db.colecciones[nombre] ??= {});
    const copia = (x) => JSON.parse(JSON.stringify(x));

    const guardar = async (nombre, id, datos) => { col(nombre)[id] = copia(limpiar(datos)); escribir(); };

    return {
      modo: 'demo',
      async iniciar() { db = leer(CLAVE) ?? vacia(); sesionActual = leer(CLAVE_SESION); },
      async vacio() { return !col('config').negocio; },
      async borrarTodo() { db = vacia(); escribir(); },

      async listar(nombre, filtros = []) {
        return Object.entries(col(nombre))
          .map(([id, d]) => ({ id, ...copia(d) }))
          .filter(d => filtros.every(f => cumple(d, f)));
      },
      async obtener(nombre, id) { const d = col(nombre)[id]; return d ? { id, ...copia(d) } : null; },
      guardar,
      async actualizar(nombre, id, cambios) {
        if (!col(nombre)[id]) throw new Error('El registro ya no existe.');
        Object.assign(col(nombre)[id], copia(limpiar(cambios)));
        escribir();
      },
      async borrar(nombre, id) { delete col(nombre)[id]; escribir(); },
      async lote(operaciones) { for (const { coleccion, id, datos } of operaciones) await guardar(coleccion, id, datos); },

      async sesion() { return sesionActual; },
      async ingresar(email, clave) {
        const correo = email.toLowerCase();
        const cuenta = db.cuentas[correo];
        if (!cuenta || cuenta.clave !== clave) throw errorConCodigo('auth/invalid-credential');
        sesionActual = { uid: cuenta.uid, email: correo };
        try { localStorage.setItem(CLAVE_SESION, JSON.stringify(sesionActual)); } catch { /* sin acceso */ }
      },
      async salir() {
        sesionActual = null;
        try { localStorage.removeItem(CLAVE_SESION); } catch { /* sin acceso */ }
      },
      // uidFijo solo se usa al cargar las cuentas de prueba, para que la sesión sobreviva a "Reiniciar demo".
      async crearCuenta(email, clave, uidFijo) {
        const correo = email.toLowerCase();
        if (db.cuentas[correo]) throw errorConCodigo('auth/email-already-in-use');
        if (clave.length < 6) throw errorConCodigo('auth/weak-password');
        const uid = uidFijo ?? 'U' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        db.cuentas[correo] = { uid, clave };
        escribir();
        return uid;
      },
      async recuperarClave() {
        throw new Error('En modo demo no se envían correos. Las cuentas de prueba usan la clave demo1234.');
      }
    };
  }

  // ===== Motor nube: Firebase =====
  function motorNube() {
    let db, auth;

    const cargarScript = (archivo) => new Promise((ok, falla) => {
      const s = document.createElement('script');
      s.src = `https://www.gstatic.com/firebasejs/${VERSION_SDK}/${archivo}`;
      s.onload = ok;
      s.onerror = () => falla(new Error('No se pudo conectar con la base de datos. Revisa tu conexión a internet.'));
      document.head.appendChild(s);
    });
    const docs = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));

    return {
      modo: 'nube',
      async iniciar() {
        await cargarScript('firebase-app-compat.js');
        await Promise.all([cargarScript('firebase-auth-compat.js'), cargarScript('firebase-firestore-compat.js')]);
        firebase.initializeApp(CONFIG);
        auth = firebase.auth();
        db = firebase.firestore();
      },
      async vacio() { return false; },
      async borrarTodo() { throw new Error('Esta opción solo existe en modo demo.'); },

      async listar(nombre, filtros = []) {
        let consulta = db.collection(nombre);
        filtros.forEach(([campo, op, valor]) => { consulta = consulta.where(campo, op, valor); });
        return docs(await consulta.get());
      },
      async obtener(nombre, id) {
        const d = await db.collection(nombre).doc(id).get();
        return d.exists ? { id: d.id, ...d.data() } : null;
      },
      guardar: (nombre, id, datos) => db.collection(nombre).doc(id).set(limpiar(datos)),
      actualizar: (nombre, id, cambios) => db.collection(nombre).doc(id).update(limpiar(cambios)),
      borrar: (nombre, id) => db.collection(nombre).doc(id).delete(),
      async lote(operaciones) {
        const lote = db.batch();
        operaciones.forEach(({ coleccion, id, datos }) => lote.set(db.collection(coleccion).doc(id), limpiar(datos)));
        await lote.commit();
      },

      sesion: () => new Promise((ok) => {
        const dejar = auth.onAuthStateChanged((u) => { dejar(); ok(u ? { uid: u.uid, email: u.email } : null); });
      }),
      ingresar: (email, clave) => auth.signInWithEmailAndPassword(email, clave),
      salir: () => auth.signOut(),
      // Se crea la cuenta en una conexión aparte para que el dueño no pierda su propia sesión.
      async crearCuenta(email, clave) {
        const secundaria = firebase.apps.find(a => a.name === 'altas') ?? firebase.initializeApp(CONFIG, 'altas');
        await secundaria.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
        const { user } = await secundaria.auth().createUserWithEmailAndPassword(email, clave);
        await secundaria.auth().signOut();
        return user.uid;
      },
      recuperarClave: (email) => auth.sendPasswordResetEmail(email)
    };
  }

  return CONFIG && CONFIG.apiKey ? motorNube() : motorDemo();
})();
