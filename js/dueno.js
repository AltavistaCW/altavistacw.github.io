/* Panel maestro del dueño: operación del día, actividad del equipo, equipo, precios y datos del negocio. */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const usuario = await Datos.exigirSesion(['dueno']);

  const hoy = Datos.fechaISO();
  const estado = {
    negocio: null, servicios: [], equipo: [], reservas: [], proximas: [], actividadesHoy: [], actividades: [],
    fecha: hoy, filtro: 'todos', periodo: 1, pestana: 'hoy',
    act: { desde: hoy, hasta: hoy, uid: '', tipo: '', atajo: 'hoy' },
    sucio: { precios: false, negocio: false }
  };
  const NOMBRES_SECCION = { precios: 'Precios', negocio: 'Negocio' };

  try {
    [estado.negocio, estado.servicios, estado.equipo] = await Promise.all([Datos.negocio(), Datos.servicios(), Datos.equipo()]);
  } catch (err) {
    $('#avisos').innerHTML = `<div class="aviso">No se pudieron cargar los datos. ${esc(UI.mensajeError(err))}</div>`;
    return;
  }

  // Al salir con cambios sin guardar se pregunta antes de cerrar la sesión.
  UI.prepararCabecera(usuario, estado.negocio, {
    antesDeSalir: () => {
      const sucias = Object.keys(estado.sucio).filter(k => estado.sucio[k]).map(k => NOMBRES_SECCION[k]);
      return sucias.length
        ? confirm(`Tienes cambios sin guardar en ${sucias.join(' y ')}. Si sales, se pierden. ¿Salir igual?`)
        : confirm('¿Cerrar sesión?');
    }
  });

  const servicioNombre = (r) => Datos.nombreServicio(estado.servicios, r.servicioId, r.servicioNombre);
  const nombreVehiculo = (id) => estado.negocio.tiposVehiculo.find(v => v.id === id)?.nombre ?? id;
  const sumar = (lista, campo) => lista.reduce((t, x) => t + (Number(x[campo]) || 0), 0);
  const kpi = ([etiqueta, valor]) => `<div class="tarjeta kpi"><div class="etiqueta">${etiqueta}</div><div class="valor">${valor}</div></div>`;
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const horasCortas = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  const todasLasReservas = () => [...estado.proximas, ...estado.reservas];

  // ===== Avisos (modo demo / base de datos sin configuración) =====
  async function pintarAvisos() {
    if (Datos.modo === 'demo') {
      $('#avisos').innerHTML = `
        <div class="aviso aviso-demo">
          <svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
          <span style="flex:1">Modo de prueba: los datos son de ejemplo y quedan solo en este celular.</span>
          <button type="button" class="btn btn-secundario btn-sm" data-aviso="reiniciar">Reiniciar</button>
        </div>`;
    } else if (!(await Datos.configGuardada())) {
      $('#avisos').innerHTML = `
        <div class="aviso" style="margin-bottom:20px">
          <svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
          <span style="flex:1">La base de datos todavía no tiene tus precios ni tu horario. Cárgalos una vez para poder editarlos aquí.</span>
          <button type="button" class="btn btn-primario btn-sm" data-aviso="subir">Cargar datos iniciales</button>
        </div>`;
    } else {
      $('#avisos').innerHTML = '';
    }
  }

  $('#avisos').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-aviso]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.dataset.aviso === 'reiniciar') {
        if (!confirm('¿Borrar todo lo registrado en esta prueba y volver a los datos de ejemplo?')) { btn.disabled = false; return; }
        await Datos.reiniciarDemo();
        location.reload();
        return;
      }
      await Datos.subirConfigInicial();
      [estado.negocio, estado.servicios] = await Promise.all([Datos.negocio(), Datos.servicios()]);
      UI.aviso('Datos iniciales cargados. Ya puedes editarlos.');
      await pintarAvisos();
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
      btn.disabled = false;
    }
  });

  // ===== Pestaña: Hoy =====
  async function cargarHoy() {
    const hoyMismo = Datos.fechaISO();
    try {
      [estado.reservas, estado.actividadesHoy, estado.proximas] = await Promise.all([
        Datos.reservasConContacto({ desde: Datos.sumarDias(estado.fecha, -6), hasta: estado.fecha }),
        Datos.actividades({ desde: hoyMismo, hasta: hoyMismo }),
        Datos.reservasConContacto({ desde: hoyMismo, hasta: Datos.sumarDias(hoyMismo, 60) })
      ]);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    pintarHoy();
    pintarPorConfirmar();
  }

  // Reservas nuevas de clientes (de hoy en adelante) que falta confirmar por WhatsApp.
  function pintarPorConfirmar() {
    const lista = estado.proximas.filter(Datos.porConfirmar);
    $('#por-confirmar').hidden = !lista.length;
    $('#n-por-confirmar').textContent = lista.length;
    if (estado.pestana === 'hoy') document.title = lista.length ? `(${lista.length}) ${TITULOS.hoy}` : TITULOS.hoy;
    $('#lista-por-confirmar').innerHTML = lista.map(r => `
      <li>
        <div class="confirmar-datos">
          <strong>${esc(UI.textoDia(r.fecha))}, ${esc(r.hora)} h</strong>
          <span class="texto-2">${esc(r.cliente || 'Sin nombre')} · <span class="patente">${esc(r.patente)}</span> · ${esc(servicioNombre(r))}</span>
        </div>
        ${UI.botonConfirmar(r, estado.negocio, estado.servicios)}
      </li>`).join('');
  }

  // El enlace abre WhatsApp en otra pestaña; aquí solo se marca la reserva como confirmada.
  $('[data-panel="hoy"]').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-confirmar]');
    if (!el) return;
    const r = todasLasReservas().find(x => x.id === el.dataset.confirmar);
    if (!r) return;
    try {
      await Datos.confirmarReserva(r, usuario);
      UI.aviso(`Reserva de ${r.patente} confirmada.`);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    await cargarHoy();
  });

  const delDia = () => estado.reservas.filter(r => r.fecha === estado.fecha);

  function moverDia(dias) { estado.fecha = Datos.sumarDias(estado.fecha, dias); cargarHoy(); }
  $('#dia-anterior').addEventListener('click', () => moverDia(-1));
  $('#dia-siguiente').addEventListener('click', () => moverDia(1));
  $('#ir-hoy').addEventListener('click', () => { estado.fecha = Datos.fechaISO(); cargarHoy(); });
  $('#fecha').addEventListener('change', (e) => { if (e.target.value) { estado.fecha = e.target.value; cargarHoy(); } });

  // "Cobrado" sale de los cobros registrados; "Total estimado" suma lo cobrado y lo que falta por cobrar del día.
  function pintarKpis(lista) {
    const activas = lista.filter(r => r.estado !== 'cancelada');
    const porCobrar = activas.filter(r => r.estado !== 'entregado');
    const porAtender = activas.filter(r => r.estado === 'pendiente' || r.estado === 'en-proceso').length;
    const cobrado = sumar(activas, 'cobrado');
    $('#kpis').innerHTML = [
      ['Cobrado', Datos.dinero(cobrado)],
      ['Total estimado', Datos.dinero(cobrado + sumar(porCobrar, 'precio'))],
      ['Reservas', activas.length],
      ['Por atender', porAtender]
    ].map(kpi).join('');
  }

  // Ranking: lavados ya realizados (listos o entregados) por servicio. Lo reservado aún no cuenta como venta.
  function pintarRanking() {
    const desde = Datos.sumarDias(estado.fecha, -(estado.periodo - 1));
    const lista = estado.reservas.filter(r => r.fecha >= desde && r.fecha <= estado.fecha && (r.estado === 'listo' || r.estado === 'entregado'));
    const total = lista.length;
    const ids = [...new Set([...estado.servicios.filter(s => !s.oculto).map(s => s.id), ...lista.map(r => r.servicioId)])];
    const filas = ids.map(id => {
      const delServicio = lista.filter(r => r.servicioId === id);
      return { nombre: delServicio[0] ? servicioNombre(delServicio[0]) : Datos.nombreServicio(estado.servicios, id), n: delServicio.length, cobrado: sumar(delServicio, 'cobrado') };
    }).sort((a, b) => b.n - a.n || b.cobrado - a.cobrado);
    const max = Math.max(1, ...filas.map(f => f.n));

    if (!total) {
      $('#ranking').innerHTML = `<li class="vacio" style="padding:16px 0">${estado.fecha > Datos.fechaISO() ? 'Este día todavía no llega.' : 'Todavía no hay lavados realizados en este período.'}</li>`;
      $('#ranking-nota').textContent = '';
      return;
    }
    $('#ranking').innerHTML = filas.map((f, i) => {
      const pct = Math.round((f.n / total) * 100);
      const lider = i === 0 && f.n > 0 && filas[1]?.n !== f.n;
      return `
        <li class="ranking-fila" title="${esc(f.nombre)}: ${f.n} de ${total} lavados (${pct}%)">
          <div class="ranking-texto">
            <span class="ranking-nombre">${esc(f.nombre)}${lider ? ' <span class="chip listo">Más vendido</span>' : ''}</span>
            <span class="ranking-valor"><strong>${f.n}</strong> · ${pct}%</span>
          </div>
          <div class="ranking-pista" aria-hidden="true"><div class="ranking-barra" style="width:${(f.n / max) * 100}%"></div></div>
          <span class="ranking-ingresos">${Datos.dinero(f.cobrado)} cobrados</span>
        </li>`;
    }).join('');
    $('#ranking-nota').textContent = `${plural(total, 'lavado realizado', 'lavados realizados')} ${estado.periodo === 1 ? 'este día' : 'en los últimos 7 días'}.`;
  }

  $('#periodo-ranking').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-periodo]');
    if (!btn) return;
    estado.periodo = Number(btn.dataset.periodo);
    $('#periodo-ranking').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    pintarRanking();
  });

  function pintarFiltro(lista) {
    const opciones = [['todos', 'Todos', lista.length],
      ...Object.entries(Datos.ESTADOS).map(([id, e]) => [id, e.texto, lista.filter(r => r.estado === id).length])];
    $('#filtro-estado').innerHTML = opciones.map(([id, texto, n]) =>
      `<button type="button" data-filtro="${id}" aria-pressed="${estado.filtro === id}">${texto} (${n})</button>`).join('');
  }

  const boton = (accion, id, texto, clase = 'btn-secundario') =>
    `<button type="button" class="btn ${clase} btn-sm" data-accion="${accion}" data-id="${esc(id)}">${texto}</button>`;

  // Botón principal según el estado + "Más opciones" para lo menos frecuente.
  function accionesTurno(r) {
    const esFuturo = r.fecha > Datos.fechaISO();
    const mas = boton('mas', r.id, 'Más opciones');
    if (r.estado === 'pendiente') {
      return [
        Datos.porConfirmar(r) ? UI.botonConfirmar(r, estado.negocio, estado.servicios) : '',
        esFuturo ? '' : boton('iniciar', r.id, 'Iniciar lavado', 'btn-primario'),
        Datos.atraso(r) > Datos.TOLERANCIA_ATRASO ? boton('nollego', r.id, 'No llegó') : '',
        mas
      ].join('');
    }
    if (r.estado === 'en-proceso') return boton('terminar', r.id, 'Marcar listo', 'btn-primario') + mas;
    if (r.estado === 'listo') {
      const msj = encodeURIComponent(`Hola${r.cliente ? ' ' + r.cliente.split(' ')[0] : ''}, tu vehículo patente ${r.patente} ya está listo para retiro. ¡Gracias por preferir ${estado.negocio.nombre}!`);
      return boton('cobrar', r.id, 'Cobrar y entregar', 'btn-primario') +
        (r.telefono ? `<a class="btn btn-secundario btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(r.telefono)}?text=${msj}">
          <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Avisar al cliente</a>` : '');
    }
    if (r.estado === 'cancelada' && !r.anulada) return boton('reactivar', r.id, 'Reactivar reserva');
    return '';
  }

  function pintarAgenda(lista) {
    const visibles = estado.filtro === 'todos' ? lista : lista.filter(r => r.estado === estado.filtro);
    if (!visibles.length) {
      $('#agenda').innerHTML = '<li class="tarjeta vacio">No hay reservas para mostrar.</li>';
      return;
    }
    $('#agenda').innerHTML = visibles.map(r => {
      const atraso = Datos.atraso(r);
      return `
        <li class="tarjeta turno ${esc(r.estado)}">
          <div class="turno-cabecera">
            <span class="turno-hora">${esc(r.hora)}</span>
            <span class="chips-turno">
              ${atraso > Datos.TOLERANCIA_ATRASO ? `<span class="chip atrasado">Atrasado ${atraso} min</span>` : ''}
              ${Datos.porConfirmar(r) ? '<span class="chip por-confirmar">Por confirmar</span>' : ''}
              <span class="chip ${esc(r.estado)}">${esc(Datos.textoEstado(r))}</span>
            </span>
          </div>
          <div class="turno-detalle">
            <span><strong>${esc(servicioNombre(r))}</strong> · ${esc(nombreVehiculo(r.vehiculo))}</span>
            <span class="patente">${esc(r.patente)}</span>
            ${r.cliente ? `<span>${esc(r.cliente)}</span>` : ''}
            <span><strong>${Datos.dinero(r.precio)}</strong></span>
            ${r.origen === 'local' ? '<span>Sin reserva</span>' : ''}
          </div>
          ${r.trabajadorNombre || r.asignadoNombre || r.cobrado != null ? `<div class="turno-detalle">
            ${r.trabajadorNombre ? `<span>A cargo: <strong>${esc(r.trabajadorNombre)}</strong></span>` : r.asignadoNombre ? `<span>Asignado a: <strong>${esc(r.asignadoNombre)}</strong></span>` : ''}
            ${r.cobrado != null ? `<span>Cobrado: <strong>${Datos.dinero(r.cobrado)}</strong> · ${esc(r.medioPago ?? '')}${r.motivoAjuste ? ` · ${esc(r.motivoAjuste)}` : ''}</span>` : ''}
          </div>` : ''}
          ${r.comentario ? `<p class="nota-cliente">Nota del cliente: ${esc(r.comentario)}</p>` : ''}
          <div class="turno-acciones">${accionesTurno(r)}</div>
        </li>`;
    }).join('');
  }

  function pintarEquipoHoy() {
    // Trabajadores con acceso, más cualquier dueño que haya marcado entrada hoy.
    const personas = estado.equipo.filter(m => m.activo && (m.rol === 'trabajador' || estado.actividadesHoy.some(a => a.uid === m.uid && a.tipo === 'entrada')));
    if (!personas.length) {
      $('#equipo-hoy').innerHTML = '<li class="texto-2">Aún no hay trabajadores. <a href="#equipo">Dar acceso a alguien</a></li>';
      return;
    }
    $('#equipo-hoy').innerHTML = personas.map(m => {
      const turno = Datos.turnoDeHoy(estado.actividadesHoy, m.uid);
      const lavados = estado.actividadesHoy.filter(a => a.uid === m.uid && a.tipo === 'lavado').length;
      return `
        <li>
          <span><strong>${esc(m.nombre)}</strong><br><span class="texto-2">${plural(lavados, 'lavado', 'lavados')} hoy</span></span>
          <span class="chip ${turno.enTurno ? 'listo' : 'entregado'}">${turno.enTurno ? `En turno desde ${esc(turno.desde)}` : 'Fuera de turno'}</span>
        </li>`;
    }).join('');
  }

  function pintarHoy() {
    const lista = delDia();
    $('#fecha').value = estado.fecha;
    $('#titulo-dia').textContent = estado.fecha === Datos.fechaISO() ? `Hoy, ${UI.textoFechaLarga(estado.fecha).toLowerCase()}` : UI.textoFechaLarga(estado.fecha);
    pintarKpis(lista);
    pintarFiltro(lista);
    pintarAgenda(lista);
    pintarEquipoHoy();
    pintarRanking();
  }

  $('#filtro-estado').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filtro]');
    if (!btn) return;
    estado.filtro = btn.dataset.filtro;
    pintarHoy();
  });

  async function elegirPersona(titulo, aceptar, preferidoUid) {
    const activos = estado.equipo.filter(m => m.activo);
    const preferido = activos.find(m => m.uid === preferidoUid) ?? activos.find(m => m.rol === 'trabajador') ?? activos[0];
    const d = await UI.dialogo({
      titulo, aceptar,
      cuerpo: `<div class="campo"><label for="d-quien">Persona</label>
        <select id="d-quien" name="uid">${activos.map(m => `<option value="${esc(m.uid)}" ${m === preferido ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></div>`
    });
    return d && activos.find(m => m.uid === d.uid);
  }

  // Elegir otra fecha y hora libre para una reserva.
  async function reprogramar(r) {
    const duracionMin = r.duracionMin ?? estado.servicios.find(s => s.id === r.servicioId)?.duracionMin ?? 30;
    let dia = r.fecha < Datos.fechaISO() ? Datos.fechaISO() : r.fecha;
    let ocupadas = [];
    const horasDe = (f) => Datos.horariosDisponibles({ negocio: estado.negocio, servicios: estado.servicios, reservas: ocupadas, fecha: f, duracionMin, excluirId: r.id });
    const cargarDia = async (f) => { ocupadas = await Datos.reservas({ desde: f, hasta: f }).catch(() => []); };
    await cargarDia(dia);
    const d = await UI.dialogo({
      titulo: `Cambiar hora · ${r.patente}`,
      aceptar: 'Guardar nueva hora',
      cuerpo: `
        <p class="texto-2">Ahora: ${esc(UI.textoDia(r.fecha))}, ${esc(r.hora)} h. Después tendrás que confirmarle la nueva hora al cliente.</p>
        <div class="campo"><label for="d-dia">Día</label><input type="date" id="d-dia" name="fecha" required min="${Datos.fechaISO()}" value="${dia}"></div>
        <div class="campo"><label for="d-hora">Hora libre</label><select id="d-hora" name="hora" required></select></div>`,
      alAbrir(form) {
        const pintarHoras = () => {
          const horas = horasDe(form.fecha.value);
          form.hora.innerHTML = horas.length ? horas.map(h => `<option ${h === r.hora ? 'selected' : ''}>${h}</option>`).join('') : '<option value="">Sin horas libres ese día</option>';
        };
        form.fecha.addEventListener('change', async () => { await cargarDia(form.fecha.value); pintarHoras(); });
        pintarHoras();
      },
      validar: (form) => (form.hora.value ? '' : 'Ese día no hay horas libres. Elige otro.')
    });
    if (!d) return false;
    await Datos.reprogramarReserva(r, { fecha: d.fecha, hora: d.hora });
    return `${r.patente}: nueva hora ${UI.textoDia(d.fecha).toLowerCase()} a las ${d.hora}. Recuerda confirmarle al cliente.`;
  }

  async function cancelar(r) {
    const d = await UI.dialogo({
      titulo: 'Cancelar reserva',
      aceptar: 'Sí, cancelar',
      peligro: true,
      cuerpo: `<p><span class="patente">${esc(r.patente)}</span> · ${esc(UI.textoDia(r.fecha))}, ${esc(r.hora)} h · ${esc(servicioNombre(r))}${r.cliente ? ` · ${esc(r.cliente)}` : ''}</p>
        <p class="texto-2">La hora queda libre para otros clientes.</p>`
    });
    if (!d) return false;
    await Datos.cancelarReserva(r, usuario);
    const enlace = UI.enlaceCancelacion(r, estado.negocio);
    UI.aviso('Reserva cancelada.', 'exito', enlace ? { texto: 'Avisar al cliente', alHacer: () => window.open(enlace, '_blank', 'noopener') } : null);
    return true;
  }

  $('#agenda').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const r = estado.reservas.find(x => x.id === btn.dataset.id);
    if (!r) return;
    let accion = btn.dataset.accion;
    let texto = '';
    let deshacer = null;
    try {
      if (accion === 'mas') {
        const opciones = r.estado === 'pendiente'
          ? [{ clave: 'asignar', texto: r.asignadoNombre ? `Cambiar asignado (${r.asignadoNombre})` : 'Asignar a una persona' },
             { clave: 'reprogramar', texto: 'Cambiar día u hora' },
             { clave: 'cancelar', texto: 'Cancelar reserva', peligro: true }]
          : [{ clave: 'asignar', texto: `Cambiar quién lo lava (${r.trabajadorNombre ?? 'nadie'})` },
             { clave: 'volver', texto: 'Volver a "Pendiente" (se tocó por error)' },
             { clave: 'cancelar', texto: 'Cancelar reserva', peligro: true }];
        accion = await UI.elegir(`${r.patente} · ${r.hora} h`, opciones);
        if (!accion) return;
      }
      if (accion === 'iniciar') {
        const quien = await elegirPersona('¿Quién lo lava?', 'Iniciar lavado', r.asignadoUid);
        if (!quien) return;
        await Datos.iniciarLavado(r, quien);
        texto = `${quien.nombre} está lavando ${r.patente}`;
        deshacer = () => Datos.deshacerInicio(r);
      } else if (accion === 'terminar') {
        const act = await Datos.terminarLavado(r, usuario);
        texto = `Listo: ${r.patente}`;
        deshacer = () => Datos.deshacerTermino(r, act);
      } else if (accion === 'cobrar') {
        const pago = await UI.cobro(r, estado.negocio, estado.servicios);
        if (!pago) return;
        const act = await Datos.cobrar(r, pago, usuario);
        texto = `Cobro registrado: ${Datos.dinero(pago.monto)}`;
        deshacer = () => Datos.deshacerCobro(r, act);
      } else if (accion === 'nollego') {
        if (!confirm(`¿Marcar que ${r.patente} (${r.hora}) no llegó? Su lugar queda libre.`)) return;
        await Datos.marcarNoLlego(r, usuario);
        texto = `${r.patente}: marcado como "No llegó".`;
        deshacer = () => Datos.reactivarReserva(r);
      } else if (accion === 'reactivar') {
        await Datos.reactivarReserva(r);
        texto = `${r.patente} vuelve a estar reservado.`;
      } else if (accion === 'asignar') {
        const quien = await elegirPersona(r.estado === 'pendiente' ? 'Asignar reserva' : '¿Quién lo lava?', 'Guardar', r.asignadoUid ?? r.trabajadorUid);
        if (!quien) return;
        await Datos.asignarReserva(r, quien);
        texto = `${r.patente} queda a cargo de ${quien.nombre}.`;
      } else if (accion === 'volver') {
        await Datos.deshacerInicio(r);
        texto = `${r.patente} vuelve a "Pendiente".`;
      } else if (accion === 'reprogramar') {
        const resultado = await reprogramar(r);
        if (!resultado) return;
        texto = resultado;
      } else if (accion === 'cancelar') {
        if (!(await cancelar(r))) return;
      }
      if (texto) UI.aviso(texto, 'exito', deshacer ? { texto: 'Deshacer', alHacer: async () => { await deshacer(); UI.aviso('Listo, se deshizo.'); cargarHoy(); } } : null);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    await cargarHoy();
  });

  // ===== Pestaña: Actividad del equipo =====
  function rangoAtajo(atajo) {
    const h = Datos.fechaISO();
    if (atajo === 'ayer') { const a = Datos.sumarDias(h, -1); return { desde: a, hasta: a }; }
    if (atajo === 'semana') return { desde: Datos.sumarDias(h, -6), hasta: h };
    if (atajo === 'mes') return { desde: h.slice(0, 8) + '01', hasta: h };
    return { desde: h, hasta: h };
  }

  function pintarFiltrosActividad() {
    const f = $('#filtros-actividad');
    f.desde.value = estado.act.desde;
    f.hasta.value = estado.act.hasta;
    f.uid.innerHTML = '<option value="">Todo el equipo</option>' +
      estado.equipo.map(m => `<option value="${esc(m.uid)}">${esc(m.nombre)}</option>`).join('');
    f.uid.value = estado.act.uid;
    f.tipo.innerHTML = '<option value="">Todo</option>' +
      Object.entries(Datos.TIPOS_ACTIVIDAD).map(([id, t]) => `<option value="${id}">${t.texto}</option>`).join('');
    f.tipo.value = estado.act.tipo;
    $('#atajos-periodo').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.atajo === estado.act.atajo)));
  }

  async function cargarActividad() {
    pintarFiltrosActividad();
    try {
      estado.actividades = await Datos.actividades({ desde: estado.act.desde, hasta: estado.act.hasta });
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    pintarActividad();
  }

  function pintarActividad() {
    const { uid, tipo } = estado.act;
    const dePersona = estado.actividades.filter(a => !uid || a.uid === uid);
    const visibles = dePersona.filter(a => !tipo || a.tipo === tipo);
    const cobros = dePersona.filter(a => a.tipo === 'cobro');
    const enCurso = Datos.hayTurnosAbiertos(dePersona);

    $('#kpis-actividad').innerHTML = [
      ['Lavados', dePersona.filter(a => a.tipo === 'lavado').length],
      ['Cobrado', Datos.dinero(sumar(cobros, 'monto'))],
      [enCurso ? 'Horas (con turnos en curso)' : 'Horas trabajadas', Datos.formatoHoras(Datos.minutosTrabajados(dePersona))],
      ['Personas que trabajaron', new Set(dePersona.filter(a => a.tipo === 'entrada').map(a => a.uid)).size]
    ].map(kpi).join('');

    $('#lista-actividad').innerHTML = UI.listaPorDia(visibles, { servicios: estado.servicios, conNombre: !uid, conCorregir: true });

    // Por persona
    const personas = [...new Map(dePersona.map(a => [a.uid, a.nombre])).entries()];
    $('#tabla-por-persona').innerHTML = personas.length ? `
      <thead><tr><th>Persona</th><th class="num">Lav.</th><th class="num">Cobrado</th><th class="num">Horas</th></tr></thead>
      <tbody>${personas.map(([id, nombre]) => {
        const suyas = dePersona.filter(a => a.uid === id);
        return `<tr><td>${esc(nombre.split(' ')[0])}</td>
          <td class="num">${suyas.filter(a => a.tipo === 'lavado').length}</td>
          <td class="num">${Datos.dinero(sumar(suyas.filter(a => a.tipo === 'cobro'), 'monto'))}</td>
          <td class="num">${horasCortas(Datos.minutosTrabajados(suyas))}${Datos.turnoDeHoy(suyas, id).enTurno ? '*' : ''}</td></tr>`;
      }).join('')}</tbody>
      ${enCurso ? '<caption class="texto-2">* turno en curso, cuenta hasta ahora</caption>' : ''}` : '<tbody><tr><td class="texto-2">Sin registros.</td></tr></tbody>';

    // Caja por medio de pago
    const medios = [...new Set([...(estado.negocio.mediosPago ?? []), ...cobros.map(c => c.medioPago)])].filter(Boolean);
    $('#tabla-caja').innerHTML = `
      <thead><tr><th>Medio</th><th class="num">Cobros</th><th class="num">Monto</th></tr></thead>
      <tbody>${medios.map(m => {
        const deMedio = cobros.filter(c => c.medioPago === m);
        return `<tr><td>${esc(m)}</td><td class="num">${deMedio.length}</td><td class="num">${Datos.dinero(sumar(deMedio, 'monto'))}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th>Total</th><th class="num">${cobros.length}</th><th class="num">${Datos.dinero(sumar(cobros, 'monto'))}</th></tr></tfoot>`;
  }

  $('#atajos-periodo').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-atajo]');
    if (!btn) return;
    estado.act = { ...estado.act, ...rangoAtajo(btn.dataset.atajo), atajo: btn.dataset.atajo };
    cargarActividad();
  });

  $('#filtros-actividad').addEventListener('change', (e) => {
    const f = e.currentTarget;
    const recargar = e.target === f.desde || e.target === f.hasta;
    estado.act = { desde: f.desde.value || hoy, hasta: f.hasta.value || hoy, uid: f.uid.value, tipo: f.tipo.value, atajo: recargar ? '' : estado.act.atajo };
    if (estado.act.desde > estado.act.hasta) estado.act.hasta = estado.act.desde;
    if (recargar) cargarActividad(); else pintarActividad();
  });

  // Corregir un registro: un cobro se puede editar (monto y medio); cualquier registro se puede borrar.
  $('#lista-actividad').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-corregir]');
    if (!btn) return;
    const a = estado.actividades.find(x => x.id === btn.dataset.corregir);
    if (!a) return;
    try {
      if (a.tipo === 'cobro') {
        const medios = estado.negocio.mediosPago ?? [];
        const d = await UI.dialogo({
          titulo: `Corregir cobro · ${a.patente ?? ''}`,
          aceptar: 'Guardar corrección',
          cuerpo: `
            <div class="campo"><label for="d-monto-c">Monto</label><input id="d-monto-c" name="monto" type="number" min="0" step="1" inputmode="numeric" required value="${esc(a.monto ?? 0)}"></div>
            <div class="campo"><label for="d-medio-c">Medio de pago</label><select id="d-medio-c" name="medioPago">${[...new Set([...medios, a.medioPago])].filter(Boolean).map(m => `<option ${m === a.medioPago ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
            <label class="check"><input type="checkbox" name="borrar"> Borrar este cobro (el auto vuelve a "Listo" para cobrarlo de nuevo)</label>`
        });
        if (!d) return;
        if (d.borrar) { await Datos.borrarActividad(a); UI.aviso('Cobro borrado. La caja y el día quedaron actualizados.'); }
        else { await Datos.editarCobro(a, { monto: Number(d.monto), medioPago: d.medioPago }); UI.aviso('Cobro corregido. La caja y el día quedaron actualizados.'); }
      } else {
        if (!confirm(`¿Borrar este registro (${Datos.TIPOS_ACTIVIDAD[a.tipo]?.texto ?? a.tipo} de ${a.nombre}, ${a.hora})?`)) return;
        await Datos.borrarActividad(a);
        UI.aviso('Registro borrado.');
      }
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    await cargarActividad();
  });

  // ===== Pestaña: Equipo =====
  async function cargarEquipo() {
    try {
      [estado.equipo, estado.actividadesHoy] = await Promise.all([
        Datos.equipo(), Datos.actividades({ desde: Datos.fechaISO(), hasta: Datos.fechaISO() })
      ]);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    pintarEquipo();
  }

  function pintarEquipo() {
    $('#lista-equipo').innerHTML = estado.equipo.map(m => {
      const yo = m.uid === usuario.uid;
      const turno = Datos.turnoDeHoy(estado.actividadesHoy, m.uid);
      const uid = esc(m.uid);
      return `
        <li class="tarjeta miembro ${m.activo ? '' : 'inactivo'}">
          <div class="miembro-cabecera">
            <div>
              <strong class="miembro-nombre">${esc(m.nombre)}</strong>${yo ? ' <span class="texto-2">(tú)</span>' : ''}
              <div class="texto-2 miembro-email">${esc(m.email)}</div>
            </div>
            <div class="miembro-chips">
              <span class="chip rol">${esc(Datos.ROLES[m.rol] ?? m.rol)}</span>
              ${!m.activo ? '<span class="chip cancelada">Sin acceso</span>' : turno.enTurno ? `<span class="chip listo">En turno desde ${esc(turno.desde)}</span>` : ''}
            </div>
          </div>
          <div class="turno-acciones">
            <button type="button" class="btn btn-secundario btn-sm" data-accion="nombre" data-uid="${uid}">Cambiar nombre</button>
            ${m.rol === 'trabajador' ? `<button type="button" class="btn btn-secundario btn-sm" data-accion="ver" data-uid="${uid}">Ver su actividad</button>` : ''}
            ${Datos.modo === 'nube' ? `<button type="button" class="btn btn-secundario btn-sm" data-accion="clave" data-uid="${uid}">Enviar correo para nueva clave</button>` : ''}
            ${yo ? '' : `
              <button type="button" class="btn btn-secundario btn-sm" data-accion="rol" data-uid="${uid}">${m.rol === 'dueno' ? 'Pasar a trabajador' : 'Hacer dueño'}</button>
              <button type="button" class="btn ${m.activo ? 'btn-peligro' : 'btn-primario'} btn-sm" data-accion="acceso" data-uid="${uid}">${m.activo ? 'Quitar acceso' : 'Devolver acceso'}</button>`}
          </div>
        </li>`;
    }).join('');
  }

  $('#lista-equipo').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const m = estado.equipo.find(x => x.uid === btn.dataset.uid);
    if (!m) return;
    const accion = btn.dataset.accion;

    if (accion === 'ver') {
      estado.act = { ...estado.act, uid: m.uid, tipo: '' };
      location.hash = 'actividad';
      return;
    }
    try {
      if (accion === 'nombre') {
        const d = await UI.dialogo({
          titulo: 'Cambiar nombre',
          cuerpo: `<div class="campo"><label for="d-nombre">Nombre</label><input id="d-nombre" name="nombre" required minlength="2" value="${esc(m.nombre)}"></div>`
        });
        if (!d) return;
        await Datos.actualizarMiembro(m.uid, { nombre: d.nombre.trim() });
        UI.aviso('Nombre actualizado.');
      } else if (accion === 'rol') {
        const nuevo = m.rol === 'dueno' ? 'trabajador' : 'dueno';
        if (!confirm(nuevo === 'dueno' ? `${m.nombre} tendrá acceso a todo el panel, incluidos precios y equipo. ¿Continuar?` : `${m.nombre} pasará a ver solo su jornada. ¿Continuar?`)) return;
        await Datos.actualizarMiembro(m.uid, { rol: nuevo });
        UI.aviso('Rol actualizado.');
      } else if (accion === 'acceso') {
        if (m.activo && !confirm(`${m.nombre} ya no podrá entrar a la app. Su historial se mantiene. ¿Quitar acceso?`)) return;
        await Datos.actualizarMiembro(m.uid, { activo: !m.activo });
        UI.aviso(m.activo ? 'Acceso quitado.' : 'Acceso devuelto.');
      } else if (accion === 'clave') {
        if (!confirm(`Se enviará un correo a ${m.email} para que cree una clave nueva. ¿Enviar?`)) return;
        await Datos.recuperarClave(m.email);
        UI.aviso(`Correo enviado a ${m.email}.`);
      }
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    await cargarEquipo();
  });

  $('#form-miembro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    $('#resultado-miembro').innerHTML = '';
    const datos = { nombre: f.nombre.value.trim(), email: f.email.value.trim(), clave: f.clave.value.trim(), rol: f.rol.value };
    const error = datos.nombre.length < 2 ? 'Escribe el nombre.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) ? 'Escribe un correo válido.'
      : datos.clave.length < 6 ? 'La clave debe tener al menos 6 caracteres.' : '';
    $('#e-miembro').textContent = error;
    if (error) return;
    if (datos.rol === 'dueno' && !confirm(`${datos.nombre} tendrá acceso a todo el panel, incluidos precios y equipo. ¿Continuar?`)) return;

    const botonEnviar = f.querySelector('[type="submit"]');
    botonEnviar.disabled = true;
    try {
      const nuevo = await Datos.agregarMiembro(datos);
      const enlace = new URL('ingreso.html', location.href).href;
      const mensaje = `Hola ${nuevo.nombre}, ya tienes acceso a la app de ${estado.negocio.nombre}.\nEntra aquí: ${enlace}\nCorreo: ${nuevo.email}\nClave: ${datos.clave}`;
      $('#resultado-miembro').innerHTML = `
        <div class="aviso exito" style="margin-top:16px;display:block">
          <strong>${esc(nuevo.nombre)} ya tiene acceso.</strong><br>
          Entrégale estos datos:<br>
          Enlace: <a href="${esc(enlace)}">${esc(enlace)}</a><br>
          Correo: ${esc(nuevo.email)}<br>
          Clave: <code>${esc(datos.clave)}</code>
          <a class="btn btn-secundario btn-bloque" style="margin-top:12px" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(mensaje)}">
            <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Enviar por WhatsApp
          </a>
        </div>`;
      f.reset();
      await cargarEquipo();
    } catch (err) {
      $('#e-miembro').textContent = UI.mensajeError(err);
    }
    botonEnviar.disabled = false;
  });

  // ===== Pestaña: Servicios y precios =====
  // Quitar un servicio o vehículo lo OCULTA (deja de ofrecerse), así el historial y las estadísticas no se rompen.
  const nuevoIdInterno = (prefijo) => prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  let borradorPrecios = null; // copia de trabajo: { lista, tipos } con todo, incluidos los ocultos

  function pintarPrecios(b) {
    borradorPrecios = b;
    const tiposVisibles = b.tipos.filter(t => !t.oculto);
    $('#editor-servicios').innerHTML = b.lista.filter(s => !s.oculto).map((s, i) => `
      <article class="tarjeta editor-servicio" data-servicio="${esc(s.id)}">
        <div class="fila-2">
          <div class="campo"><label for="s${i}-nombre">Nombre del servicio</label><input id="s${i}-nombre" name="nombre" value="${esc(s.nombre)}" required></div>
          <div class="campo"><label for="s${i}-duracion">Duración (minutos)</label><input id="s${i}-duracion" name="duracionMin" type="number" min="5" step="5" inputmode="numeric" value="${esc(s.duracionMin ?? '')}" required></div>
        </div>
        <div class="campo"><label for="s${i}-desc">Qué incluye</label><input id="s${i}-desc" name="descripcion" value="${esc(s.descripcion ?? '')}" placeholder="Ej.: aspirado, vidrios por dentro y tablero"></div>
        <fieldset class="precios-grid">
          <legend>Precio por tipo de vehículo</legend>
          ${tiposVisibles.map((t, j) => `
            <div class="campo">
              <label for="s${i}-p${j}" data-etiqueta-tipo="${esc(t.id)}">${esc(t.nombre || 'Tipo nuevo')}</label>
              <input id="s${i}-p${j}" name="precio-${esc(t.id)}" data-tipo="${esc(t.id)}" type="number" min="1" step="1" inputmode="numeric" value="${esc(s.precios?.[t.id] ?? '')}" required>
            </div>`).join('')}
        </fieldset>
        <button type="button" class="btn btn-secundario btn-sm" data-mismo-precio>Mismo precio para todos</button>
        <div class="editor-pie">
          <label class="check"><input type="checkbox" name="destacado" ${s.destacado ? 'checked' : ''}> Destacar como "Más pedido"</label>
          <button type="button" class="btn btn-peligro btn-sm" data-ocultar-servicio>Dejar de ofrecer</button>
        </div>
      </article>`).join('');

    const ocultos = b.lista.filter(s => s.oculto);
    $('#servicios-ocultos').innerHTML = ocultos.length ? `
      <details class="tarjeta ocultos"><summary>Servicios que ya no ofreces (${ocultos.length})</summary>
        ${ocultos.map(s => `<div class="fila-oculto"><span>${esc(s.nombre)}</span><button type="button" class="btn btn-secundario btn-sm" data-mostrar-servicio="${esc(s.id)}">Volver a ofrecer</button></div>`).join('')}
      </details>` : '';

    $('#editor-vehiculos').innerHTML = tiposVisibles.map((t, j) => `
      <div class="fila-vehiculo" data-vehiculo-fila="${esc(t.id)}">
        <label class="sr-only" for="v${j}">Tipo de vehículo ${j + 1}</label>
        <input id="v${j}" value="${esc(t.nombre)}" required placeholder="Ej.: Moto">
        <button type="button" class="btn btn-peligro btn-sm" data-ocultar-vehiculo>Quitar</button>
      </div>`).join('');
    const tiposOcultos = b.tipos.filter(t => t.oculto);
    $('#vehiculos-ocultos').innerHTML = tiposOcultos.length ? `
      <details class="ocultos"><summary>Tipos quitados (${tiposOcultos.length})</summary>
        ${tiposOcultos.map(t => `<div class="fila-oculto"><span>${esc(t.nombre)}</span><button type="button" class="btn btn-secundario btn-sm" data-mostrar-vehiculo="${esc(t.id)}">Volver a agregar</button></div>`).join('')}
      </details>` : '';
  }

  // Lee lo escrito en pantalla y lo mezcla con el borrador (que conserva los ocultos y sus precios).
  function leerPrecios() {
    const b = copia(borradorPrecios);
    document.querySelectorAll('[data-vehiculo-fila]').forEach(f => {
      const t = b.tipos.find(x => x.id === f.dataset.vehiculoFila);
      if (t) t.nombre = f.querySelector('input').value.trim();
    });
    document.querySelectorAll('[data-servicio]').forEach(a => {
      const s = b.lista.find(x => x.id === a.dataset.servicio);
      if (!s) return;
      const campo = (n) => a.querySelector(`[name="${n}"]`);
      s.nombre = campo('nombre').value.trim();
      s.descripcion = campo('descripcion').value.trim();
      s.duracionMin = Number(campo('duracionMin').value) || '';
      s.destacado = campo('destacado').checked;
      s.precios = { ...(s.precios ?? {}) };
      a.querySelectorAll('[data-tipo]').forEach(inp => {
        if (inp.value) s.precios[inp.dataset.tipo] = Number(inp.value); else delete s.precios[inp.dataset.tipo];
      });
    });
    return b;
  }

  function marcarSucio(seccion) {
    estado.sucio[seccion] = true;
    $(`#estado-${seccion}`).textContent = 'Cambios sin guardar';
  }

  $('#form-precios').addEventListener('input', (e) => {
    marcarSucio('precios');
    // Al renombrar un tipo de vehículo se actualizan las etiquetas de precios sin redibujar.
    const fila = e.target.closest('[data-vehiculo-fila]');
    if (fila) document.querySelectorAll(`[data-etiqueta-tipo="${fila.dataset.vehiculoFila}"]`)
      .forEach(l => { l.textContent = e.target.value || 'Tipo nuevo'; });
  });

  $('#form-precios').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const redibujar = (b) => { pintarPrecios(b); marcarSucio('precios'); };
    if (t.id === 'agregar-servicio') {
      const b = leerPrecios();
      b.lista.push({ id: nuevoIdInterno('s'), nombre: '', descripcion: '', duracionMin: 30, precios: {} });
      redibujar(b);
      document.querySelector('[data-servicio]:last-of-type input')?.focus();
    } else if (t.id === 'agregar-vehiculo') {
      const b = leerPrecios();
      b.tipos.push({ id: nuevoIdInterno('t'), nombre: '' });
      redibujar(b);
      document.querySelector('[data-vehiculo-fila]:last-of-type input')?.focus();
    } else if ('mismoPrecio' in t.dataset) {
      const art = t.closest('[data-servicio]');
      const d = await UI.dialogo({
        titulo: 'Mismo precio para todos', aceptar: 'Aplicar',
        cuerpo: `<div class="campo"><label for="d-precio-todos">Precio para todos los vehículos</label><input id="d-precio-todos" name="precio" type="number" min="1" step="1" inputmode="numeric" required></div>`
      });
      if (!d) return;
      art.querySelectorAll('[data-tipo]').forEach(inp => { inp.value = d.precio; });
      marcarSucio('precios');
    } else if ('ocultarServicio' in t.dataset) {
      const art = t.closest('[data-servicio]');
      const nombre = art.querySelector('[name="nombre"]').value || 'este servicio';
      if (!confirm(`¿Dejar de ofrecer "${nombre}"? No aparecerá para reservar, pero las reservas y el historial lo mantienen. Puedes volver a ofrecerlo cuando quieras.`)) return;
      const b = leerPrecios();
      b.lista.find(s => s.id === art.dataset.servicio).oculto = true;
      redibujar(b);
    } else if (t.dataset.mostrarServicio) {
      const b = leerPrecios();
      delete b.lista.find(s => s.id === t.dataset.mostrarServicio).oculto;
      redibujar(b);
    } else if ('ocultarVehiculo' in t.dataset) {
      const fila = t.closest('[data-vehiculo-fila]');
      const nombre = fila.querySelector('input').value || 'este tipo';
      if (!confirm(`¿Quitar "${nombre}"? No aparecerá para reservar; sus precios se guardan por si lo vuelves a agregar.`)) return;
      const b = leerPrecios();
      b.tipos.find(x => x.id === fila.dataset.vehiculoFila).oculto = true;
      redibujar(b);
    } else if (t.dataset.mostrarVehiculo) {
      const b = leerPrecios();
      delete b.tipos.find(x => x.id === t.dataset.mostrarVehiculo).oculto;
      redibujar(b);
    }
  });

  $('#form-precios').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const { lista, tipos } = leerPrecios();
    if (!lista.some(s => !s.oculto) || !tipos.some(t => !t.oculto)) { UI.aviso('Debe haber al menos un servicio y un tipo de vehículo.', 'error'); return; }
    // Precios faltantes: se dice exactamente cuáles, en vez de solo saltar al campo vacío.
    const faltan = [];
    f.querySelectorAll('[data-servicio]').forEach(a => {
      const vacios = [...a.querySelectorAll('[data-tipo]')].filter(i => !i.value);
      if (vacios.length) faltan.push({ servicio: a.querySelector('[name="nombre"]').value || 'un servicio nuevo', tipos: vacios.map(i => tipos.find(t => t.id === i.dataset.tipo)?.nombre || 'tipo nuevo'), campo: vacios[0] });
    });
    if (faltan.length) {
      UI.aviso(`Falta el precio de ${faltan[0].tipos.join(', ')} en ${faltan[0].servicio}${faltan.length > 1 ? ` (y en ${faltan.length - 1} servicio${faltan.length > 2 ? 's' : ''} más)` : ''}.`, 'error');
      faltan[0].campo.focus();
      return;
    }
    if (!f.reportValidity()) return;
    const botonGuardar = f.querySelector('[type="submit"]');
    botonGuardar.disabled = true;
    try {
      const negocio = { ...estado.negocio, tiposVehiculo: tipos };
      await Datos.guardarServicios(lista);
      await Datos.guardarNegocio(negocio);
      estado.servicios = lista;
      estado.negocio = negocio;
      estado.sucio.precios = false;
      $('#estado-precios').textContent = 'Guardado';
      UI.aviso('Precios guardados.');
      pintarAvisos();
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    botonGuardar.disabled = false;
  });

  // ===== Pestaña: Negocio y horario =====
  const DIAS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];

  // Texto para clientes agrupando días seguidos con el mismo horario: "Lunes a viernes, 09:00 a 19:00 · Sábado, 09:00 a 14:00".
  function textoHorario(dias) {
    const grupos = [];
    DIAS.forEach(([d, nombre]) => {
      const h = dias[d];
      const clave = h.abierto ? `${h.apertura}-${h.cierre}` : 'cerrado';
      const ultimo = grupos.at(-1);
      if (ultimo && ultimo.clave === clave) ultimo.nombres.push(nombre); else grupos.push({ clave, h, nombres: [nombre] });
    });
    const abiertos = grupos.filter(g => g.clave !== 'cerrado');
    if (!abiertos.length) return 'Cerrado';
    return abiertos.map(g => {
      const n = g.nombres;
      const nombreDias = n.length === 1 ? n[0] : `${n[0]} a ${n.at(-1).toLowerCase()}`;
      return `${nombreDias}, ${g.h.apertura} a ${g.h.cierre}`;
    }).join(' · ');
  }

  function pintarNegocio(n) {
    const f = $('#form-negocio');
    ['nombre', 'eslogan', 'direccion', 'telefono', 'whatsapp'].forEach(c => { f[c].value = n[c] ?? ''; });
    f.mediosPago.value = (n.mediosPago ?? []).join(', ');
    f.intervaloMin.value = String(n.horario.intervaloMin);
    f.capacidadSimultanea.value = n.capacidadSimultanea;
    f.texto.value = n.horario.texto;
    const hoyRef = Datos.fechaISO();
    $('#n-horario-dias').innerHTML = DIAS.map(([d, nombre]) => {
      // Fecha cualquiera con ese día de la semana, para leer su horario actual.
      const fechaDia = Datos.sumarDias(hoyRef, (d - new Date(hoyRef + 'T12:00:00').getDay() + 7) % 7);
      const h = Datos.horarioDelDia(n, fechaDia);
      return `
        <div class="fila-dia" data-dia="${d}">
          <label class="check"><input type="checkbox" name="abierto-${d}" ${h.abierto ? 'checked' : ''}> ${nombre}</label>
          <label class="sr-only" for="ap-${d}">${nombre}: abre</label>
          <input type="time" id="ap-${d}" name="apertura-${d}" value="${h.apertura}" ${h.abierto ? '' : 'disabled'}>
          <span aria-hidden="true">a</span>
          <label class="sr-only" for="ci-${d}">${nombre}: cierra</label>
          <input type="time" id="ci-${d}" name="cierre-${d}" value="${h.cierre}" ${h.abierto ? '' : 'disabled'}>
        </div>`;
    }).join('');
  }

  function leerDias() {
    const dias = {};
    document.querySelectorAll('.fila-dia').forEach(fila => {
      const d = Number(fila.dataset.dia);
      dias[d] = {
        abierto: fila.querySelector(`[name="abierto-${d}"]`).checked,
        apertura: fila.querySelector(`[name="apertura-${d}"]`).value,
        cierre: fila.querySelector(`[name="cierre-${d}"]`).value
      };
    });
    return dias;
  }

  $('#form-negocio').addEventListener('input', (e) => {
    marcarSucio('negocio');
    const fila = e.target.closest('.fila-dia');
    if (!fila) return;
    // Al cambiar un día: activa/desactiva sus horas y reescribe el texto para clientes.
    const abierto = fila.querySelector('[type="checkbox"]').checked;
    fila.querySelectorAll('[type="time"]').forEach(i => { i.disabled = !abierto; });
    $('#form-negocio').texto.value = textoHorario(leerDias());
  });

  $('#form-negocio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const whatsapp = f.whatsapp.value.replace(/\D/g, '');
    const medios = f.mediosPago.value.split(',').map(m => m.trim()).filter(Boolean);
    const dias = leerDias();
    const abiertos = Object.entries(dias).filter(([, h]) => h.abierto);
    const malHorario = abiertos.find(([, h]) => !h.apertura || !h.cierre || h.apertura >= h.cierre);
    const nombreDe = (d) => DIAS.find(x => x[0] === Number(d))[1];
    const error = !f.checkValidity() ? 'Revisa los campos marcados.'
      : !abiertos.length ? 'Marca al menos un día abierto.'
      : malHorario ? `${nombreDe(malHorario[0])}: la hora de cierre debe ser después de la apertura.`
      : whatsapp.length < 11 ? 'El WhatsApp debe incluir el 56 (ej.: 56912345678).'
      : !medios.length ? 'Escribe al menos un medio de pago.' : '';
    $('#e-negocio').textContent = error;
    if (error) { f.reportValidity(); return; }

    // Además del horario por día se guardan los valores generales (apertura más temprana, cierre más tarde) por compatibilidad.
    const negocio = {
      ...estado.negocio,
      nombre: f.nombre.value.trim(), eslogan: f.eslogan.value.trim(), direccion: f.direccion.value.trim(),
      telefono: f.telefono.value.trim(), whatsapp, mediosPago: medios,
      capacidadSimultanea: Number(f.capacidadSimultanea.value),
      horario: {
        apertura: abiertos.map(([, h]) => h.apertura).sort()[0],
        cierre: abiertos.map(([, h]) => h.cierre).sort().at(-1),
        intervaloMin: Number(f.intervaloMin.value),
        diasCerrado: Object.entries(dias).filter(([, h]) => !h.abierto).map(([d]) => Number(d)),
        dias,
        texto: f.texto.value.trim() || textoHorario(dias)
      }
    };
    const botonGuardar = f.querySelector('[type="submit"]');
    botonGuardar.disabled = true;
    try {
      await Datos.guardarNegocio(negocio);
      estado.negocio = negocio;
      estado.sucio.negocio = false;
      $('#estado-negocio').textContent = 'Guardado';
      UI.prepararCabecera(usuario, negocio);
      UI.aviso('Datos del negocio guardados.');
      pintarAvisos();
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    botonGuardar.disabled = false;
  });

  window.addEventListener('beforeunload', (e) => {
    if (!window.saliendo && (estado.sucio.precios || estado.sucio.negocio)) e.preventDefault();
  });

  // ===== Navegación entre pestañas =====
  const TITULOS = { hoy: 'Panel del dueño', actividad: 'Actividad del equipo', equipo: 'Equipo', precios: 'Servicios y precios', negocio: 'Negocio y horario' };
  await pintarAvisos();
  UI.pestanas((id) => {
    estado.pestana = id;
    document.title = TITULOS[id];
    if (id === 'hoy') cargarHoy();
    else if (id === 'actividad') cargarActividad();
    else if (id === 'equipo') cargarEquipo();
    else if (id === 'precios' && !estado.sucio.precios) pintarPrecios(copia({ lista: estado.servicios, tipos: estado.negocio.tiposVehiculo }));
    else if (id === 'negocio' && !estado.sucio.negocio) pintarNegocio(estado.negocio);
  });

  // La pestaña Hoy se actualiza sola cada minuto (los trabajadores van registrando desde sus celulares).
  setInterval(() => { if (estado.pestana === 'hoy' && !document.querySelector('dialog[open]')) cargarHoy(); }, 60000);
})();
