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
    $('#avisos').innerHTML = `<div class="aviso aviso-demo"><svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
      <span>Modo demostración: lo que registres queda solo en este celular.</span></div>`;
  }

  const servicioNombre = (r) => Datos.nombreServicio(servicios, r.servicioId, r.servicioNombre);
  const servicioCorto = (r) => servicioNombre(r).replace(/^Lavado /, '');
  const nombreVehiculo = (id) => negocio.tiposVehiculo.find(v => v.id === id)?.nombre ?? id;
  const primerNombre = (txt) => String(txt).split(' ')[0];
  const minutosAhora = () => { const a = new Date(); return a.getHours() * 60 + a.getMinutes(); };
  const estado = { reservas: [], actividades: [], periodo: 'hoy', agendaFecha: Datos.fechaISO(), agendaReservas: [], pestana: 'jornada', bloqueado: false };

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

  // Ejecuta una acción, muestra el resultado (con "Deshacer" si se puede) y recarga.
  // Tras redibujar se ignoran toques por un momento: evita que un doble toque apriete el botón que aparece en el mismo lugar.
  async function ejecutar(boton, accion, textoOk, deshacer) {
    if (boton) boton.disabled = true;
    let resultado;
    try {
      resultado = await accion();
      UI.aviso(textoOk, 'exito', deshacer ? {
        texto: 'Deshacer',
        alHacer: async () => {
          try { await deshacer(resultado); UI.aviso('Listo, se deshizo.'); } catch (err) { UI.aviso(UI.mensajeError(err), 'error'); }
          await cargar();
        }
      } : null);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    estado.bloqueado = true;
    setTimeout(() => { estado.bloqueado = false; }, 900);
    await cargar();
    if (boton) boton.disabled = false;
  }
  const bloqueado = () => estado.bloqueado;

  // Si toma un auto sin haber marcado entrada, se le ofrece marcarla (así las horas cuadran con los lavados).
  async function asegurarTurno() {
    if (Datos.turnoDeHoy(estado.actividades, usuario.uid).enTurno) return;
    if (confirm('Todavía no marcas tu entrada. ¿La marco ahora?')) {
      await Datos.registrarActividad(usuario, { tipo: 'entrada' });
    }
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
      <button type="button" class="btn btn-sm ${turno.enTurno ? 'btn-secundario' : 'btn-primario'}" id="btn-turno">
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
    const atraso = Datos.atraso(r);
    const asignadoAMi = r.estado === 'pendiente' && r.asignadoUid === usuario.uid;
    return `
      <li class="tarjeta turno ${esc(r.estado)}">
        <div class="turno-cabecera">
          <span class="turno-hora">${esc(r.hora)}</span>
          <span class="chips-turno">
            ${atraso > Datos.TOLERANCIA_ATRASO ? `<span class="chip atrasado">Atrasado ${atraso} min</span>` : ''}
            ${asignadoAMi ? '<span class="chip rol">Asignado a ti</span>' : ''}
            ${Datos.porConfirmar(r) ? '<span class="chip por-confirmar">Por confirmar</span>' : ''}
            <span class="chip ${esc(r.estado)}">${esc(Datos.textoEstado(r))}</span>
          </span>
        </div>
        <div class="turno-detalle">
          <span class="patente">${esc(r.patente)}</span>
          <span><strong>${esc(servicioNombre(r))}</strong> · ${esc(nombreVehiculo(r.vehiculo))}</span>
          ${r.cliente ? `<span>${esc(r.cliente)}</span>` : ''}
          <span><strong>${Datos.dinero(r.precio)}</strong></span>
          ${r.origen === 'local' ? '<span>Sin reserva</span>' : ''}
          ${r.trabajadorNombre && r.trabajadorUid !== usuario.uid ? `<span>Lo lavó ${esc(primerNombre(r.trabajadorNombre))}</span>` : ''}
          ${r.asignadoNombre && !asignadoAMi && r.estado === 'pendiente' ? `<span>Asignado a ${esc(primerNombre(r.asignadoNombre))}</span>` : ''}
        </div>
        ${r.comentario ? `<p class="nota-cliente">Nota del cliente: ${esc(r.comentario)}</p>` : ''}
        <div class="turno-acciones acciones-grandes">${acciones}</div>
      </li>`;
  }

  function botonAvisar(r) {
    if (!r.telefono) return '';
    const msj = encodeURIComponent(`Hola${r.cliente ? ' ' + primerNombre(r.cliente) : ''}, tu vehículo patente ${r.patente} ya está listo para retiro. ¡Gracias por preferir ${negocio.nombre}!`);
    return `<a class="btn btn-secundario" target="_blank" rel="noopener" href="https://wa.me/${esc(r.telefono)}?text=${msj}">
      <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Avisar al cliente</a>`;
  }
  const botonCobrar = (r) => `<button type="button" class="btn btn-primario" data-accion="cobrar" data-id="${esc(r.id)}">
    <svg class="icono" aria-hidden="true"><use href="#i-dinero"></use></svg> Cobrar y entregar</button>`;

  function pintarAutos() {
    const mios = estado.reservas.filter(r => r.trabajadorUid === usuario.uid && (r.estado === 'en-proceso' || r.estado === 'listo'));
    $('#mis-autos').innerHTML = mios.length
      ? mios.map(r => tarjetaAuto(r, r.estado === 'en-proceso'
          ? `<button type="button" class="btn btn-primario" data-accion="terminar" data-id="${esc(r.id)}">
               <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg> Terminar lavado</button>`
          : `${botonCobrar(r)}${botonAvisar(r)}`)).join('')
      : '<li class="tarjeta vacio">No tienes autos en curso. Toma uno de "Por atender hoy" o registra un auto sin reserva.</li>';

    // Autos que dejó listos otro compañero: cualquiera puede entregarlos si llega el cliente.
    const otros = estado.reservas.filter(r => r.estado === 'listo' && r.trabajadorUid !== usuario.uid);
    $('#bloque-listos').hidden = !otros.length;
    $('#listos-otros').innerHTML = otros.map(r => tarjetaAuto(r, `${botonCobrar(r)}${botonAvisar(r)}`)).join('');

    // Pendientes: primero los asignados a mí, después por hora.
    const pendientes = estado.reservas.filter(r => r.estado === 'pendiente')
      .sort((a, b) => (b.asignadoUid === usuario.uid) - (a.asignadoUid === usuario.uid) || a.hora.localeCompare(b.hora));
    $('#por-atender').innerHTML = pendientes.length
      ? pendientes.map(r => tarjetaAuto(r, `
          ${Datos.porConfirmar(r) ? UI.botonConfirmar(r, negocio, servicios) : ''}
          <button type="button" class="btn btn-primario" data-accion="iniciar" data-id="${esc(r.id)}">Iniciar lavado</button>
          ${Datos.atraso(r) > Datos.TOLERANCIA_ATRASO ? `<button type="button" class="btn btn-secundario" data-accion="nollego" data-id="${esc(r.id)}">No llegó</button>` : ''}`)).join('')
      : '<li class="tarjeta vacio">No quedan reservas pendientes para hoy.</li>';
  }

  function pintarJornada() {
    $('#fecha-hoy').textContent = UI.textoFechaLarga(Datos.fechaISO());
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
    if (!btn || bloqueado()) return;
    const r = estado.reservas.find(x => x.id === btn.dataset.id);
    if (!r) return;
    const accion = btn.dataset.accion;
    if (accion === 'iniciar') {
      await asegurarTurno();
      ejecutar(btn, () => Datos.iniciarLavado(r, usuario), `Lavado iniciado: ${r.patente}`, () => Datos.deshacerInicio(r));
    } else if (accion === 'terminar') {
      ejecutar(btn, () => Datos.terminarLavado(r, usuario), `Lavado terminado: ${r.patente}`, (act) => Datos.deshacerTermino(r, act));
    } else if (accion === 'cobrar') {
      const pago = await UI.cobro(r, negocio, servicios);
      if (pago) ejecutar(btn, () => Datos.cobrar(r, pago, usuario), `Cobro registrado: ${Datos.dinero(pago.monto)}`, (act) => Datos.deshacerCobro(r, act));
    } else if (accion === 'nollego') {
      if (!confirm(`¿Marcar que ${r.patente} (${r.hora}) no llegó? Su lugar queda libre.`)) return;
      ejecutar(btn, () => Datos.marcarNoLlego(r, usuario), `${r.patente}: marcado como "No llegó".`, () => Datos.reactivarReserva(r));
    }
  });

  $('#btn-sin-reserva').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const datos = await UI.autoSinReserva(negocio, servicios, revisarAlcance);
    if (!datos) return;
    await asegurarTurno();
    ejecutar(boton, () => Datos.registrarAutoSinReserva(usuario, datos), `Lavado iniciado: ${datos.patente}`, (r) => Datos.anularSinReserva(r));
  });

  $('#btn-otra').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const datos = await UI.otraActividad();
    if (datos) ejecutar(boton, () => Datos.registrarActividad(usuario, { tipo: 'otra', ...datos }), 'Actividad registrada.');
  });

  // ¿Alcanza a lavarse ahora un auto sin reserva? Mira las reservas y lavados de hoy y la capacidad del local.
  function revisarAlcance(servicio) {
    const ahoraMin = minutosAhora();
    const hoy = Datos.fechaISO();
    const cap = negocio.capacidadSimultanea;
    const base = { reservas: estado.reservas, servicios, fecha: hoy, ahoraMin };
    const calcular = (s) => Datos.ocupacionEntre({ ...base, desdeMin: ahoraMin, duracionMin: s.duracionMin });
    const o = calcular(servicio);
    const cierre = Datos.horarioDelDia(negocio, hoy).cierre;
    const despuesCierre = ahoraMin + servicio.duracionMin > Datos.aMinutos(cierre)
      ? ` Ojo: terminaría después del cierre (${esc(cierre)}).` : '';
    if (o.maximo < cap) {
      const termina = Datos.aHora(Math.min(ahoraMin + servicio.duracionMin, 1439));
      const proxima = o.tramos.filter(t => t.reserva.estado === 'pendiente').sort((a, b) => a.ini - b.ini)[0];
      const extra = proxima ? ` Hay una reserva a las ${esc(proxima.reserva.hora)}, pero queda lugar.` : '';
      return { alcanza: true, html: `<div class="alcance si"><svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg>
        <span><strong>Alcanza.</strong> Si empiezas ahora, termina cerca de las ${termina}.${extra}${despuesCierre}</span></div>` };
    }
    const cortos = servicios.filter(s => !s.oculto && s.duracionMin < servicio.duracionMin && calcular(s).maximo < cap);
    const libre = Datos.proximoLugarLibre({ ...base, negocio, duracionMin: servicio.duracionMin });
    const sugerencias = [
      cortos.length && `Con ${cortos.map(s => `${esc(s.nombre)} (${esc(s.duracionMin)} min)`).join(' o ')} sí alcanza ahora.`,
      libre ? `Para ${esc(servicio.nombre)}, el próximo lugar libre es a las <strong>${libre}</strong>.` : 'Hoy ya no queda lugar para este lavado.'
    ].filter(Boolean).join(' ');
    return { alcanza: false, html: `<div class="alcance no"><svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
      <span><strong>No alcanza.</strong> A las ${o.momentoLleno} el local estará lleno. ${sugerencias}${despuesCierre}</span></div>` };
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
  // Los autos ya lavados se muestran atenuados (no ocupan lugar).
  function pintarAgenda() {
    const f = estado.agendaFecha;
    const esHoy = f === Datos.fechaISO();
    $('#agenda-fecha').value = f;
    $('#titulo-agenda-dia').textContent = `Agenda · ${UI.textoDia(f)}`;
    const { intervaloMin } = negocio.horario;
    const { abierto, apertura, cierre } = Datos.horarioDelDia(negocio, f);
    if (!abierto) {
      $('#agenda-resumen').textContent = '';
      $('#linea-tiempo').innerHTML = '<li class="tarjeta vacio">El local está cerrado este día.</li>';
      return;
    }
    const ahoraMin = minutosAhora();
    const cap = negocio.capacidadSimultanea;
    const tramos = Datos.tramosDelDia({ reservas: estado.agendaReservas, servicios, fecha: f, ahoraMin: esHoy ? ahoraMin : null, incluirHechos: true });
    const filas = [];
    for (let m = Datos.aMinutos(apertura); m < Datos.aMinutos(cierre); m += intervaloMin) {
      const fin = m + intervaloMin;
      const enFranja = tramos.filter(t => t.ini < fin && t.fin > m).sort((a, b) => a.ini - b.ini);
      const ocupan = enFranja.filter(t => !t.hecho);
      const pasada = esHoy && fin <= ahoraMin;
      const actual = esHoy && m <= ahoraMin && ahoraMin < fin;
      const libres = Math.max(0, cap - ocupan.length);
      const clase = libres === 0 ? 'llena' : ocupan.length ? 'parcial' : 'libre';
      filas.push(`
        <li class="franja ${clase}${pasada ? ' pasada' : ''}${actual ? ' actual' : ''}"${actual ? ' aria-current="time"' : ''}>
          <span class="franja-hora">${Datos.aHora(m)}${actual ? '<span class="franja-ahora">Ahora</span>' : ''}</span>
          <div class="franja-autos">${enFranja.length ? enFranja.map(t => {
            const r = t.reserva;
            const empieza = t.ini >= m && t.ini < fin; // en las filas siguientes el auto aparece atenuado ("sigue")
            return `<span class="auto-franja ${t.hecho ? 'hecho' : esc(r.estado)}${empieza ? '' : ' sigue'}">${esc(r.patente)} · ${esc(servicioCorto(r))}${r.trabajadorNombre ? ' · ' + esc(primerNombre(r.trabajadorNombre)) : ''}</span>`;
          }).join('') : '<span class="texto-2">Libre</span>'}</div>
          <span class="franja-cupo">${libres === 0 ? 'Lleno' : `${libres} ${libres === 1 ? 'libre' : 'libres'}`}</span>
        </li>`);
    }
    $('#linea-tiempo').innerHTML = filas.join('');
    const delDia = estado.agendaReservas.filter(r => r.fecha === f && r.estado !== 'cancelada');
    const hechos = delDia.filter(r => r.estado === 'listo' || r.estado === 'entregado').length;
    $('#agenda-resumen').textContent = `${delDia.length} ${delDia.length === 1 ? 'auto' : 'autos'} este día${hechos ? ` (${hechos} ya ${hechos === 1 ? 'lavado' : 'lavados'})` : ''} · caben ${cap} a la vez`;
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
    const enCurso = Datos.turnoDeHoy(lista, usuario.uid).enTurno;
    $('#kpis-historial').innerHTML = [
      ['Lavados', lavados], ['Cobrado', Datos.dinero(cobrado)],
      [enCurso ? 'Horas (turno en curso)' : 'Horas trabajadas', Datos.formatoHoras(minutos)], ['Días trabajados', dias]
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
