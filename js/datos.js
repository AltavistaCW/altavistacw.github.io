/*
 * Capa de datos: todas las pantallas leen y guardan SOLO a través de estas funciones.
 * Por debajo usa Almacen (js/almacen.js), que decide si los datos quedan en el navegador
 * (modo demo) o en Firebase (base de datos real, compartida entre celulares).
 *
 * Colecciones:
 *   config/negocio    datos del local, horario, tipos de vehículo, medios de pago
 *   config/servicios  { lista: [...] } servicios y precios
 *   usuarios/{uid}    equipo: nombre, email, rol (dueno | trabajador), activo
 *   reservas/{id}     fecha, hora, servicio, patente, estado, quién lo lava (lectura pública, sin datos personales)
 *   contactos/{id}    nombre y teléfono del cliente de la reserva con el mismo id (solo el equipo)
 *   actividades/{id}  lo que registra cada persona: entrada, salida, lavado, cobro, otra
 */
const Datos = (() => {
  const ESTADOS = {
    'pendiente':  { texto: 'Pendiente',  siguiente: 'en-proceso' },
    'en-proceso': { texto: 'En proceso', siguiente: 'listo' },
    'listo':      { texto: 'Listo',      siguiente: 'entregado' },
    'entregado':  { texto: 'Entregado',  siguiente: null },
    'cancelada':  { texto: 'Cancelada',  siguiente: null }
  };

  const TIPOS_ACTIVIDAD = {
    entrada: { texto: 'Entrada' },
    salida:  { texto: 'Salida' },
    lavado:  { texto: 'Lavado' },
    cobro:   { texto: 'Cobro' },
    otra:    { texto: 'Otra actividad' }
  };

  const ROLES = { dueno: 'Dueño', trabajador: 'Trabajador' };

  // Cómo ve el cliente cada estado (más claro que el nombre interno).
  const ESTADOS_CLIENTE = {
    'pendiente':  'Reservado',
    'en-proceso': 'Lavándose',
    'listo':      'Listo para retirar',
    'entregado':  'Entregado',
    'cancelada':  'Cancelada'
  };

  // Minutos de atraso tras los cuales una reserva sin llegar deja de ocupar lugar.
  const TOLERANCIA_ATRASO = 15;

  async function cargarJSON(ruta) {
    const resp = await fetch(ruta, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`No se pudo cargar ${ruta}`);
    return resp.json();
  }

  // ---- Utilidades de fecha/hora y formato ----
  function fechaISO(fecha = new Date()) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function sumarDias(fecha, dias) {
    const f = new Date(fecha + 'T12:00:00');
    f.setDate(f.getDate() + dias);
    return fechaISO(f);
  }

  const aMinutos = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };
  const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const horaActual = () => { const a = new Date(); return aHora(a.getHours() * 60 + a.getMinutes()); };
  const marcaTiempo = (fecha, hora) => new Date(`${fecha}T${hora}:00`).getTime();

  const formatoCLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const dinero = (monto) => formatoCLP.format(monto || 0);
  const formatoHoras = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

  // Evita que textos escritos por clientes o trabajadores se interpreten como HTML.
  const escapar = (txt) => String(txt ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const normalizarPatente = (txt) => String(txt ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nuevoId = (prefijo) => prefijo + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  // Código corto para reservas (fácil de dictar): sin letras que se confunden (0/O, 1/I/L).
  const idCorto = (prefijo) => prefijo + Array.from({ length: 5 }, () => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 31)]).join('');
  // Nombre del servicio aunque se haya ocultado o borrado del catálogo.
  const nombreServicio = (servicios, id, respaldo) => servicios.find(s => s.id === id)?.nombre ?? respaldo ?? id;
  const textoEstado = (r) => (r.estado === 'cancelada' && r.noLlego ? 'No llegó' : r.anulada ? 'Anulada' : ESTADOS[r.estado]?.texto ?? r.estado);
  const sinId = (doc) => { if (!doc) return doc; const { id, ...resto } = doc; return resto; };

  // Todo espera a que el almacén esté listo. En modo demo, la primera vez se cargan los datos de ejemplo.
  const modo = Almacen.modo;
  const listo = Almacen.iniciar().then(async () => { if (await Almacen.vacio()) await sembrarDemo(); });

  // ---- Configuración del negocio ----
  // Si la base de datos aún no tiene configuración, se usan los archivos de /data.
  async function negocio() {
    await listo;
    return sinId(await Almacen.obtener('config', 'negocio')) ?? cargarJSON('data/negocio.json');
  }
  async function servicios() {
    await listo;
    return (await Almacen.obtener('config', 'servicios'))?.lista ?? cargarJSON('data/servicios.json');
  }
  async function configGuardada() { await listo; return Boolean(await Almacen.obtener('config', 'negocio')); }
  async function guardarNegocio(datos) { await listo; await Almacen.guardar('config', 'negocio', datos); }
  async function guardarServicios(lista) { await listo; await Almacen.guardar('config', 'servicios', { lista }); }
  async function subirConfigInicial() {
    const [n, s] = await Promise.all([cargarJSON('data/negocio.json'), cargarJSON('data/servicios.json')]);
    await guardarNegocio(n);
    await guardarServicios(s);
  }

  // ---- Reservas ----
  const ordenar = (lista) => lista.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  async function reservas({ desde, hasta }) {
    await listo;
    return ordenar(await Almacen.listar('reservas', [['fecha', '>=', desde], ['fecha', '<=', hasta]]));
  }

  // Igual que reservas(), más nombre y teléfono del cliente. Solo para el equipo.
  async function reservasConContacto({ desde, hasta }) {
    await listo;
    const [lista, contactos] = await Promise.all([
      reservas({ desde, hasta }),
      Almacen.listar('contactos', [['fecha', '>=', desde], ['fecha', '<=', hasta]])
    ]);
    const porId = Object.fromEntries(contactos.map(c => [c.id, c]));
    return lista.map(r => ({ ...r, cliente: porId[r.id]?.cliente ?? '', telefono: porId[r.id]?.telefono ?? '', comentario: porId[r.id]?.comentario ?? '' }));
  }

  async function reservasPorPatente(patente) {
    await listo;
    return ordenar(await Almacen.listar('reservas', [['patente', '==', normalizarPatente(patente)]]));
  }

  // Reserva hecha por un cliente desde la web.
  async function crearReserva({ cliente, telefono, comentario = '', ...datos }) {
    await listo;
    const id = idCorto('R');
    const reserva = { ...datos, patente: normalizarPatente(datos.patente), estado: 'pendiente', origen: 'web', creada: new Date().toISOString() };
    await Almacen.lote([
      { coleccion: 'reservas', id, datos: reserva },
      { coleccion: 'contactos', id, datos: { fecha: reserva.fecha, cliente, telefono, comentario } }
    ]);
    return { ...reserva, id, cliente, telefono, comentario };
  }

  // Auto que llega sin reserva: queda directo "en proceso" a cargo de quien lo registra.
  async function registrarAutoSinReserva(trabajador, { cliente = '', telefono = '', ...datos }) {
    await listo;
    const id = nuevoId('L');
    const reserva = {
      ...datos, patente: normalizarPatente(datos.patente),
      fecha: fechaISO(), hora: horaActual(), estado: 'en-proceso', origen: 'local', creada: new Date().toISOString(),
      trabajadorUid: trabajador.uid, trabajadorNombre: trabajador.nombre, inicio: Date.now()
    };
    await Almacen.lote([
      { coleccion: 'reservas', id, datos: reserva },
      { coleccion: 'contactos', id, datos: { fecha: reserva.fecha, cliente, telefono } }
    ]);
    return { ...reserva, id, cliente, telefono };
  }

  async function actualizarReserva(id, cambios) { await listo; await Almacen.actualizar('reservas', id, cambios); }

  // Reservas web que el local aún no confirma al cliente por WhatsApp.
  const porConfirmar = (r) => r.origen === 'web' && !r.confirmada && r.estado === 'pendiente';
  const confirmarReserva = (reserva, autor) => actualizarReserva(reserva.id, { confirmada: Date.now(), confirmadaPor: autor.nombre });
  const cambiarEstado = (id, estado) => actualizarReserva(id, { estado });

  // Minutos de atraso de una reserva pendiente de hoy (0 si no está atrasada).
  function atraso(r, ahora = new Date()) {
    if (r.estado !== 'pendiente' || r.fecha !== fechaISO(ahora)) return 0;
    return Math.max(0, ahora.getHours() * 60 + ahora.getMinutes() - aMinutos(r.hora));
  }

  const marcarNoLlego = (reserva, autor) => actualizarReserva(reserva.id, { estado: 'cancelada', noLlego: true, canceladaPor: autor.nombre });
  const cancelarReserva = (reserva, autor) => actualizarReserva(reserva.id, { estado: 'cancelada', noLlego: null, canceladaPor: autor.nombre });
  const reactivarReserva = (reserva) => actualizarReserva(reserva.id, { estado: 'pendiente', noLlego: null, anulada: null, canceladaPor: null });

  // Dejar asignada una reserva a alguien (antes de empezar), o cambiar quién la tiene a cargo.
  function asignarReserva(reserva, persona) {
    return reserva.estado === 'pendiente'
      ? actualizarReserva(reserva.id, { asignadoUid: persona.uid, asignadoNombre: persona.nombre })
      : actualizarReserva(reserva.id, { trabajadorUid: persona.uid, trabajadorNombre: persona.nombre });
  }

  // Cambiar día u hora: queda "por confirmar" otra vez para avisarle al cliente.
  async function reprogramarReserva(reserva, { fecha, hora }) {
    await listo;
    await actualizarReserva(reserva.id, { fecha, hora, confirmada: null });
    await Almacen.actualizar('contactos', reserva.id, { fecha }).catch(() => {});
  }

  // Antes de tomar un auto se revisa el estado más reciente: otro trabajador pudo tomarlo recién.
  async function iniciarLavado(reserva, trabajador) {
    await listo;
    const actual = await Almacen.obtener('reservas', reserva.id);
    if (!actual) throw new Error('Esta reserva ya no existe.');
    if (actual.estado !== 'pendiente') {
      throw new Error(actual.trabajadorNombre ? `Este auto ya lo tomó ${actual.trabajadorNombre}.` : 'Este auto ya no está pendiente.');
    }
    await actualizarReserva(reserva.id, {
      estado: 'en-proceso', trabajadorUid: trabajador.uid, trabajadorNombre: trabajador.nombre, inicio: Date.now()
    });
  }

  // ---- Deshacer (por si se tocó el botón equivocado) ----
  const deshacerInicio = (reserva) => actualizarReserva(reserva.id, { estado: 'pendiente', trabajadorUid: null, trabajadorNombre: null, inicio: null });
  const anularSinReserva = (reserva) => actualizarReserva(reserva.id, { estado: 'cancelada', anulada: true });
  async function deshacerTermino(reserva, actividad) {
    await actualizarReserva(reserva.id, { estado: 'en-proceso', fin: null });
    if (actividad) await Almacen.borrar('actividades', actividad.id);
  }
  async function deshacerCobro(reserva, actividad) {
    await actualizarReserva(reserva.id, { estado: 'listo', cobrado: null, medioPago: null, entregada: null, motivoAjuste: null });
    if (actividad) await Almacen.borrar('actividades', actividad.id);
  }

  // El lavado se registra a nombre de quien lo tenía a cargo, aunque lo marque otra persona (ej. el dueño).
  async function terminarLavado(reserva, autor) {
    const fin = Date.now();
    const trabajador = reserva.trabajadorUid ? { uid: reserva.trabajadorUid, nombre: reserva.trabajadorNombre } : autor;
    await actualizarReserva(reserva.id, { estado: 'listo', fin, trabajadorUid: trabajador.uid, trabajadorNombre: trabajador.nombre });
    return registrarActividad(trabajador, {
      tipo: 'lavado', reservaId: reserva.id, patente: reserva.patente, servicioId: reserva.servicioId, servicioNombre: reserva.servicioNombre,
      vehiculo: reserva.vehiculo, minutos: reserva.inicio ? Math.max(1, Math.round((fin - reserva.inicio) / 60000)) : null
    }, autor);
  }

  // El cobro queda a nombre de quien recibe el dinero.
  // motivo: por qué se cobró distinto al precio de lista (descuento, cortesía, etc.).
  async function cobrar(reserva, { monto, medioPago, motivo }, autor) {
    await actualizarReserva(reserva.id, { estado: 'entregado', cobrado: monto, medioPago, entregada: Date.now(), motivoAjuste: motivo || null });
    return registrarActividad(autor, {
      tipo: 'cobro', reservaId: reserva.id, patente: reserva.patente, servicioId: reserva.servicioId, servicioNombre: reserva.servicioNombre,
      monto, medioPago, motivo: motivo || undefined, precioLista: reserva.precio
    });
  }

  // Corregir un cobro desde Actividad: cambia el registro y la reserva a la vez, para que caja y "Cobrado" cuadren.
  async function editarCobro(actividad, { monto, medioPago }) {
    await listo;
    await Almacen.actualizar('actividades', actividad.id, { monto, medioPago });
    if (actividad.reservaId) await actualizarReserva(actividad.reservaId, { cobrado: monto, medioPago }).catch(() => {});
  }

  // ---- Actividades del equipo ----
  async function actividades({ desde, hasta, uid } = {}) {
    await listo;
    // Por persona se filtra solo por uid y las fechas se filtran aquí: así Firebase no pide índices extra.
    const filtros = uid ? [['uid', '==', uid]] : [['fecha', '>=', desde], ['fecha', '<=', hasta]];
    const lista = await Almacen.listar('actividades', filtros);
    return lista
      .filter(a => (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta))
      .sort((a, b) => b.ts - a.ts);
  }

  // autor = quien aprieta el botón; si no es el trabajador, queda anotado.
  async function registrarActividad(trabajador, datos, autor = trabajador) {
    await listo;
    const ahora = new Date();
    const actividad = { ...datos, uid: trabajador.uid, nombre: trabajador.nombre, fecha: fechaISO(ahora), hora: horaActual(), ts: ahora.getTime() };
    if (autor.uid !== trabajador.uid) actividad.registradoPor = autor.nombre;
    const id = nuevoId('A');
    await Almacen.guardar('actividades', id, actividad);
    return { ...actividad, id };
  }

  // Al borrar un cobro, la reserva vuelve a "Listo" sin monto: así la caja y "Cobrado" siguen cuadrando.
  async function borrarActividad(actividad) {
    await listo;
    await Almacen.borrar('actividades', actividad.id);
    if (actividad.tipo === 'cobro' && actividad.reservaId) {
      await actualizarReserva(actividad.reservaId, { estado: 'listo', cobrado: null, medioPago: null, entregada: null }).catch(() => {});
    }
  }

  const esMarca = (a) => a.tipo === 'entrada' || a.tipo === 'salida';

  // Minutos trabajados: suma de cada par entrada → salida por persona y día. Un turno abierto de hoy cuenta hasta ahora.
  function minutosTrabajados(lista) {
    const hoy = fechaISO();
    const grupos = {};
    lista.filter(esMarca).sort((a, b) => a.ts - b.ts).forEach(a => { (grupos[a.uid + a.fecha] ??= []).push(a); });
    let total = 0;
    Object.values(grupos).forEach(marcas => {
      let inicio = null;
      marcas.forEach(m => {
        if (m.tipo === 'entrada') inicio ??= m.ts;
        else if (inicio != null) { total += m.ts - inicio; inicio = null; }
      });
      if (inicio != null && marcas[0].fecha === hoy) total += Date.now() - inicio;
    });
    return Math.round(total / 60000);
  }

  // Turno de hoy de una persona: manda la última marca (entrada o salida).
  function turnoDeHoy(lista, uid) {
    const hoy = fechaISO();
    const ultima = lista.filter(a => a.uid === uid && a.fecha === hoy && esMarca(a)).sort((a, b) => a.ts - b.ts).at(-1);
    const enTurno = ultima?.tipo === 'entrada';
    return { enTurno, desde: enTurno ? ultima.hora : null };
  }

  // ¿Hay algún turno de hoy sin marcar salida? (para aclarar que las horas incluyen turnos en curso)
  const hayTurnosAbiertos = (lista) => [...new Set(lista.map(a => a.uid))].some(uid => turnoDeHoy(lista, uid).enTurno);

  // ---- Sesión ----
  let usuarioEnCache = null;
  const usuarioActual = () => (usuarioEnCache ??= leerUsuario());

  async function leerUsuario() {
    await listo;
    const sesion = await Almacen.sesion();
    if (!sesion) return null;
    let perfil = await Almacen.obtener('usuarios', sesion.uid).catch(() => null);
    if (!perfil && modo === 'nube') {
      // Primer ingreso del dueño principal: las reglas de Firebase solo se lo permiten al correo configurado como dueño.
      const nuevo = { nombre: 'Dueño', email: sesion.email, rol: 'dueno', activo: true, creado: new Date().toISOString() };
      try { await Almacen.guardar('usuarios', sesion.uid, nuevo); perfil = nuevo; } catch { /* no es el dueño principal */ }
    }
    if (!perfil) return { uid: sesion.uid, email: sesion.email, sinAcceso: true };
    const datos = sinId(perfil);
    return { ...datos, uid: sesion.uid, sinAcceso: !datos.activo };
  }

  const pantallaDe = (u) => (u.rol === 'dueno' ? 'dueno.html' : 'trabajador.html');

  async function ingresar(email, clave) {
    await listo;
    await Almacen.ingresar(email.trim(), clave);
    usuarioEnCache = null;
    const u = await usuarioActual();
    if (u.sinAcceso) {
      await salir();
      throw new Error('Tu cuenta no tiene acceso a la app. Pídele al dueño que te habilite.');
    }
    return u;
  }

  async function salir() { await listo; await Almacen.salir(); usuarioEnCache = null; }

  // Para pantallas privadas: sin sesión o sin permiso, manda al ingreso. La promesa no termina mientras redirige.
  async function exigirSesion(roles) {
    const u = await usuarioActual();
    if (!u || u.sinAcceso || !roles.includes(u.rol)) {
      location.replace(u ? 'ingreso.html?error=acceso' : 'ingreso.html');
      return new Promise(() => {});
    }
    return u;
  }

  async function recuperarClave(email) { await listo; await Almacen.recuperarClave(email.trim()); }

  // ---- Equipo ----
  async function equipo() {
    await listo;
    return (await Almacen.listar('usuarios'))
      .map(({ id, ...u }) => ({ ...u, uid: id }))
      .sort((a, b) => (a.rol === b.rol ? 0 : a.rol === 'dueno' ? -1 : 1) || a.nombre.localeCompare(b.nombre));
  }

  async function agregarMiembro({ nombre, email, clave, rol }) {
    await listo;
    const correo = email.trim().toLowerCase();
    const uid = await Almacen.crearCuenta(correo, clave);
    const perfil = { nombre: nombre.trim(), email: correo, rol, activo: true, creado: new Date().toISOString() };
    await Almacen.guardar('usuarios', uid, perfil);
    return { ...perfil, uid };
  }

  async function actualizarMiembro(uid, cambios) {
    await listo;
    await Almacen.actualizar('usuarios', uid, cambios);
    usuarioEnCache = null;
  }

  // ---- Modo demo ----
  async function sembrarDemo() {
    const [neg, serv, reservasDemo, equipoDemo] = await Promise.all(
      ['negocio', 'servicios', 'reservas-demo', 'equipo-demo'].map(n => cargarJSON(`data/${n}.json`)));
    await Almacen.guardar('config', 'negocio', neg);
    await Almacen.guardar('config', 'servicios', { lista: serv });

    for (const { clave, uid, ...perfil } of equipoDemo) {
      await Almacen.crearCuenta(perfil.email, clave, uid);
      await Almacen.guardar('usuarios', uid, { ...perfil, activo: true, creado: new Date().toISOString() });
    }
    const persona = (i) => ({ uid: equipoDemo[i].uid, nombre: equipoDemo[i].nombre });
    const hoy = fechaISO();
    const actividad = (p, fecha, hora, datos) => Almacen.guardar('actividades', nuevoId('A'),
      { ...datos, uid: p.uid, nombre: p.nombre, fecha, hora, ts: marcaTiempo(fecha, hora) });

    // Asistencia de ejemplo: ayer turno completo, hoy en turno desde la mañana.
    for (const [i, m] of equipoDemo.entries()) {
      if (m.rol !== 'trabajador') continue;
      await actividad(persona(i), sumarDias(hoy, -1), '08:55', { tipo: 'entrada' });
      await actividad(persona(i), sumarDias(hoy, -1), '19:05', { tipo: 'salida' });
      await actividad(persona(i), hoy, '08:52', { tipo: 'entrada' });
    }

    // Las reservas demo usan "dia" relativo a hoy (0 = hoy, -1 = ayer) y "trabajador" = posición en equipo-demo.json.
    let n = 0;
    for (const { dia = 0, trabajador, cliente, telefono, porConfirmar: sinConfirmar, ...r } of reservasDemo) {
      const fecha = sumarDias(hoy, dia);
      const duracionMin = serv.find(s => s.id === r.servicioId)?.duracionMin ?? 30;
      // Las de ejemplo quedan confirmadas, salvo las marcadas "porConfirmar" (para mostrar ese aviso en la demo).
      const reserva = { ...r, fecha, duracionMin, origen: 'web', creada: new Date().toISOString(),
        confirmada: sinConfirmar ? undefined : marcaTiempo(fecha, '08:00') };
      if (trabajador != null && r.estado !== 'pendiente' && r.estado !== 'cancelada') {
        const p = persona(trabajador);
        Object.assign(reserva, { trabajadorUid: p.uid, trabajadorNombre: p.nombre, inicio: marcaTiempo(fecha, r.hora) });
        if (r.estado !== 'en-proceso') {
          const fin = aHora(aMinutos(r.hora) + duracionMin);
          reserva.fin = marcaTiempo(fecha, fin);
          await actividad(p, fecha, fin, { tipo: 'lavado', reservaId: r.id, patente: r.patente, servicioId: r.servicioId, vehiculo: r.vehiculo, minutos: duracionMin });
        }
        if (r.estado === 'entregado') {
          const medioPago = neg.mediosPago[n++ % neg.mediosPago.length];
          Object.assign(reserva, { cobrado: r.precio, medioPago });
          await actividad(p, fecha, aHora(aMinutos(r.hora) + duracionMin + 10),
            { tipo: 'cobro', reservaId: r.id, patente: r.patente, servicioId: r.servicioId, monto: r.precio, medioPago });
        }
      }
      await Almacen.guardar('reservas', r.id, reserva);
      await Almacen.guardar('contactos', r.id, { fecha, cliente, telefono });
    }
  }

  // Vuelve a los datos de ejemplo (útil antes de una demostración). Solo modo demo.
  async function reiniciarDemo() {
    await listo;
    await Almacen.borrarTodo();
    await sembrarDemo();
    usuarioEnCache = null;
  }

  // ---- Horario ----
  // Horario de un día. Usa el horario por día (horario.dias, clave = 0 domingo … 6 sábado) y, si no existe, el general.
  function horarioDelDia(negocio, fecha) {
    const h = negocio.horario;
    const d = new Date(fecha + 'T12:00:00').getDay();
    const propio = h.dias?.[d];
    if (propio) return { abierto: Boolean(propio.abierto), apertura: propio.apertura || h.apertura, cierre: propio.cierre || h.cierre };
    return { abierto: !(h.diasCerrado ?? []).includes(d), apertura: h.apertura, cierre: h.cierre };
  }

  function estaAbierto(negocio, ahora = new Date()) {
    const h = horarioDelDia(negocio, fechaISO(ahora));
    const m = ahora.getHours() * 60 + ahora.getMinutes();
    return h.abierto && m >= aMinutos(h.apertura) && m < aMinutos(h.cierre) ? h : null;
  }

  // Próxima apertura, para avisos como "abre mañana a las 09:00". enDias: 0 hoy, 1 mañana…
  function proximaApertura(negocio, ahora = new Date()) {
    const m = ahora.getHours() * 60 + ahora.getMinutes();
    for (let i = 0; i < 8; i++) {
      const fecha = sumarDias(fechaISO(ahora), i);
      const h = horarioDelDia(negocio, fecha);
      if (!h.abierto || (i === 0 && m >= aMinutos(h.apertura))) continue;
      return { fecha, hora: h.apertura, enDias: i };
    }
    return null;
  }

  // ---- Disponibilidad ----
  // Un horario está libre si, durante toda la duración del servicio, hay menos autos que la capacidad del local.
  // excluirId: la reserva que se está reprogramando no cuenta como ocupada.
  function horariosDisponibles({ negocio, servicios, reservas, fecha, duracionMin, excluirId }) {
    const { intervaloMin } = negocio.horario;
    const { abierto, apertura, cierre } = horarioDelDia(negocio, fecha);
    if (!abierto) return [];

    const duracionDe = (r) => r.duracionMin ?? servicios.find(s => s.id === r.servicioId)?.duracionMin ?? 30;
    const ocupadas = reservas
      .filter(r => r.fecha === fecha && r.estado !== 'cancelada' && r.id !== excluirId)
      .map(r => ({ ini: aMinutos(r.hora), fin: aMinutos(r.hora) + duracionDe(r) }));

    const ahora = new Date();
    const minimo = fecha === fechaISO(ahora) ? ahora.getHours() * 60 + ahora.getMinutes() : -1;

    const libres = [];
    for (let ini = aMinutos(apertura); ini + duracionMin <= aMinutos(cierre); ini += intervaloMin) {
      if (ini <= minimo) continue;
      const fin = ini + duracionMin;
      const cruces = ocupadas.filter(o => o.ini < fin && o.fin > ini).length;
      if (cruces < negocio.capacidadSimultanea) libres.push(aHora(ini));
    }
    return libres;
  }

  // ---- Ocupación del local en un rato ----
  // Autos que ocupan el local (pendientes y en proceso) entre desdeMin y desdeMin + duracionMin.
  // ahoraMin (solo hoy): un lavado que se pasa del tiempo sigue ocupando, y una reserva con más de
  // TOLERANCIA_ATRASO minutos de atraso deja de contar (el cliente no llegó).
  // incluirHechos: agrega los autos ya lavados (solo para mostrarlos en la agenda; no ocupan lugar).
  function tramosDelDia({ reservas, servicios, fecha, ahoraMin = null, incluirHechos = false }) {
    const minutoDe = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };
    return reservas
      .filter(r => r.fecha === fecha && (r.estado === 'pendiente' || r.estado === 'en-proceso'
        || (incluirHechos && (r.estado === 'listo' || r.estado === 'entregado'))))
      .map(r => {
        const dur = r.duracionMin ?? servicios.find(s => s.id === r.servicioId)?.duracionMin ?? 30;
        let ini = r.inicio && r.estado !== 'pendiente' ? minutoDe(r.inicio) : aMinutos(r.hora);
        let fin = r.fin && (r.estado === 'listo' || r.estado === 'entregado') ? Math.max(minutoDe(r.fin), ini + 1) : ini + dur;
        if (ahoraMin != null && r.estado === 'en-proceso') fin = Math.max(fin, ahoraMin + 5);
        if (ahoraMin != null && r.estado === 'pendiente' && ahoraMin > aMinutos(r.hora) + TOLERANCIA_ATRASO) return null;
        return { reserva: r, ini, fin, hecho: r.estado === 'listo' || r.estado === 'entregado' };
      })
      .filter(Boolean);
  }

  function ocupacionEntre({ desdeMin, duracionMin, ...datos }) {
    const finMin = desdeMin + duracionMin;
    const tramos = tramosDelDia({ ...datos, incluirHechos: false }).filter(t => t.ini < finMin && t.fin > desdeMin);
    // El momento más lleno está al inicio o cuando empieza alguna reserva dentro del rato.
    const momentos = [desdeMin, ...tramos.map(t => t.ini).filter(m => m > desdeMin)];
    let maximo = 0, momentoLleno = desdeMin;
    momentos.forEach(m => {
      const n = tramos.filter(t => t.ini <= m && t.fin > m).length;
      if (n > maximo) { maximo = n; momentoLleno = m; }
    });
    return { maximo, momentoLleno: aHora(momentoLleno), tramos };
  }

  // Primera hora (desde ahora, en pasos del intervalo) en que cabe un lavado de duracionMin, antes del cierre.
  function proximoLugarLibre({ negocio, reservas, servicios, fecha, ahoraMin, duracionMin }) {
    const { intervaloMin } = negocio.horario;
    const { abierto, cierre } = horarioDelDia(negocio, fecha);
    if (!abierto) return null;
    let m = Math.ceil((ahoraMin + 1) / intervaloMin) * intervaloMin;
    for (; m + duracionMin <= aMinutos(cierre); m += intervaloMin) {
      const o = ocupacionEntre({ reservas, servicios, fecha, ahoraMin, desdeMin: m, duracionMin });
      if (o.maximo < negocio.capacidadSimultanea) return aHora(m);
    }
    return null;
  }

  return {
    modo, ESTADOS, ESTADOS_CLIENTE, TIPOS_ACTIVIDAD, ROLES, TOLERANCIA_ATRASO, tramosDelDia, ocupacionEntre, proximoLugarLibre, aMinutos, aHora,
    horarioDelDia, estaAbierto, proximaApertura, nombreServicio, textoEstado, atraso,
    negocio, servicios, configGuardada, guardarNegocio, guardarServicios, subirConfigInicial,
    reservas, reservasConContacto, reservasPorPatente, crearReserva, registrarAutoSinReserva,
    actualizarReserva, cambiarEstado, porConfirmar, confirmarReserva, iniciarLavado, terminarLavado, cobrar,
    marcarNoLlego, cancelarReserva, reactivarReserva, asignarReserva, reprogramarReserva,
    deshacerInicio, anularSinReserva, deshacerTermino, deshacerCobro, editarCobro,
    actividades, registrarActividad, borrarActividad, minutosTrabajados, turnoDeHoy, hayTurnosAbiertos,
    usuarioActual, ingresar, salir, exigirSesion, pantallaDe, recuperarClave,
    equipo, agregarMiembro, actualizarMiembro, reiniciarDemo,
    horariosDisponibles, fechaISO, sumarDias, horaActual, dinero, formatoHoras, escapar, normalizarPatente
  };
})();
