/* Panel maestro del dueño: operación del día, actividad del equipo, equipo, precios y datos del negocio. */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const usuario = await Datos.exigirSesion(['dueno']);

  const hoy = Datos.fechaISO();
  const estado = {
    negocio: null, servicios: [], equipo: [], reservas: [], actividadesHoy: [], actividades: [],
    fecha: hoy, filtro: 'todos', periodo: 1, pestana: 'hoy',
    act: { desde: hoy, hasta: hoy, uid: '', tipo: '' },
    sucio: { precios: false, negocio: false }
  };

  try {
    [estado.negocio, estado.servicios, estado.equipo] = await Promise.all([Datos.negocio(), Datos.servicios(), Datos.equipo()]);
  } catch (err) {
    $('#avisos').innerHTML = `<div class="aviso">No se pudieron cargar los datos. ${esc(UI.mensajeError(err))}</div>`;
    return;
  }
  UI.prepararCabecera(usuario, estado.negocio);

  const servicioPorId = (id) => estado.servicios.find(s => s.id === id);
  const nombreVehiculo = (id) => estado.negocio.tiposVehiculo.find(v => v.id === id)?.nombre ?? id;
  const sumar = (lista, campo) => lista.reduce((t, x) => t + (Number(x[campo]) || 0), 0);
  const kpi = ([etiqueta, valor]) => `<div class="tarjeta kpi"><div class="etiqueta">${etiqueta}</div><div class="valor">${valor}</div></div>`;

  // ===== Avisos (modo demo / base de datos sin configuración) =====
  async function pintarAvisos() {
    if (Datos.modo === 'demo') {
      $('#avisos').innerHTML = `
        <div class="aviso" style="margin-bottom:20px">
          <svg class="icono" aria-hidden="true"><use href="#i-info"></use></svg>
          <span style="flex:1">Modo demostración: los datos quedan solo en este navegador. Para usarla con tu equipo hay que conectar Firebase (ver README).</span>
          <button type="button" class="btn btn-secundario btn-sm" data-aviso="reiniciar">Reiniciar demo</button>
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
        if (!confirm('¿Borrar todo lo registrado en esta demo y volver a los datos de ejemplo?')) { btn.disabled = false; return; }
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
    try {
      [estado.reservas, estado.actividadesHoy] = await Promise.all([
        Datos.reservasConContacto({ desde: Datos.sumarDias(estado.fecha, -6), hasta: estado.fecha }),
        Datos.actividades({ desde: Datos.fechaISO(), hasta: Datos.fechaISO() })
      ]);
    } catch (err) {
      UI.aviso(UI.mensajeError(err), 'error');
    }
    pintarHoy();
  }

  const delDia = () => estado.reservas.filter(r => r.fecha === estado.fecha);

  function moverDia(dias) { estado.fecha = Datos.sumarDias(estado.fecha, dias); cargarHoy(); }
  $('#dia-anterior').addEventListener('click', () => moverDia(-1));
  $('#dia-siguiente').addEventListener('click', () => moverDia(1));
  $('#ir-hoy').addEventListener('click', () => { estado.fecha = Datos.fechaISO(); cargarHoy(); });
  $('#fecha').addEventListener('change', (e) => { if (e.target.value) { estado.fecha = e.target.value; cargarHoy(); } });

  function pintarKpis(lista) {
    const activas = lista.filter(r => r.estado !== 'cancelada');
    const porAtender = activas.filter(r => r.estado === 'pendiente' || r.estado === 'en-proceso').length;
    $('#kpis').innerHTML = [
      ['Cobrado', Datos.dinero(sumar(activas, 'cobrado'))],
      ['Ingresos estimados', Datos.dinero(sumar(activas, 'precio'))],
      ['Reservas', activas.length],
      ['Por atender', porAtender]
    ].map(kpi).join('');
  }

  // Ranking: qué servicio se vende más (cantidad; ingresos como dato de apoyo).
  function pintarRanking() {
    const desde = Datos.sumarDias(estado.fecha, -(estado.periodo - 1));
    const lista = estado.reservas.filter(r => r.fecha >= desde && r.fecha <= estado.fecha && r.estado !== 'cancelada');
    const total = lista.length;
    const filas = estado.servicios.map(s => {
      const delServicio = lista.filter(r => r.servicioId === s.id);
      return { nombre: s.nombre, n: delServicio.length, ingresos: sumar(delServicio, 'precio') };
    }).sort((a, b) => b.n - a.n || b.ingresos - a.ingresos);
    const max = Math.max(1, ...filas.map(f => f.n));

    if (!total) {
      $('#ranking').innerHTML = '<li class="vacio" style="padding:16px 0">Sin ventas en este período.</li>';
      $('#ranking-nota').textContent = '';
      return;
    }
    $('#ranking').innerHTML = filas.map((f, i) => {
      const pct = Math.round((f.n / total) * 100);
      const lider = i === 0 && f.n > 0;
      return `
        <li class="ranking-fila" title="${esc(f.nombre)}: ${f.n} de ${total} lavados (${pct}%) · ${Datos.dinero(f.ingresos)}">
          <div class="ranking-texto">
            <span class="ranking-nombre">${esc(f.nombre)}${lider ? ' <span class="chip listo">Más vendido</span>' : ''}</span>
            <span class="ranking-valor"><strong>${f.n}</strong> · ${pct}%</span>
          </div>
          <div class="ranking-pista" aria-hidden="true"><div class="ranking-barra" style="width:${(f.n / max) * 100}%"></div></div>
          <span class="ranking-ingresos">${Datos.dinero(f.ingresos)} en ventas</span>
        </li>`;
    }).join('');
    $('#ranking-nota').textContent = `${total} lavados ${estado.periodo === 1 ? 'este día' : 'en los últimos 7 días'} (sin contar cancelados).`;
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

  function accionesTurno(r) {
    const id = esc(r.id);
    const cancelar = `<button type="button" class="btn btn-peligro btn-sm" data-accion="cancelar" data-id="${id}">Cancelar</button>`;
    if (r.estado === 'pendiente') return `<button type="button" class="btn btn-primario btn-sm" data-accion="iniciar" data-id="${id}">Iniciar lavado</button>${cancelar}`;
    if (r.estado === 'en-proceso') return `<button type="button" class="btn btn-primario btn-sm" data-accion="terminar" data-id="${id}">Marcar listo</button>${cancelar}`;
    if (r.estado === 'listo') {
      const msj = encodeURIComponent(`Hola${r.cliente ? ' ' + r.cliente : ''}, tu vehículo patente ${r.patente} ya está listo para retiro. ¡Gracias por preferir ${estado.negocio.nombre}!`);
      return `<button type="button" class="btn btn-primario btn-sm" data-accion="cobrar" data-id="${id}">Cobrar y entregar</button>
        ${r.telefono ? `<a class="btn btn-secundario btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(r.telefono)}?text=${msj}">
          <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Avisar al cliente</a>` : ''}`;
    }
    return '';
  }

  function pintarAgenda(lista) {
    const visibles = estado.filtro === 'todos' ? lista : lista.filter(r => r.estado === estado.filtro);
    if (!visibles.length) {
      $('#agenda').innerHTML = '<li class="tarjeta vacio">No hay reservas para mostrar.</li>';
      return;
    }
    $('#agenda').innerHTML = visibles.map(r => {
      const info = Datos.ESTADOS[r.estado] ?? { texto: r.estado };
      return `
        <li class="tarjeta turno ${esc(r.estado)}">
          <div class="turno-cabecera">
            <span class="turno-hora">${esc(r.hora)}</span>
            <span class="chip ${esc(r.estado)}">${esc(info.texto)}</span>
          </div>
          <div class="turno-detalle">
            <span><strong>${esc(servicioPorId(r.servicioId)?.nombre ?? r.servicioId)}</strong> · ${esc(nombreVehiculo(r.vehiculo))}</span>
            <span class="patente">${esc(r.patente)}</span>
            ${r.cliente ? `<span>${esc(r.cliente)}</span>` : ''}
            <span><strong>${Datos.dinero(r.precio)}</strong></span>
            ${r.origen === 'local' ? '<span>Sin reserva</span>' : ''}
          </div>
          ${r.trabajadorNombre || r.cobrado != null ? `<div class="turno-detalle">
            ${r.trabajadorNombre ? `<span>A cargo: <strong>${esc(r.trabajadorNombre)}</strong></span>` : ''}
            ${r.cobrado != null ? `<span>Cobrado: <strong>${Datos.dinero(r.cobrado)}</strong> · ${esc(r.medioPago ?? '')}</span>` : ''}
          </div>` : ''}
          <div class="turno-acciones">${accionesTurno(r)}</div>
        </li>`;
    }).join('');
  }

  function pintarEquipoHoy() {
    const trabajadores = estado.equipo.filter(m => m.activo && m.rol === 'trabajador');
    if (!trabajadores.length) {
      $('#equipo-hoy').innerHTML = '<li class="texto-2">Aún no hay trabajadores. <a href="#equipo">Dar acceso a alguien</a></li>';
      return;
    }
    $('#equipo-hoy').innerHTML = trabajadores.map(m => {
      const turno = Datos.turnoDeHoy(estado.actividadesHoy, m.uid);
      const lavados = estado.actividadesHoy.filter(a => a.uid === m.uid && a.tipo === 'lavado').length;
      return `
        <li>
          <span><strong>${esc(m.nombre)}</strong><br><span class="texto-2">${lavados} ${lavados === 1 ? 'lavado' : 'lavados'} hoy</span></span>
          <span class="chip ${turno.enTurno ? 'listo' : 'entregado'}">${turno.enTurno ? `En turno desde ${esc(turno.desde)}` : 'Fuera de turno'}</span>
        </li>`;
    }).join('');
  }

  function pintarHoy() {
    const lista = delDia();
    $('#fecha').value = estado.fecha;
    const texto = new Date(estado.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#titulo-dia').textContent = estado.fecha === Datos.fechaISO() ? `Hoy, ${texto}` : texto.charAt(0).toUpperCase() + texto.slice(1);
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

  async function elegirTrabajador() {
    const activos = estado.equipo.filter(m => m.activo);
    const preferido = activos.find(m => m.rol === 'trabajador') ?? activos[0];
    const d = await UI.dialogo({
      titulo: '¿Quién lo lava?',
      aceptar: 'Iniciar lavado',
      cuerpo: `<div class="campo"><label for="d-quien">Persona a cargo</label>
        <select id="d-quien" name="uid">${activos.map(m => `<option value="${esc(m.uid)}" ${m === preferido ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></div>`
    });
    return d && activos.find(m => m.uid === d.uid);
  }

  $('#agenda').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const r = estado.reservas.find(x => x.id === btn.dataset.id);
    if (!r) return;
    let accion, texto;
    if (btn.dataset.accion === 'iniciar') {
      const quien = await elegirTrabajador();
      if (!quien) return;
      accion = () => Datos.iniciarLavado(r, quien);
      texto = `${quien.nombre} está lavando ${r.patente}`;
    } else if (btn.dataset.accion === 'terminar') {
      accion = () => Datos.terminarLavado(r, usuario);
      texto = `Listo: ${r.patente}`;
    } else if (btn.dataset.accion === 'cobrar') {
      const pago = await UI.cobro(r, estado.negocio, estado.servicios);
      if (!pago) return;
      accion = () => Datos.cobrar(r, pago, usuario);
      texto = `Cobro registrado: ${Datos.dinero(pago.monto)}`;
    } else if (btn.dataset.accion === 'cancelar') {
      if (!confirm('¿Cancelar esta reserva?')) return;
      accion = () => Datos.cambiarEstado(r.id, 'cancelada');
      texto = 'Reserva cancelada.';
    }
    btn.disabled = true;
    try { await accion(); UI.aviso(texto); } catch (err) { UI.aviso(UI.mensajeError(err), 'error'); }
    await cargarHoy();
  });

  // ===== Pestaña: Actividad del equipo =====
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

    $('#kpis-actividad').innerHTML = [
      ['Lavados', dePersona.filter(a => a.tipo === 'lavado').length],
      ['Cobrado', Datos.dinero(sumar(cobros, 'monto'))],
      ['Horas trabajadas', Datos.formatoHoras(Datos.minutosTrabajados(dePersona))],
      ['Personas que trabajaron', new Set(dePersona.filter(a => a.tipo === 'entrada').map(a => a.uid)).size]
    ].map(kpi).join('');

    $('#lista-actividad').innerHTML = UI.listaPorDia(visibles, { servicios: estado.servicios, conNombre: !uid, conBorrar: true });

    // Por persona
    const personas = [...new Map(dePersona.map(a => [a.uid, a.nombre])).entries()];
    $('#tabla-por-persona').innerHTML = personas.length ? `
      <thead><tr><th>Persona</th><th class="num">Lavados</th><th class="num">Cobrado</th><th class="num">Horas</th></tr></thead>
      <tbody>${personas.map(([id, nombre]) => {
        const suyas = dePersona.filter(a => a.uid === id);
        return `<tr><td>${esc(nombre)}</td>
          <td class="num">${suyas.filter(a => a.tipo === 'lavado').length}</td>
          <td class="num">${Datos.dinero(sumar(suyas.filter(a => a.tipo === 'cobro'), 'monto'))}</td>
          <td class="num">${Datos.formatoHoras(Datos.minutosTrabajados(suyas))}</td></tr>`;
      }).join('')}</tbody>` : '<tbody><tr><td class="texto-2">Sin registros.</td></tr></tbody>';

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

  $('#filtros-actividad').addEventListener('change', (e) => {
    const f = e.currentTarget;
    const recargar = e.target === f.desde || e.target === f.hasta;
    estado.act = { desde: f.desde.value || hoy, hasta: f.hasta.value || hoy, uid: f.uid.value, tipo: f.tipo.value };
    if (estado.act.desde > estado.act.hasta) estado.act.hasta = estado.act.desde;
    if (recargar) cargarActividad(); else pintarActividad();
  });

  $('#lista-actividad').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-borrar]');
    if (!btn) return;
    if (!confirm('¿Borrar este registro? Úsalo solo para corregir errores. No cambia el estado del auto.')) return;
    btn.disabled = true;
    try { await Datos.borrarActividad(btn.dataset.borrar); UI.aviso('Registro borrado.'); } catch (err) { UI.aviso(UI.mensajeError(err), 'error'); }
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
    const datos = { nombre: f.nombre.value.trim(), email: f.email.value.trim(), clave: f.clave.value.trim(), rol: f.rol.value };
    const error = datos.nombre.length < 2 ? 'Escribe el nombre.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) ? 'Escribe un correo válido.'
      : datos.clave.length < 6 ? 'La clave debe tener al menos 6 caracteres.' : '';
    $('#e-miembro').textContent = error;
    if (error) return;

    const boton = f.querySelector('[type="submit"]');
    boton.disabled = true;
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
    boton.disabled = false;
  });

  // ===== Pestaña: Servicios y precios =====
  const nuevoIdInterno = (prefijo) => prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function pintarPrecios({ lista, tipos }) {
    $('#editor-servicios').innerHTML = lista.map((s, i) => `
      <article class="tarjeta editor-servicio" data-servicio="${esc(s.id)}">
        <div class="fila-2">
          <div class="campo"><label for="s${i}-nombre">Nombre del servicio</label><input id="s${i}-nombre" name="nombre" value="${esc(s.nombre)}" required></div>
          <div class="campo"><label for="s${i}-duracion">Duración (minutos)</label><input id="s${i}-duracion" name="duracionMin" type="number" min="5" step="5" inputmode="numeric" value="${esc(s.duracionMin ?? '')}" required></div>
        </div>
        <div class="campo"><label for="s${i}-desc">Descripción</label><input id="s${i}-desc" name="descripcion" value="${esc(s.descripcion ?? '')}"></div>
        <fieldset class="precios-grid">
          <legend>Precio por tipo de vehículo</legend>
          ${tipos.map((t, j) => `
            <div class="campo">
              <label for="s${i}-p${j}" data-etiqueta-tipo="${esc(t.id)}">${esc(t.nombre || 'Tipo nuevo')}</label>
              <input id="s${i}-p${j}" name="precio-${esc(t.id)}" type="number" min="1" step="1" inputmode="numeric" value="${esc(s.precios?.[t.id] ?? '')}" required>
            </div>`).join('')}
        </fieldset>
        <div class="editor-pie">
          <label class="check"><input type="checkbox" name="destacado" ${s.destacado ? 'checked' : ''}> Destacar como "Más pedido"</label>
          <button type="button" class="btn btn-peligro btn-sm" data-quitar-servicio>Quitar servicio</button>
        </div>
      </article>`).join('');

    $('#editor-vehiculos').innerHTML = tipos.map((t, j) => `
      <div class="fila-vehiculo" data-vehiculo-fila="${esc(t.id)}">
        <label class="sr-only" for="v${j}">Tipo de vehículo ${j + 1}</label>
        <input id="v${j}" value="${esc(t.nombre)}" required placeholder="Ej.: Moto">
        <button type="button" class="btn btn-peligro btn-sm" data-quitar-vehiculo>Quitar</button>
      </div>`).join('');
  }

  function leerPrecios() {
    const tipos = [...document.querySelectorAll('[data-vehiculo-fila]')]
      .map(f => ({ id: f.dataset.vehiculoFila, nombre: f.querySelector('input').value.trim() }));
    const lista = [...document.querySelectorAll('[data-servicio]')].map(a => {
      const campo = (n) => a.querySelector(`[name="${n}"]`);
      const precios = {};
      tipos.forEach(t => {
        const v = campo(`precio-${t.id}`)?.value;
        if (v) precios[t.id] = Number(v);
      });
      return {
        id: a.dataset.servicio, nombre: campo('nombre').value.trim(), descripcion: campo('descripcion').value.trim(),
        duracionMin: Number(campo('duracionMin').value) || '', destacado: campo('destacado').checked, precios
      };
    });
    return { lista, tipos };
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

  $('#form-precios').addEventListener('click', (e) => {
    const borrador = () => leerPrecios();
    if (e.target.closest('#agregar-servicio')) {
      const b = borrador();
      b.lista.push({ id: nuevoIdInterno('s'), nombre: '', descripcion: '', duracionMin: 30, precios: {} });
      pintarPrecios(b);
      marcarSucio('precios');
      document.querySelector('[data-servicio]:last-child input')?.focus();
    } else if (e.target.closest('#agregar-vehiculo')) {
      const b = borrador();
      b.tipos.push({ id: nuevoIdInterno('t'), nombre: '' });
      pintarPrecios(b);
      marcarSucio('precios');
      document.querySelector('[data-vehiculo-fila]:last-child input')?.focus();
    } else if (e.target.closest('[data-quitar-servicio]')) {
      const art = e.target.closest('[data-servicio]');
      const nombre = art.querySelector('[name="nombre"]').value || 'este servicio';
      if (!confirm(`¿Quitar "${nombre}"? Dejará de aparecer para reservar.`)) return;
      art.remove();
      pintarPrecios(borrador());
      marcarSucio('precios');
    } else if (e.target.closest('[data-quitar-vehiculo]')) {
      const fila = e.target.closest('[data-vehiculo-fila]');
      const nombre = fila.querySelector('input').value || 'este tipo';
      if (!confirm(`¿Quitar "${nombre}" y sus precios?`)) return;
      fila.remove();
      pintarPrecios(borrador());
      marcarSucio('precios');
    }
  });

  $('#form-precios').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const { lista, tipos } = leerPrecios();
    if (!lista.length || !tipos.length) { UI.aviso('Debe haber al menos un servicio y un tipo de vehículo.', 'error'); return; }
    if (!f.reportValidity()) return;
    const boton = f.querySelector('[type="submit"]');
    boton.disabled = true;
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
    boton.disabled = false;
  });

  // ===== Pestaña: Negocio y horario =====
  const DIAS = [[1, 'lunes'], [2, 'martes'], [3, 'miércoles'], [4, 'jueves'], [5, 'viernes'], [6, 'sábado'], [0, 'domingo']];

  function textoHorario(abiertos, apertura, cierre) {
    const lista = DIAS.filter(([d]) => abiertos.includes(d));
    if (!lista.length) return 'Cerrado';
    const posiciones = lista.map(([d]) => DIAS.findIndex(x => x[0] === d));
    const seguidos = posiciones.every((p, i) => i === 0 || p === posiciones[i - 1] + 1);
    const nombres = lista.map(x => x[1]);
    const dias = lista.length === 7 ? 'todos los días'
      : lista.length === 1 ? nombres[0]
      : seguidos ? `${nombres[0]} a ${nombres.at(-1)}`
      : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`;
    return `${dias.charAt(0).toUpperCase() + dias.slice(1)}, ${apertura} a ${cierre}`;
  }

  function pintarNegocio(n) {
    const f = $('#form-negocio');
    ['nombre', 'eslogan', 'direccion', 'telefono', 'whatsapp'].forEach(c => { f[c].value = n[c] ?? ''; });
    f.mediosPago.value = (n.mediosPago ?? []).join(', ');
    f.apertura.value = n.horario.apertura;
    f.cierre.value = n.horario.cierre;
    f.intervaloMin.value = String(n.horario.intervaloMin);
    f.capacidadSimultanea.value = n.capacidadSimultanea;
    f.texto.value = n.horario.texto;
    const cerrados = n.horario.diasCerrado ?? [];
    $('#n-dias').innerHTML = DIAS.map(([d, nombre]) => `
      <label class="opcion"><input type="checkbox" name="dia" value="${d}" ${cerrados.includes(d) ? '' : 'checked'}> ${nombre.slice(0, 3)}</label>`).join('');
  }

  const diasAbiertos = () => [...document.querySelectorAll('#n-dias input:checked')].map(i => Number(i.value));

  $('#form-negocio').addEventListener('input', () => marcarSucio('negocio'));
  $('#generar-texto').addEventListener('click', () => {
    const f = $('#form-negocio');
    f.texto.value = textoHorario(diasAbiertos(), f.apertura.value, f.cierre.value);
    marcarSucio('negocio');
  });

  $('#form-negocio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const whatsapp = f.whatsapp.value.replace(/\D/g, '');
    const medios = f.mediosPago.value.split(',').map(m => m.trim()).filter(Boolean);
    const error = !f.checkValidity() ? 'Revisa los campos marcados.'
      : f.apertura.value >= f.cierre.value ? 'La hora de cierre debe ser después de la apertura.'
      : whatsapp.length < 11 ? 'El WhatsApp debe incluir el 56 (ej.: 56912345678).'
      : !medios.length ? 'Escribe al menos un medio de pago.' : '';
    $('#e-negocio').textContent = error;
    if (error) { f.reportValidity(); return; }

    const abiertos = diasAbiertos();
    const negocio = {
      ...estado.negocio,
      nombre: f.nombre.value.trim(), eslogan: f.eslogan.value.trim(), direccion: f.direccion.value.trim(),
      telefono: f.telefono.value.trim(), whatsapp, mediosPago: medios,
      capacidadSimultanea: Number(f.capacidadSimultanea.value),
      horario: {
        apertura: f.apertura.value, cierre: f.cierre.value, intervaloMin: Number(f.intervaloMin.value),
        diasCerrado: DIAS.map(([d]) => d).filter(d => !abiertos.includes(d)),
        texto: f.texto.value.trim()
      }
    };
    const boton = f.querySelector('[type="submit"]');
    boton.disabled = true;
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
    boton.disabled = false;
  });

  window.addEventListener('beforeunload', (e) => {
    if (estado.sucio.precios || estado.sucio.negocio) e.preventDefault();
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
