/* Página "Mi auto": estado del auto por patente y lista de precios. La reserva se hace en index.html (paso a paso). */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  let negocio, servicios;

  try {
    [negocio, servicios] = await Promise.all([Datos.negocio(), Datos.servicios()]);
  } catch (err) {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      `<div class="contenedor" style="padding-top:16px"><div class="aviso">No se pudieron cargar los datos. ${esc(err.message)}</div></div>`);
    return;
  }

  const textos = { nombre: negocio.nombre, direccion: negocio.direccion, horario: negocio.horario.texto, telefono: negocio.telefono };
  document.querySelectorAll('[data-negocio]').forEach(el => { el.textContent = textos[el.dataset.negocio] ?? ''; });
  document.title = `Mi auto · ${negocio.nombre}`;
  const enlaceTelefono = `tel:${negocio.telefono.replace(/\s/g, '')}`;
  $('#pie-telefono').href = enlaceTelefono;
  const visibles = servicios.filter(s => !s.oculto);
  const vehiculos = negocio.tiposVehiculo.filter(v => !v.oculto);
  let vehiculo = vehiculos[0]?.id;

  // ---- Catálogo ----
  function pintarFiltro() {
    $('#filtro-vehiculo').innerHTML = vehiculos.map(v =>
      `<button type="button" data-vehiculo="${esc(v.id)}" aria-pressed="${v.id === vehiculo}">${esc(v.nombre)}</button>`).join('');
  }

  function pintarServicios() {
    $('#lista-servicios').innerHTML = visibles.filter(s => s.precios[vehiculo]).map(s => `
      <article class="tarjeta servicio ${s.destacado ? 'destacado' : ''}">
        ${s.destacado ? '<span class="etiqueta-destacado">Más pedido</span>' : ''}
        <h3>${esc(s.nombre)}</h3>
        <p class="texto-2" style="margin:0">${esc(s.descripcion)}</p>
        <span class="duracion"><svg class="icono" aria-hidden="true"><use href="#i-reloj"></use></svg>${esc(s.duracionMin)} min aprox.</span>
        <span class="precio">${Datos.dinero(s.precios[vehiculo])}</span>
      </article>`).join('');
  }

  $('#filtro-vehiculo').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vehiculo]');
    if (!btn) return;
    vehiculo = btn.dataset.vehiculo;
    pintarFiltro();
    pintarServicios();
  });

  // ---- Estado del auto, explicado en una frase ----
  function frase(r) {
    const cierre = Datos.horarioDelDia(negocio, r.fecha).cierre;
    if (r.estado === 'listo') return { titulo: 'Tu auto está listo', texto: `Puedes pasar a retirarlo. Estamos abiertos hasta las ${cierre}.`, clase: 'listo' };
    if (r.estado === 'en-proceso') return { titulo: 'Estamos lavando tu auto', texto: 'Te avisaremos por WhatsApp cuando esté listo.', clase: 'en-proceso' };
    if (r.estado === 'entregado') return { titulo: 'Auto entregado', texto: '¡Gracias por preferirnos!', clase: 'entregado' };
    if (r.estado === 'cancelada') return { titulo: 'Reserva cancelada', texto: 'Si quieres, puedes reservar otra hora.', clase: 'cancelada' };
    return {
      titulo: 'Tu hora está reservada',
      texto: r.confirmada ? 'Ya te la confirmamos por WhatsApp. ¡Te esperamos!' : 'Te enviaremos la confirmación por WhatsApp. No tienes que hacer nada más.',
      clase: 'pendiente'
    };
  }

  async function consultar(patente) {
    const hoy = Datos.fechaISO();
    let suyas;
    try {
      suyas = (await Datos.reservasPorPatente(patente)).filter(r => r.fecha >= hoy && !r.anulada);
    } catch {
      $('#resultado-estado').innerHTML = '<p class="texto-2" style="margin:0">No pudimos consultar en este momento. Intenta de nuevo.</p>';
      return;
    }
    if (!suyas.length) {
      $('#resultado-estado').innerHTML = `
        <p class="texto-2" style="margin:0 0 12px">No encontramos reservas desde hoy para la patente <span class="patente">${esc(patente)}</span>.</p>
        <a class="btn btn-secundario" href="${esc(enlaceTelefono)}"><svg class="icono" aria-hidden="true"><use href="#i-telefono"></use></svg> Llamar al local</a>`;
      return;
    }
    $('#resultado-estado').innerHTML = suyas.map(r => {
      const f = frase(r);
      return `
        <div class="estado-auto ${esc(f.clase)}">
          <strong class="estado-auto-titulo">${esc(f.titulo)}</strong>
          <span>${esc(f.texto)}</span>
          <span class="texto-2">${esc(UI.textoDia(r.fecha))}, ${esc(r.hora)} h · ${esc(Datos.nombreServicio(servicios, r.servicioId, r.servicioNombre))}</span>
        </div>`;
    }).join('') + `
      <a class="btn btn-secundario" href="${esc(enlaceTelefono)}" style="margin-top:12px">
        <svg class="icono" aria-hidden="true"><use href="#i-telefono"></use></svg> Llamar al local</a>`;
  }

  $('#form-estado').addEventListener('submit', (e) => {
    e.preventDefault();
    consultar(Datos.normalizarPatente($('#f-buscar-patente').value));
  });

  // Desde la confirmación de reserva se llega con ?patente=XXXX: se consulta sola.
  const patente = Datos.normalizarPatente(new URLSearchParams(location.search).get('patente'));
  if (patente) {
    $('#f-buscar-patente').value = patente;
    consultar(patente);
  }

  pintarFiltro();
  pintarServicios();
})();
