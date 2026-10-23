/* Inicio del cliente: datos del local y reserva paso a paso (día → vehículo → lavado → hora → datos). */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  const DIAS_MAX = 60; // hasta cuántos días adelante se puede reservar
  const TITULOS = ['¿Qué día quieres venir?', '¿Qué vehículo traes?', '¿Qué lavado necesitas?', '¿A qué hora?', 'Tus datos'];
  const CONFIRMADA = TITULOS.length; // paso final, después de reservar
  const CLAVE_BORRADOR = 'lavado.reserva.borrador'; // lo elegido, por si se recarga la página
  const CLAVE_MIAS = 'lavado.mis-reservas';        // reservas hechas desde este celular (para recordarlas)

  let negocio, servicios;
  try {
    [negocio, servicios] = await Promise.all([Datos.negocio(), Datos.servicios()]);
  } catch {
    $('#paso-contenido').innerHTML = '<div class="aviso">No pudimos cargar la información. Revisa tu conexión y vuelve a intentar.</div>';
    return;
  }
  // Lo que el dueño ocultó no se ofrece para reservar.
  const serviciosVisibles = servicios.filter(s => !s.oculto);
  const vehiculosVisibles = negocio.tiposVehiculo.filter(v => !v.oculto);

  const leer = (clave, almacen = localStorage) => { try { return JSON.parse(almacen.getItem(clave)); } catch { return null; } };
  const guardar = (clave, valor, almacen = localStorage) => { try { almacen.setItem(clave, JSON.stringify(valor)); } catch { /* sin acceso */ } };

  // ===== Datos del local =====
  const textos = { nombre: negocio.nombre, eslogan: negocio.eslogan, direccion: negocio.direccion, telefono: negocio.telefono, horario: negocio.horario.texto };
  document.querySelectorAll('[data-negocio]').forEach(el => { el.textContent = textos[el.dataset.negocio] ?? ''; });
  document.title = negocio.nombre;
  const enlaceTelefono = `tel:${negocio.telefono.replace(/\s/g, '')}`;
  const enlaceMapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(negocio.direccion)}`;
  $('#enlace-telefono').href = enlaceTelefono;
  $('#acceso-llamar').href = enlaceTelefono;
  $('#acceso-whatsapp').href = `https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola ${negocio.nombre}, quisiera consultar por un lavado.`)}`;
  // Solo la dirección: con el nombre del local, Google Maps a veces no encuentra el punto exacto.
  $('#acceso-mapa').href = enlaceMapa;
  $('#aviso-demo').hidden = Datos.modo !== 'demo';

  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const nombreDia = (fecha) => new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long' });

  // "Abierto · cierra 19:00" o "Cerrado ahora · abre mañana 09:00"
  function pintarEstadoLocal() {
    const el = $('#estado-local');
    const abierto = Datos.estaAbierto(negocio);
    el.classList.toggle('abierto', Boolean(abierto));
    if (abierto) { el.textContent = `Abierto · cierra ${abierto.cierre}`; return; }
    const p = Datos.proximaApertura(negocio);
    const cuando = !p ? '' : p.enDias === 0 ? `hoy ${p.hora}` : p.enDias === 1 ? `mañana ${p.hora}` : `el ${nombreDia(p.fecha)} ${p.hora}`;
    el.textContent = `Cerrado ahora${cuando ? ` · abre ${cuando}` : ''} · puedes reservar igual`;
  }
  pintarEstadoLocal();
  setInterval(pintarEstadoLocal, 60000);

  // ===== Disponibilidad =====
  const hoy = Datos.fechaISO();
  const limite = Datos.sumarDias(hoy, DIAS_MAX);
  const estado = { paso: 0, mes: hoy.slice(0, 7), fecha: null, vehiculo: null, servicioId: null, hora: null, datos: {}, reserva: null, reservas: [] };

  try { estado.reservas = await Datos.reservas({ desde: hoy, hasta: limite }); } catch { /* se muestran todas las horas como libres */ }

  // Vuelve a consultar un día justo antes de mostrar o confirmar horas (otro cliente pudo reservar).
  async function refrescarDia(fecha) {
    const delDia = await Datos.reservas({ desde: fecha, hasta: fecha });
    estado.reservas = [...estado.reservas.filter(r => r.fecha !== fecha), ...delDia];
  }

  const servicioActual = () => servicios.find(s => s.id === estado.servicioId);
  const nombreVehiculo = (id) => negocio.tiposVehiculo.find(v => v.id === id)?.nombre ?? id;
  const libres = (fecha, duracionMin) => Datos.horariosDisponibles({
    negocio, servicios, reservas: estado.reservas.filter(r => r.fecha === fecha), fecha, duracionMin
  });
  const duracionMinima = Math.min(...serviciosVisibles.map(s => s.duracionMin || 30));
  const textoFecha = (f, opciones = { weekday: 'long', day: 'numeric', month: 'long' }) =>
    mayuscula(new Date(f + 'T12:00:00').toLocaleDateString('es-CL', opciones));
  const textoDuracion = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

  const contenido = (html) => { $('#paso-contenido').innerHTML = html; };

  // ===== Recordatorio de la próxima reserva hecha en este celular =====
  function pintarMiProxima() {
    const mias = (leer(CLAVE_MIAS) ?? []).filter(r => r.fecha >= hoy).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    const r = mias[0];
    const caja = $('#mi-proxima');
    caja.hidden = !r || estado.paso === CONFIRMADA;
    if (!r) return;
    caja.href = `cliente.html?patente=${encodeURIComponent(r.patente)}#estado`;
    caja.innerHTML = `
      <svg class="icono" aria-hidden="true"><use href="#i-calendario"></use></svg>
      <span><strong>Tu próxima hora: ${esc(UI_textoDia(r.fecha))}, ${esc(r.hora)} h</strong><br>
      <span class="texto-2">${esc(r.servicio)} · ${esc(r.patente)} · Toca para ver el estado</span></span>`;
  }
  const UI_textoDia = (f) => (f === hoy ? 'Hoy' : f === Datos.sumarDias(hoy, 1) ? 'Mañana' : textoFecha(f, { weekday: 'long', day: 'numeric', month: 'short' }));

  // ===== Paso 1: día =====
  function motivoBloqueo(f) {
    if (f < hoy) return 'Ese día ya pasó.';
    if (f > limite) return `Puedes reservar hasta ${DIAS_MAX} días adelante.`;
    const h = Datos.horarioDelDia(negocio, f);
    if (!h.abierto) {
      const dia = nombreDia(f);
      return `Los ${dia.endsWith('s') ? dia : dia + 's'} el local está cerrado. Elige otro día.`; // "los domingos", "los lunes"
    }
    if (f === hoy) {
      const ahora = new Date();
      if (ahora.getHours() * 60 + ahora.getMinutes() >= Datos.aMinutos(h.cierre) - duracionMinima) return `Hoy ya cerramos (${h.cierre}). Elige mañana u otro día.`;
    }
    if (!libres(f, duracionMinima).length) return 'Ese día ya no quedan horas libres. Elige otro día.';
    return '';
  }

  function pintarCalendario() {
    const [y, m] = estado.mes.split('-').map(Number);
    const primero = new Date(y, m - 1, 1);
    const diasMes = new Date(y, m, 0).getDate();
    const huecos = (primero.getDay() + 6) % 7; // la semana parte el lunes
    const nombreMes = mayuscula(primero.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }));

    let celdas = '<span aria-hidden="true"></span>'.repeat(huecos);
    for (let d = 1; d <= diasMes; d++) {
      const f = `${estado.mes}-${String(d).padStart(2, '0')}`;
      const bloqueo = motivoBloqueo(f);
      const h = Datos.horarioDelDia(negocio, f);
      let clase = 'libre', etiqueta = f === hoy ? 'Hoy' : '';
      if (f < hoy || f > limite) { clase = 'fuera'; etiqueta = ''; }
      else if (!h.abierto || (f === hoy && bloqueo.startsWith('Hoy ya'))) { clase = 'cerrado'; etiqueta = 'Cerrado'; }
      else if (bloqueo) { clase = 'lleno'; etiqueta = 'Lleno'; }
      celdas += `
        <button type="button" class="dia ${clase}" data-fecha="${f}" ${bloqueo ? 'aria-disabled="true"' : ''}
                aria-pressed="${f === estado.fecha}" aria-label="${esc(textoFecha(f))}${bloqueo ? `, ${esc(bloqueo)}` : ', disponible'}">
          <span class="dia-n">${d}</span>${etiqueta ? `<span class="dia-etq">${etiqueta}</span>` : ''}
        </button>`;
    }
    contenido(`
      <div class="calendario-cabecera">
        <button type="button" class="btn btn-secundario btn-icono" data-mes="-1" aria-label="Mes anterior" ${estado.mes <= hoy.slice(0, 7) ? 'disabled' : ''}>
          <svg class="icono" aria-hidden="true"><use href="#i-izquierda"></use></svg>
        </button>
        <strong>${esc(nombreMes)}</strong>
        <button type="button" class="btn btn-secundario btn-icono" data-mes="1" aria-label="Mes siguiente" ${estado.mes >= limite.slice(0, 7) ? 'disabled' : ''}>
          <svg class="icono" aria-hidden="true"><use href="#i-derecha"></use></svg>
        </button>
      </div>
      <div class="calendario-semana" aria-hidden="true">${['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="calendario" role="group" aria-label="${esc(nombreMes)}">${celdas}</div>
      <p class="aviso-dia" id="aviso-dia" role="status" hidden></p>
      <p class="texto-2 calendario-nota">${esc(negocio.horario.texto)}</p>`);
  }

  function moverMes(delta) {
    const [y, m] = estado.mes.split('-').map(Number);
    const f = new Date(y, m - 1 + delta, 1);
    estado.mes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
    pintarCalendario();
  }

  // ===== Paso 2: vehículo =====
  function pintarVehiculos() {
    contenido(`<div class="opciones-grandes">${vehiculosVisibles.map(v => {
      const precios = serviciosVisibles.map(s => s.precios[v.id]).filter(Boolean);
      return `
        <button type="button" class="opcion-grande" data-vehiculo="${esc(v.id)}" aria-pressed="${v.id === estado.vehiculo}">
          <svg class="icono" aria-hidden="true"><use href="#i-auto"></use></svg>
          <span class="opcion-titulo">${esc(v.nombre)}</span>
          ${precios.length ? `<span class="opcion-sub">desde ${Datos.dinero(Math.min(...precios))}</span>` : ''}
        </button>`;
    }).join('')}</div>`);
  }

  // ===== Paso 3: lavado =====
  function pintarServicios() {
    const opciones = serviciosVisibles.filter(s => s.precios[estado.vehiculo]);
    contenido(`<div class="grilla">${opciones.map(s => {
      const hayHoras = libres(estado.fecha, s.duracionMin).length > 0;
      return `
        <button type="button" class="opcion-servicio ${s.destacado ? 'destacado' : ''}" data-servicio="${esc(s.id)}"
                aria-pressed="${s.id === estado.servicioId}" ${hayHoras ? '' : 'disabled'}>
          ${s.destacado ? '<span class="etiqueta-destacado">Más pedido</span>' : ''}
          <span class="opcion-fila">
            <span class="opcion-titulo">${esc(s.nombre)}</span>
            <span class="opcion-precio">${Datos.dinero(s.precios[estado.vehiculo])}</span>
          </span>
          ${s.descripcion ? `<span class="opcion-desc">${esc(s.descripcion)}</span>` : ''}
          <span class="duracion"><svg class="icono" aria-hidden="true"><use href="#i-reloj"></use></svg>
            Demora ${esc(textoDuracion(s.duracionMin))} aprox.${hayHoras ? '' : ' · Ya no hay horas este día'}</span>
        </button>`;
    }).join('') || '<p class="texto-2">No hay servicios para este vehículo. Escríbenos por WhatsApp.</p>'}</div>`);
  }

  // ===== Paso 4: hora =====
  async function pintarHoras() {
    contenido('<p class="texto-2">Buscando horas libres…</p>');
    try { await refrescarDia(estado.fecha); } catch { /* se usa lo ya cargado */ }
    if (estado.paso !== 3) return; // el cliente ya se movió de paso
    const horas = libres(estado.fecha, servicioActual().duracionMin);
    const grupo = (titulo, lista) => lista.length ? `
      <h3 class="grupo-horas">${titulo}</h3>
      <div class="horarios">${lista.map(h => `<button type="button" data-hora="${h}" aria-pressed="${h === estado.hora}">${h}</button>`).join('')}</div>` : '';
    contenido(horas.length
      ? grupo('Mañana', horas.filter(h => h < '13:00')) + grupo('Tarde', horas.filter(h => h >= '13:00'))
      : `<p class="horarios-vacio">Ya no quedan horas este día para este lavado.</p>
         <button type="button" class="btn btn-secundario" data-ir="0">Elegir otro día</button>`);
  }

  // ===== Paso 5: datos =====
  function pintarDatos() {
    const s = servicioActual();
    const d = estado.datos;
    contenido(`
      <form id="form-datos" novalidate>
        <div class="campo">
          <label for="f-nombre">Nombre</label>
          <input type="text" id="f-nombre" name="nombre" autocomplete="name" required value="${esc(d.nombre ?? '')}">
          <span class="error" id="e-nombre"></span>
        </div>
        <div class="campo">
          <label for="f-telefono">WhatsApp</label>
          <input type="tel" id="f-telefono" name="telefono" autocomplete="tel" inputmode="tel" placeholder="9 1234 5678" required value="${esc(d.telefono ?? '')}">
          <span class="ayuda">Aquí te confirmamos la hora y te avisamos cuando tu auto esté listo.</span>
          <span class="error" id="e-telefono"></span>
        </div>
        <div class="campo">
          <label for="f-patente">Patente</label>
          <input type="text" id="f-patente" name="patente" autocapitalize="characters" maxlength="8" placeholder="KJTR34" required value="${esc(d.patente ?? '')}">
          <span class="ayuda">Con ella puedes ver el estado de tu auto.</span>
          <span class="error" id="e-patente"></span>
        </div>
        <div class="campo">
          <label for="f-comentario">Comentario <span class="texto-2">(opcional)</span></label>
          <textarea id="f-comentario" name="comentario" rows="2" maxlength="300" placeholder="Ej.: tiene pelos de mascota, mucho barro, sillas de niño">${esc(d.comentario ?? '')}</textarea>
        </div>
        <div class="resumen">
          <div class="texto-2">Total a pagar en el local</div>
          <div class="total">${Datos.dinero(s.precios[estado.vehiculo])}</div>
        </div>
        <span class="error" id="e-reserva" role="alert"></span>
        <button type="submit" class="btn btn-primario btn-bloque btn-grande">
          <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg> Reservar hora
        </button>
      </form>`);
  }

  function validarDatos(form) {
    const d = estado.datos;
    const reglas = [
      ['nombre', (d.nombre ?? '').trim().length >= 2, 'Escribe tu nombre.'],
      ['telefono', (d.telefono ?? '').replace(/\D/g, '').length >= 8, 'Escribe un número válido (ej.: 9 1234 5678).'],
      ['patente', /^[A-Z0-9]{5,8}$/.test(Datos.normalizarPatente(d.patente)), 'Escribe la patente (ej.: KJTR34).']
    ];
    let primero = null;
    reglas.forEach(([campo, ok, msj]) => {
      form[campo].setAttribute('aria-invalid', String(!ok));
      $(`#e-${campo}`).textContent = ok ? '' : msj;
      if (!ok) primero ??= form[campo];
    });
    primero?.focus();
    return !primero;
  }

  async function confirmar(form) {
    const boton = form.querySelector('[type="submit"]');
    const s = servicioActual();
    const patente = Datos.normalizarPatente(estado.datos.patente);
    // Aviso si esa patente ya tiene una hora ese mismo día (reserva duplicada por error).
    const repetida = estado.reservas.find(r => r.patente === patente && r.fecha === estado.fecha && r.estado !== 'cancelada');
    if (repetida && !confirm(`Ya tienes una hora para la patente ${patente} ese día a las ${repetida.hora}. ¿Quieres reservar otra?`)) return;
    boton.disabled = true;
    $('#e-reserva').textContent = '';
    try {
      await refrescarDia(estado.fecha);
      if (!libres(estado.fecha, s.duracionMin).includes(estado.hora)) {
        $('#e-reserva').innerHTML = 'Esa hora se acaba de ocupar. <button type="button" class="enlace" data-ir="3">Elegir otra hora</button>';
        boton.disabled = false;
        return;
      }
      estado.reserva = await Datos.crearReserva({
        fecha: estado.fecha,
        hora: estado.hora,
        servicioId: s.id,
        servicioNombre: s.nombre,
        vehiculo: estado.vehiculo,
        cliente: estado.datos.nombre.trim(),
        telefono: UI.telefonoWhatsApp(estado.datos.telefono),
        patente,
        comentario: (estado.datos.comentario ?? '').trim(),
        precio: s.precios[estado.vehiculo], // se guardan el precio y la duración del momento de la reserva
        duracionMin: s.duracionMin
      });
      estado.reservas.push(estado.reserva);
      const r = estado.reserva;
      guardar(CLAVE_MIAS, [...(leer(CLAVE_MIAS) ?? []).filter(x => x.fecha >= hoy), { id: r.id, patente: r.patente, fecha: r.fecha, hora: r.hora, servicio: s.nombre }]);
      irA(CONFIRMADA, { reemplazar: true });
    } catch {
      $('#e-reserva').textContent = 'No pudimos guardar tu reserva. Revisa tu conexión y vuelve a intentar.';
      boton.disabled = false;
    }
  }

  // Enlace para agregar la hora al calendario de Google del cliente.
  function enlaceCalendario(r, s) {
    const fin = Datos.aHora(Datos.aMinutos(r.hora) + (s.duracionMin || 60));
    const sello = (hora) => `${r.fecha.replaceAll('-', '')}T${hora.replace(':', '')}00`;
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: `${s.nombre} en ${negocio.nombre}`, dates: `${sello(r.hora)}/${sello(fin)}`,
      ctz: 'America/Santiago', location: negocio.direccion, details: `Patente ${r.patente} · N° de reserva ${r.id}`
    });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  // ===== Reserva hecha =====
  function pintarConfirmacion() {
    const r = estado.reserva;
    const s = servicioActual();
    // 56912345678 → +56 9 1234 5678, para que el cliente reconozca su número
    const numero = /^569\d{8}$/.test(r.telefono) ? `+56 9 ${r.telefono.slice(3, 7)} ${r.telefono.slice(7)}` : r.telefono;
    const medios = (negocio.mediosPago ?? []).join(', ').replace(/, ([^,]*)$/, ' o $1').toLowerCase();
    contenido(`
      <div class="aviso exito confirmacion" role="status">
        <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg>
        <div>
          <strong>Tu hora quedó tomada, ${esc(r.cliente.split(' ')[0])}.</strong><br>
          ${esc(textoFecha(r.fecha))}, ${esc(r.hora)} h<br>
          ${esc(s.nombre)} · ${esc(nombreVehiculo(r.vehiculo))} · Patente <span class="patente">${esc(r.patente)}</span><br>
          <strong>${Datos.dinero(r.precio)}</strong> <span class="texto-2">· se paga en el local</span>
        </div>
      </div>
      <div class="aviso-whatsapp">
        <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg>
        <span>No tienes que hacer nada más. Te enviaremos un WhatsApp al <strong>${esc(numero)}</strong> para confirmarte.</span>
      </div>
      <ul class="datos-utiles">
        <li><svg class="icono" aria-hidden="true"><use href="#i-reloj"></use></svg> Demora ${esc(textoDuracion(s.duracionMin))} aprox. Llega 5 minutos antes.</li>
        ${medios ? `<li><svg class="icono" aria-hidden="true"><use href="#i-dinero"></use></svg> Pagas al retirar: ${esc(medios)}.</li>` : ''}
        <li><svg class="icono" aria-hidden="true"><use href="#i-ubicacion"></use></svg> <a href="${esc(enlaceMapa)}" target="_blank" rel="noopener">${esc(negocio.direccion)}</a></li>
      </ul>
      <div class="grilla">
        <a class="btn btn-secundario btn-bloque" href="${esc(enlaceCalendario(r, s))}" target="_blank" rel="noopener">
          <svg class="icono" aria-hidden="true"><use href="#i-calendario"></use></svg> Agregar a mi calendario
        </a>
        <a class="btn btn-secundario btn-bloque" href="${esc(enlaceMapa)}" target="_blank" rel="noopener">
          <svg class="icono" aria-hidden="true"><use href="#i-ubicacion"></use></svg> Cómo llegar
        </a>
        <a class="btn btn-secundario btn-bloque" href="cliente.html?patente=${encodeURIComponent(r.patente)}#estado">
          <svg class="icono" aria-hidden="true"><use href="#i-buscar"></use></svg> Ver el estado de mi auto
        </a>
      </div>
      <p class="texto-2 nota-cambio">¿No puedes venir? <a href="${esc(enlaceTelefono)}">Llámanos</a> o escríbenos por WhatsApp.
        N° de reserva ${esc(r.id)} (no necesitas anotarlo).</p>
      <button type="button" class="btn btn-claro-gris btn-bloque" data-nueva>Hacer otra reserva</button>`);
  }

  // ===== Navegación entre pasos =====
  // Lo ya elegido aparece arriba; tocarlo vuelve a ese paso.
  function pintarEleccion() {
    const s = servicioActual();
    const items = [
      estado.fecha && [0, textoFecha(estado.fecha, { weekday: 'short', day: 'numeric', month: 'short' })],
      estado.vehiculo && [1, nombreVehiculo(estado.vehiculo)],
      s && [2, s.nombre],
      estado.hora && [3, `${estado.hora} h`]
    ].filter(item => item && item[0] < estado.paso);
    const mostrar = estado.paso !== CONFIRMADA && items.length > 0;
    $('#eleccion-caja').hidden = !mostrar;
    $('#eleccion').innerHTML = mostrar ? items.map(([paso, texto]) =>
      `<li><button type="button" data-ir="${paso}" aria-label="Cambiar: ${esc(texto)}">${esc(texto)}</button></li>`).join('') : '';
  }

  // Paso más avanzado al que se puede llegar con lo elegido hasta ahora.
  const pasoMaximo = () => (estado.reserva ? CONFIRMADA : !estado.fecha ? 0 : !estado.vehiculo ? 1 : !estado.servicioId ? 2 : !estado.hora ? 3 : 4);
  const PINTORES = [pintarCalendario, pintarVehiculos, pintarServicios, pintarHoras, pintarDatos, pintarConfirmacion];

  function guardarBorrador() {
    const { paso, fecha, vehiculo, servicioId, hora, datos, reserva } = estado;
    guardar(CLAVE_BORRADOR, reserva ? null : { paso, fecha, vehiculo, servicioId, hora, datos }, sessionStorage);
  }

  function pintar({ enfocar = true } = {}) {
    const p = estado.paso;
    const final = p === CONFIRMADA;
    $('#atras').hidden = p === 0 || final;
    $('#paso-n').textContent = final ? 'Reserva hecha' : `Paso ${p + 1} de ${TITULOS.length}`;
    $('#paso-titulo').textContent = final ? '¡Listo, te esperamos!' : TITULOS[p];
    $('#bienvenida').hidden = p !== 0;
    $('#progreso').style.width = `${final ? 100 : ((p + 1) / TITULOS.length) * 100}%`;
    pintarEleccion();
    pintarMiProxima();
    PINTORES[p]();
    guardarBorrador();
    if (enfocar) {
      $('.asistente').scrollIntoView({ block: 'start' });
      $('#paso-titulo').focus({ preventScroll: true });
    }
  }

  // Cada paso queda en el historial: el botón "atrás" del celular vuelve al paso anterior.
  function irA(paso, { reemplazar = false } = {}) {
    estado.paso = Math.min(paso, pasoMaximo());
    history[reemplazar ? 'replaceState' : 'pushState']({ paso: estado.paso }, '', `#paso-${estado.paso + 1}`);
    pintar();
  }

  window.addEventListener('popstate', (e) => {
    if (estado.reserva) { reiniciar(); return; } // después de reservar, "atrás" empieza una reserva nueva (la hecha queda arriba como recordatorio)
    estado.paso = Math.min(e.state?.paso ?? 0, pasoMaximo());
    pintar();
  });

  function reiniciar() {
    Object.assign(estado, { paso: 0, fecha: null, vehiculo: null, servicioId: null, hora: null, reserva: null });
    history.replaceState({ paso: 0 }, '', location.pathname);
    pintar();
  }

  $('#atras').addEventListener('click', () => history.back());

  // Tocar el logo o el nombre vuelve al inicio: calendario, paso 1, arriba de todo.
  $('#ir-inicio').addEventListener('click', (e) => {
    e.preventDefault();
    reiniciar();
    window.scrollTo({ top: 0 });
  });

  document.querySelector('.asistente').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.fecha && t.getAttribute('aria-disabled') === 'true') {
      // Día no disponible: se explica por qué, en vez de no hacer nada.
      const aviso = $('#aviso-dia');
      aviso.textContent = motivoBloqueo(t.dataset.fecha);
      aviso.hidden = false;
      return;
    }
    if (t.dataset.ir) irA(Number(t.dataset.ir));
    else if (t.dataset.mes) moverMes(Number(t.dataset.mes));
    else if (t.dataset.fecha) { estado.fecha = t.dataset.fecha; estado.hora = null; irA(1); }
    else if (t.dataset.vehiculo) { estado.vehiculo = t.dataset.vehiculo; irA(2); }
    else if (t.dataset.servicio) { estado.servicioId = t.dataset.servicio; estado.hora = null; irA(3); }
    else if (t.dataset.hora) { estado.hora = t.dataset.hora; irA(4); }
    else if ('nueva' in t.dataset) reiniciar();
  });

  // Los datos del formulario se guardan mientras se escriben (no se pierden al volver atrás ni al recargar).
  $('#paso-contenido').addEventListener('input', (e) => {
    if (e.target.form?.id === 'form-datos') { estado.datos[e.target.name] = e.target.value; guardarBorrador(); }
  });
  $('#paso-contenido').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    estado.datos = Object.fromEntries(new FormData(form));
    if (validarDatos(form)) confirmar(form);
  });

  // Si se recargó la página a mitad de la reserva, se retoma donde iba (si lo elegido sigue siendo válido).
  const borrador = leer(CLAVE_BORRADOR, sessionStorage);
  if (borrador && borrador.fecha >= hoy) {
    Object.assign(estado, {
      fecha: borrador.fecha, datos: borrador.datos ?? {},
      vehiculo: vehiculosVisibles.some(v => v.id === borrador.vehiculo) ? borrador.vehiculo : null,
      servicioId: serviciosVisibles.some(s => s.id === borrador.servicioId) ? borrador.servicioId : null,
      hora: borrador.hora, mes: borrador.fecha.slice(0, 7)
    });
    if (!estado.vehiculo) estado.servicioId = null;
    if (!estado.servicioId) estado.hora = null;
    estado.paso = Math.min(borrador.paso ?? 0, pasoMaximo());
  } else if (borrador) {
    estado.datos = borrador.datos ?? {};
  }
  history.replaceState({ paso: estado.paso }, '', estado.paso ? `#paso-${estado.paso + 1}` : location.pathname);
  pintar({ enfocar: false });
})();
