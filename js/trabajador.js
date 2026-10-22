/* Vista del trabajador: "Mi jornada" (registrar lo de hoy), "Agenda" (cómo está ocupado el día) y "Mi historial". */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  const usuario = await Datos.exigirSesion(['trabajador', 'dueno']);

  let negocio, servicios;
  try {
    [negocio, servicios] = await Promise.all([Datos.negocio(), Datos.servicios()]);
  } catch (err) {
    $('#avisos').innerHTML = `<div class="aviso">No se pudieron cargar los datos. ${esc(UI.mensajeError(err))}</div>`;
    return;
  }
  UI.prepararCabecera(usuario, negocio);
  $('#ir-panel').hidden = usuario.rol !== 'dueno';
  if (Datos.modo === 'demo') {
    $('#avisos').innerHTML = `<div class="aviso" style="margin-bottom:20px"><svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
      <span>Modo demostración: lo que registres queda solo en este navegador.</span></div>`;
  }

  const servicioPorId = (id) => servicios.find(s => s.id === id);
  const nombreVehiculo = (id) => negocio.tiposVehiculo.find(v => v.id === id)?.nombre ?? id;
  const estado = { reservas: [], actividades: [], periodo: 'hoy', agendaFecha: Datos.fechaISO(), agendaReservas: [], pestana: 'jornada' };
  const servicioCorto = (id) => (servicioPorId(id)?.nombre ?? id).replace(/^Lavado /, '');
  const primerNombre = (txt) => String(txt).split(' ')[0];
  const minutosAhora = () => { const a = new Date(); return a.getHours() * 60 + a.getMinutes(); };

  async function cargar() {
    const hoy = Datos.fechaISO();
    try {
      [estado.reservas, estado.actividades] = await Promise.all([
        Datos.reservasConContacto({ desde: hoy, hasta: hoy }),
        Datos.actividades({ uid: usuario.uid, desde: Datos.sumarDias(hoy, -31), hasta: hoy })
      ]);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    pintarJornada();
    pintarHistorial();
    if (estado.agendaFecha === Datos.fechaISO()) { estado.agendaReservas = estado.reservas; pintarAgenda(); }
  }

  // Ejecuta una acción, muestra el resultado y recarga los datos.
  async function ejecutar(boton, accion, textoOk) {
    if (boton) boton.disabled = true;
    try {
      const hecho = await accion();
      if (hecho !== false) UI.aviso(textoOk);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    await cargar();
    if (boton) boton.disabled = false;
  }

  // ===== Pantalla 1: Mi jornada =====
  function pintarTurno() {
    const hoy = Datos.fechaISO();
    const turno = Datos.turnoDeHoy(estado.actividades, usuario.uid);
    const deHoy = estado.actividades.filter(a => a.fecha === hoy);
    const lavados = deHoy.filter(a => a.tipo === 'lavado').length;
    const cobrado = deHoy.filter(a => a.tipo === 'cobro').reduce((t, a) => t + (a.monto || 0), 0);
    $('#turno').innerHTML = `
      <div class="turno-estado">
        <span class="punto ${turno.enTurno ? 'activo' : ''}" aria-hidden="true"></span>
        <div>
          <strong>${turno.enTurno ? `En turno desde las ${esc(turno.desde)}` : 'Fuera de turno'}</strong>
          <div class="texto-2">Hoy: ${lavados} ${lavados === 1 ? 'lavado' : 'lavados'} · ${Datos.dinero(cobrado)} cobrados</div>
        </div>
      </div>
      <button type="button" class="btn ${turno.enTurno ? 'btn-secundario' : 'btn-primario'}" id="btn-turno">
        <svg class="icono" aria-hidden="true"><use href="#i-reloj"></use></svg>
        ${turno.enTurno ? 'Marcar salida' : 'Marcar entrada'}
      </button>`;
    $('#btn-turno').addEventListener('click', (e) => {
      const tipo = turno.enTurno ? 'salida' : 'entrada';
      if (tipo === 'salida' && !confirm('¿Marcar tu salida del turno?')) return;
      ejecutar(e.currentTarget, () => Datos.registrarActividad(usuario, { tipo }),
        tipo === 'entrada' ? 'Entrada registrada. ¡Buen turno!' : 'Salida registrada. ¡Hasta mañana!');
    });
  }

  function tarjetaAuto(r, acciones) {
    const info = Datos.ESTADOS[r.estado] ?? { texto: r.estado };
    return `
      <li class="tarjeta turno ${esc(r.estado)}">
        <div class="turno-cabecera">
          <span class="turno-hora">${esc(r.hora)}</span>
          <span class="chips-turno">${Datos.porConfirmar(r) ? '<span class="chip por-confirmar">Por confirmar</span>' : ''}<span class="chip ${esc(r.estado)}">${esc(info.texto)}</span></span>
        </div>
        <div class="turno-detalle">
          <span class="patente">${esc(r.patente)}</span>
          <span><strong>${esc(servicioPorId(r.servicioId)?.nombre ?? r.servicioId)}</strong> · ${esc(nombreVehiculo(r.vehiculo))}</span>
          ${r.cliente ? `<span>${esc(r.cliente)}</span>` : ''}
          <span><strong>${Datos.dinero(r.precio)}</strong></span>
          ${r.origen === 'local' ? '<span>Sin reserva</span>' : ''}
            ${r.comentario ? `<span>Nota: ${esc(r.comentario)}</span>` : ''}
        </div>
        <div class="turno-acciones">${acciones}</div>
      </li>`;
  }

  function botonAvisar(r) {
    if (!r.telefono) return '';
    const msj = encodeURIComponent(`Hola${r.cliente ? ' ' + r.cliente : ''}, tu vehículo patente ${r.patente} ya está listo para retiro. ¡Gracias por preferir ${negocio.nombre}!`);
    return `<a class="btn btn-secundario btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(r.telefono)}?text=${msj}">
      <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Avisar al cliente</a>`;
  }

  function pintarAutos() {
    const mios = estado.reservas.filter(r => r.trabajadorUid === usuario.uid && (r.estado === 'en-proceso' || r.estado === 'listo'));
    $('#mis-autos').innerHTML = mios.length
      ? mios.map(r => tarjetaAuto(r, r.estado === 'en-proceso'
          ? `<button type="button" class="btn btn-primario btn-sm" data-accion="terminar" data-id="${esc(r.id)}">
               <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg> Terminar lavado</button>`
          : `<button type="button" class="btn btn-primario btn-sm" data-accion="cobrar" data-id="${esc(r.id)}">
               <svg class="icono" aria-hidden="true"><use href="#i-dinero"></use></svg> Cobrar y entregar</button>${botonAvisar(r)}`)).join('')
      : '<li class="tarjeta vacio">No tienes autos en curso. Toma uno de la lista de abajo o registra un auto sin reserva.</li>';

    const pendientes = estado.reservas.filter(r => r.estado === 'pendiente');
    $('#por-atender').innerHTML = pendientes.length
      ? pendientes.map(r => tarjetaAuto(r,
          `${Datos.porConfirmar(r) ? UI.botonConfirmar(r, negocio, servicios) : ''}<button type="button" class="btn btn-primario btn-sm" data-accion="iniciar" data-id="${esc(r.id)}">Iniciar lavado</button>`)).join('')
      : '<li class="tarjeta vacio">No quedan reservas pendientes para hoy.</li>';
  }

  function pintarJornada() {
    const texto = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#fecha-hoy').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
    pintarTurno();
    pintarAutos();
  }

  // Confirmar por WhatsApp: el enlace abre el chat; aquí se marca la reserva como confirmada.
  document.querySelector('[data-panel="jornada"]').addEventListener('click', (e) => {
    const el = e.target.closest('[data-confirmar]');
    const r = el && estado.reservas.find(x => x.id === el.dataset.confirmar);
    if (r) ejecutar(null, () => Datos.confirmarReserva(r, usuario), `Reserva de ${r.patente} confirmada.`);
  });

  document.querySelector('[data-panel="jornada"]').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const r = estado.reservas.find(x => x.id === btn.dataset.id);
    if (!r) return;
    if (btn.dataset.accion === 'iniciar') {
      ejecutar(btn, () => Datos.iniciarLavado(r, usuario), `Lavado iniciado: ${r.patente}`);
    } else if (btn.dataset.accion === 'terminar') {
      ejecutar(btn, () => Datos.terminarLavado(r, usuario), `Lavado terminado: ${r.patente}`);
    } else if (btn.dataset.accion === 'cobrar') {
      const pago = await UI.cobro(r, negocio, servicios);
      if (pago) ejecutar(btn, () => Datos.cobrar(r, pago, usuario), `Cobro registrado: ${Datos.dinero(pago.monto)}`);
    }
  });

  $('#btn-sin-reserva').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const datos = await UI.autoSinReserva(negocio, servicios, revisarAlcance);
    if (datos) ejecutar(boton, () => Datos.registrarAutoSinReserva(usuario, datos), `Lavado iniciado: ${datos.patente}`);
  });

  $('#btn-otra').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const datos = await UI.otraActividad();
    if (datos) ejecutar(boton, () => Datos.registrarActividad(usuario, { tipo: 'otra', ...datos }), 'Actividad registrada.');
  });

  // ¿Alcanza a lavarse ahora un auto sin reserva? Mira las reservas y lavados de hoy y la capacidad del local.
  function revisarAlcance(servicio) {
    const ahoraMin = minutosAhora();
    const cap = negocio.capacidadSimultanea;
    const calcular = (s) => Datos.ocupacionEntre({
      reservas: estado.reservas, servicios, fecha: Datos.fechaISO(), ahoraMin, desdeMin: ahoraMin, duracionMin: s.duracionMin
    });
    const o = calcular(servicio);
    const despuesCierre = ahoraMin + servicio.duracionMin > Datos.aMinutos(negocio.horario.cierre)
      ? ` Ojo: terminaría después del cierre (${esc(negocio.horario.cierre)}).` : '';
    if (o.maximo < cap) {
      const termina = Datos.aHora(Math.min(ahoraMin + servicio.duracionMin, 1439));
      const proxima = o.tramos.filter(t => t.reserva.estado === 'pendiente').sort((a, b) => a.ini - b.ini)[0];
      const extra = proxima ? ` Hay una reserva a las ${esc(proxima.reserva.hora)}, pero queda lugar.` : '';
      return `<div class="alcance si"><svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg>
        <span><strong>Alcanza.</strong> Si empiezas ahora, termina cerca de las ${termina}.${extra}${despuesCierre}</span></div>`;
    }
    const cortos = servicios.filter(s => s.duracionMin < servicio.duracionMin && calcular(s).maximo < cap);
    const sugerencia = cortos.length
      ? ` Con ${cortos.map(s => `${esc(s.nombre)} (${esc(s.duracionMin)} min)`).join(' o ')} sí alcanza.`
      : ' Mejor ofrécele una hora más tarde (mira la Agenda).';
    return `<div class="alcance no"><svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
      <span><strong>No alcanza.</strong> A las ${o.momentoLleno} el local estará lleno.${sugerencia}${despuesCierre}</span></div>`;
  }

  // ===== Pantalla 2: Agenda del día =====
  async function cargarAgenda() {
    if (estado.agendaFecha === Datos.fechaISO()) {
      estado.agendaReservas = estado.reservas;
    } else {
      try {
        estado.agendaReservas = await Datos.reservasConContacto({ desde: estado.agendaFecha, hasta: estado.agendaFecha });
      } catch (err) {
        UI.aviso(UI.mensajeError(err), 'error');
      }
    }
    pintarAgenda();
  }

  // El día en tramos (ej. cada 30 min): qué autos ocupan el local en cada tramo y cuántos lugares quedan.
  function pintarAgenda() {
    const f = estado.agendaFecha;
    const esHoy = f === Datos.fechaISO();
    $('#agenda-fecha').value = f;
    $('#titulo-agenda-dia').textContent = `Agenda · ${UI.textoDia(f)}`;
    const { apertura, cierre, intervaloMin, diasCerrado = [] } = negocio.horario;
    if (diasCerrado.includes(new Date(f + 'T12:00:00').getDay())) {
      $('#agenda-resumen').textContent = '';
      $('#linea-tiempo').innerHTML = '<li class="tarjeta vacio">El local está cerrado este día.</li>';
      return;
    }
    const ahoraMin = minutosAhora();
    const cap = negocio.capacidadSimultanea;
    const tramos = Datos.tramosDelDia({ reservas: estado.agendaReservas, servicios, fecha: f, ahoraMin: esHoy ? ahoraMin : null });
    const filas = [];
    for (let m = Datos.aMinutos(apertura); m < Datos.aMinutos(cierre); m += intervaloMin) {
      const fin = m + intervaloMin;
      const activos = tramos.filter(t => t.ini < fin && t.fin > m).sort((a, b) => a.ini - b.ini);
      const pasada = esHoy && fin <= ahoraMin;
      const actual = esHoy && m <= ahoraMin && ahoraMin < fin;
      const libres = Math.max(0, cap - activos.length);
      const clase = libres === 0 ? 'llena' : activos.length ? 'parcial' : 'libre';
      filas.push(`
        <li class="franja ${clase}${pasada ? ' pasada' : ''}${actual ? ' actual' : ''}"${actual ? ' aria-current="time"' : ''}>
          <span class="franja-hora">${Datos.aHora(m)}${actual ? '<span class="franja-ahora">Ahora</span>' : ''}</span>
          <div class="franja-autos">${activos.length ? activos.map(t => {
            const r = t.reserva;
            const empieza = t.ini >= m && t.ini < fin; // en las filas siguientes el auto aparece atenuado ("sigue")
            return `<span class="auto-franja ${esc(r.estado)}${empieza ? '' : ' sigue'}">${esc(r.patente)} · ${esc(servicioCorto(r.servicioId))}${r.trabajadorNombre ? ' · ' + esc(primerNombre(r.trabajadorNombre)) : ''}</span>`;
          }).join('') : '<span class="texto-2">Libre</span>'}</div>
          <span class="franja-cupo">${libres === 0 ? 'Lleno' : `${libres} ${libres === 1 ? 'libre' : 'libres'}`}</span>
        </li>`);
    }
    $('#linea-tiempo').innerHTML = filas.join('');
    const n = estado.agendaReservas.filter(r => r.fecha === f && r.estado !== 'cancelada').length;
    $('#agenda-resumen').textContent = `${n} ${n === 1 ? 'auto' : 'autos'} este día · caben ${cap} a la vez`;
  }

  function moverAgenda(dias) { estado.agendaFecha = Datos.sumarDias(estado.agendaFecha, dias); cargarAgenda(); }
  $('#agenda-anterior').addEventListener('click', () => moverAgenda(-1));
  $('#agenda-siguiente').addEventListener('click', () => moverAgenda(1));
  $('#agenda-hoy').addEventListener('click', () => { estado.agendaFecha = Datos.fechaISO(); cargarAgenda(); });
  $('#agenda-fecha').addEventListener('change', (e) => { if (e.target.value) { estado.agendaFecha = e.target.value; cargarAgenda(); } });

  // ===== Pantalla 3: Mi historial =====
  function desdePeriodo() {
    const hoy = Datos.fechaISO();
    if (estado.periodo === '7') return Datos.sumarDias(hoy, -6);
    if (estado.periodo === 'mes') return hoy.slice(0, 8) + '01';
    return hoy;
  }

  function pintarHistorial() {
    const desde = desdePeriodo();
    const lista = estado.actividades.filter(a => a.fecha >= desde);
    const lavados = lista.filter(a => a.tipo === 'lavado').length;
    const cobrado = lista.filter(a => a.tipo === 'cobro').reduce((t, a) => t + (a.monto || 0), 0);
    const minutos = Datos.minutosTrabajados(lista);
    const dias = new Set(lista.filter(a => a.tipo === 'entrada').map(a => a.fecha)).size;
    $('#kpis-historial').innerHTML = [
      ['Lavados', lavados], ['Cobrado', Datos.dinero(cobrado)], ['Horas trabajadas', Datos.formatoHoras(minutos)], ['Días trabajados', dias]
    ].map(([etq, val]) => `<div class="tarjeta kpi"><div class="etiqueta">${etq}</div><div class="valor">${val}</div></div>`).join('');
    $('#lista-historial').innerHTML = UI.listaPorDia(lista, { servicios });
  }

  $('#periodo-historial').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-periodo]');
    if (!btn) return;
    estado.periodo = btn.dataset.periodo;
    $('#periodo-historial').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    pintarHistorial();
  });

  const TITULOS = { jornada: 'Mi jornada', agenda: 'Agenda', historial: 'Mi historial' };
  await cargar();
  UI.pestanas(async (id) => {
    estado.pestana = id;
    document.title = TITULOS[id];
    if (id === 'agenda') {
      await cargarAgenda();
      $('.franja.actual')?.scrollIntoView({ block: 'center' }); // muestra el momento actual
    }
  });
  // Se actualiza solo cada minuto (otros trabajadores pueden tomar autos o llegar reservas nuevas).
  setInterval(() => { if (!document.querySelector('dialog[open]')) cargar(); }, 60000);
})();
