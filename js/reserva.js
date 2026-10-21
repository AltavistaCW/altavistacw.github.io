/* Inicio del cliente: datos del local y reserva paso a paso (día → vehículo → lavado → hora → datos). */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  const DIAS_MAX = 60; // hasta cuántos días adelante se puede reservar
  const TITULOS = ['¿Qué día quieres lavar tu auto?', '¿Qué vehículo traes?', '¿Qué lavado necesitas?', '¿A qué hora?', 'Tus datos'];
  const CONFIRMADA = TITULOS.length; // paso final, después de reservar

  let negocio, servicios;
  try {
    [negocio, servicios] = await Promise.all([Datos.negocio(), Datos.servicios()]);
  } catch {
    $('#paso-contenido').innerHTML = '<div class="aviso">No pudimos cargar la información. Revisa tu conexión y vuelve a intentar.</div>';
    return;
  }

  // ===== Datos del local =====
  const textos = { nombre: negocio.nombre, eslogan: negocio.eslogan, direccion: negocio.direccion, telefono: negocio.telefono, horario: negocio.horario.texto };
  document.querySelectorAll('[data-negocio]').forEach(el => { el.textContent = textos[el.dataset.negocio] ?? ''; });
  document.title = negocio.nombre;
  $('#enlace-telefono').href = `tel:${negocio.telefono.replace(/\s/g, '')}`;
  $('#acceso-whatsapp').href = `https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola ${negocio.nombre}, quisiera consultar por un lavado.`)}`;
  $('#acceso-mapa').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${negocio.nombre} ${negocio.direccion}`)}`;
  $('#aviso-demo').hidden = Datos.modo !== 'demo';

  const aMin = (h) => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };
  function pintarEstadoLocal() {
    const { apertura, cierre, diasCerrado = [] } = negocio.horario;
    const ahora = new Date();
    const minutos = ahora.getHours() * 60 + ahora.getMinutes();
    const abierto = !diasCerrado.includes(ahora.getDay()) && minutos >= aMin(apertura) && minutos < aMin(cierre);
    const el = $('#estado-local');
    el.classList.toggle('abierto', abierto);
    el.textContent = abierto ? `Abierto · cierra ${cierre}` : `Cerrado · abre ${apertura}`;
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
  const duracionMinima = Math.min(...servicios.map(s => s.duracionMin || 30));
  const estaCerrado = (fecha) => (negocio.horario.diasCerrado ?? []).includes(new Date(fecha + 'T12:00:00').getDay());
  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const textoFecha = (f, opciones = { weekday: 'long', day: 'numeric', month: 'long' }) =>
    mayuscula(new Date(f + 'T12:00:00').toLocaleDateString('es-CL', opciones));

  const contenido = (html) => { $('#paso-contenido').innerHTML = html; };

  // ===== Paso 1: día =====
  function pintarCalendario() {
    const [y, m] = estado.mes.split('-').map(Number);
    const primero = new Date(y, m - 1, 1);
    const diasMes = new Date(y, m, 0).getDate();
    const huecos = (primero.getDay() + 6) % 7; // la semana parte el lunes
    const nombreMes = mayuscula(primero.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }));

    let celdas = '<span aria-hidden="true"></span>'.repeat(huecos);
    for (let d = 1; d <= diasMes; d++) {
      const f = `${estado.mes}-${String(d).padStart(2, '0')}`;
      let clase = 'libre', etiqueta = f === hoy ? 'Hoy' : '', disponible = true;
      if (f < hoy || f > limite) { clase = 'fuera'; etiqueta = ''; disponible = false; }
      else if (estaCerrado(f)) { clase = 'cerrado'; etiqueta = 'Cerrado'; disponible = false; }
      // Hoy puede quedar sin horas solo porque ya pasó la hora de cierre: no es lo mismo que "lleno".
      else if (!libres(f, duracionMinima).length) { clase = 'lleno'; etiqueta = f === hoy ? 'Sin horas' : 'Sin cupo'; disponible = false; }
      const descripcion = disponible ? 'disponible' : (etiqueta ? etiqueta.toLowerCase() : 'no disponible');
      celdas += `
        <button type="button" class="dia ${clase}" data-fecha="${f}" ${disponible ? '' : 'disabled'}
                aria-pressed="${f === estado.fecha}" aria-label="${esc(textoFecha(f))}, ${descripcion}">
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
    contenido(`<div class="opciones-grandes">${negocio.tiposVehiculo.map(v => {
      const precios = servicios.map(s => s.precios[v.id]).filter(Boolean);
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
    const opciones = servicios.filter(s => s.precios[estado.vehiculo]);
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
          ${s.descripcion ? `<span class="texto-2">${esc(s.descripcion)}</span>` : ''}
          <span class="duracion"><svg class="icono" aria-hidden="true"><use href="#i-reloj"></use></svg>
            ${esc(s.duracionMin)} min aprox.${hayHoras ? '' : ' · Sin horas este día'}</span>
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
        <div class="resumen">
          <div class="texto-2">${esc(s.nombre)} · ${esc(nombreVehiculo(estado.vehiculo))}</div>
          <div class="texto-2">${esc(textoFecha(estado.fecha))}, ${esc(estado.hora)} h</div>
          <div class="total">${Datos.dinero(s.precios[estado.vehiculo])}</div>
        </div>
        <div class="campo">
          <label for="f-nombre">Nombre</label>
          <input type="text" id="f-nombre" name="nombre" autocomplete="name" required value="${esc(d.nombre ?? '')}">
          <span class="error" id="e-nombre"></span>
        </div>
        <div class="campo">
          <label for="f-telefono">WhatsApp</label>
          <input type="tel" id="f-telefono" name="telefono" autocomplete="tel" inputmode="tel" placeholder="9 1234 5678" required value="${esc(d.telefono ?? '')}">
          <span class="ayuda">Te avisamos por aquí cuando tu auto esté listo.</span>
          <span class="error" id="e-telefono"></span>
        </div>
        <div class="campo">
          <label for="f-patente">Patente</label>
          <input type="text" id="f-patente" name="patente" autocapitalize="characters" maxlength="8" placeholder="ABCD12" required value="${esc(d.patente ?? '')}">
          <span class="ayuda">Con ella puedes consultar el estado de tu auto.</span>
          <span class="error" id="e-patente"></span>
        </div>
        <div class="campo">
          <label for="f-comentario">Comentario <span class="texto-2">(opcional)</span></label>
          <textarea id="f-comentario" name="comentario" rows="2" maxlength="300" placeholder="Ej.: tiene pelos de mascota, mucho barro, sillas de niño">${esc(d.comentario ?? '')}</textarea>
        </div>
        <span class="error" id="e-reserva" role="alert"></span>
        <button type="submit" class="btn btn-primario btn-bloque btn-grande">
          <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg> Confirmar reserva
        </button>
      </form>`);
  }

  function validarDatos(form) {
    const d = estado.datos;
    const reglas = [
      ['nombre', d.nombre.trim().length >= 2, 'Escribe tu nombre.'],
      ['telefono', d.telefono.replace(/\D/g, '').length >= 8, 'Escribe un número válido (ej.: 9 1234 5678).'],
      ['patente', /^[A-Z0-9]{5,8}$/.test(Datos.normalizarPatente(d.patente)), 'Escribe la patente (ej.: ABCD12).']
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

  // Teléfono chileno a formato WhatsApp (569XXXXXXXX), para que el equipo pueda avisar con un toque.
  function telefonoWhatsApp(txt) {
    const digitos = txt.replace(/\D/g, '');
    if (digitos.length === 9) return '56' + digitos;
    if (digitos.length === 8) return '569' + digitos;
    return digitos;
  }

  async function confirmar(form) {
    const boton = form.querySelector('[type="submit"]');
    boton.disabled = true;
    $('#e-reserva').textContent = '';
    const s = servicioActual();
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
        vehiculo: estado.vehiculo,
        cliente: estado.datos.nombre.trim(),
        telefono: telefonoWhatsApp(estado.datos.telefono),
        patente: Datos.normalizarPatente(estado.datos.patente),
        comentario: (estado.datos.comentario ?? '').trim(),
        precio: s.precios[estado.vehiculo], // se guardan el precio y la duración del momento de la reserva
        duracionMin: s.duracionMin
      });
      estado.reservas.push(estado.reserva);
      irA(CONFIRMADA, { reemplazar: true });
    } catch {
      $('#e-reserva').textContent = 'No pudimos guardar tu reserva. Revisa tu conexión y vuelve a intentar.';
      boton.disabled = false;
    }
  }

  // ===== Reserva confirmada =====
  function pintarConfirmacion() {
    const r = estado.reserva;
    const s = servicioActual();
    const fecha = textoFecha(r.fecha);
    const texto = encodeURIComponent(`Hola, reservé ${s.nombre} para el ${fecha} a las ${r.hora}. Patente ${r.patente}. Código ${r.id}.`);
    contenido(`
      <div class="aviso exito confirmacion" role="status">
        <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg>
        <div>
          <strong>¡Te esperamos, ${esc(r.cliente.split(' ')[0])}!</strong><br>
          ${esc(s.nombre)} · ${esc(nombreVehiculo(r.vehiculo))}<br>
          ${esc(fecha)}, ${esc(r.hora)} h<br>
          Patente <span class="patente">${esc(r.patente)}</span> · Código ${esc(r.id)}<br>
          <strong>${Datos.dinero(r.precio)}</strong>
        </div>
      </div>
      <p class="texto-2">${esc(negocio.direccion)}. Si no puedes venir, avísanos por WhatsApp.</p>
      <div class="grilla">
        <a class="btn btn-primario btn-bloque" target="_blank" rel="noopener" href="https://wa.me/${esc(negocio.whatsapp)}?text=${texto}">
          <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Avisar por WhatsApp
        </a>
        <a class="btn btn-secundario btn-bloque" href="cliente.html?patente=${encodeURIComponent(r.patente)}#estado">
          <svg class="icono" aria-hidden="true"><use href="#i-buscar"></use></svg> Ver el estado de mi auto
        </a>
        <button type="button" class="btn btn-secundario btn-bloque" data-nueva>Hacer otra reserva</button>
      </div>`);
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
    $('#eleccion').innerHTML = estado.paso === CONFIRMADA ? '' : items.map(([paso, texto]) =>
      `<li><button type="button" data-ir="${paso}" aria-label="Cambiar: ${esc(texto)}">${esc(texto)}</button></li>`).join('');
  }

  // Paso más avanzado al que se puede llegar con lo elegido hasta ahora.
  const pasoMaximo = () => (estado.reserva ? CONFIRMADA : !estado.fecha ? 0 : !estado.vehiculo ? 1 : !estado.servicioId ? 2 : !estado.hora ? 3 : 4);
  const PINTORES = [pintarCalendario, pintarVehiculos, pintarServicios, pintarHoras, pintarDatos, pintarConfirmacion];

  function pintar({ enfocar = true } = {}) {
    const p = estado.paso;
    const final = p === CONFIRMADA;
    $('#atras').hidden = p === 0 || final;
    $('#paso-n').textContent = final ? '¡Reserva lista!' : `Paso ${p + 1} de ${TITULOS.length}`;
    $('#paso-titulo').textContent = final ? 'Reserva confirmada' : TITULOS[p];
    $('#progreso').style.width = `${final ? 100 : ((p + 1) / TITULOS.length) * 100}%`;
    pintarEleccion();
    PINTORES[p]();
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
    if (estado.reserva) { reiniciar(); return; } // después de confirmar, "atrás" empieza una reserva nueva
    estado.paso = Math.min(e.state?.paso ?? 0, pasoMaximo());
    pintar();
  });

  function reiniciar() {
    Object.assign(estado, { paso: 0, fecha: null, vehiculo: null, servicioId: null, hora: null, reserva: null });
    history.replaceState({ paso: 0 }, '', location.pathname);
    pintar();
  }

  $('#atras').addEventListener('click', () => history.back());

  document.querySelector('.asistente').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.ir) irA(Number(t.dataset.ir));
    else if (t.dataset.mes) moverMes(Number(t.dataset.mes));
    else if (t.dataset.fecha) { estado.fecha = t.dataset.fecha; estado.hora = null; irA(1); }
    else if (t.dataset.vehiculo) { estado.vehiculo = t.dataset.vehiculo; irA(2); }
    else if (t.dataset.servicio) { estado.servicioId = t.dataset.servicio; estado.hora = null; irA(3); }
    else if (t.dataset.hora) { estado.hora = t.dataset.hora; irA(4); }
    else if ('nueva' in t.dataset) reiniciar();
  });

  // Los datos del formulario se guardan mientras se escriben (no se pierden al volver atrás).
  $('#paso-contenido').addEventListener('input', (e) => {
    if (e.target.form?.id === 'form-datos') estado.datos[e.target.name] = e.target.value;
  });
  $('#paso-contenido').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    estado.datos = Object.fromEntries(new FormData(form));
    if (validarDatos(form)) confirmar(form);
  });

  history.replaceState({ paso: 0 }, '', location.pathname);
  pintar({ enfocar: false });
})();
