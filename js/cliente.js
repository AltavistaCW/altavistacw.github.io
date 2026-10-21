/* Página de precios y estado del auto. La reserva se hace en index.html (paso a paso). */
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

  const textos = { nombre: negocio.nombre, direccion: negocio.direccion, horario: negocio.horario.texto };
  document.querySelectorAll('[data-negocio]').forEach(el => { el.textContent = textos[el.dataset.negocio] ?? ''; });
  document.title = `Precios y estado de tu auto · ${negocio.nombre}`;
  const servicioPorId = (id) => servicios.find(s => s.id === id);
  let vehiculo = negocio.tiposVehiculo[0].id;

  // ---- Catálogo ----
  function pintarFiltro() {
    $('#filtro-vehiculo').innerHTML = negocio.tiposVehiculo.map(v =>
      `<button type="button" data-vehiculo="${esc(v.id)}" aria-pressed="${v.id === vehiculo}">${esc(v.nombre)}</button>`).join('');
  }

  function pintarServicios() {
    $('#lista-servicios').innerHTML = servicios.filter(s => s.precios[vehiculo]).map(s => `
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

  // ---- Consulta de estado por patente ----
  async function consultar(patente) {
    const hoy = Datos.fechaISO();
    let suyas;
    try {
      suyas = (await Datos.reservasPorPatente(patente)).filter(r => r.fecha >= hoy);
    } catch {
      $('#resultado-estado').innerHTML = '<p class="texto-2" style="margin:0">No pudimos consultar en este momento. Intenta de nuevo.</p>';
      return;
    }
    $('#resultado-estado').innerHTML = suyas.length
      ? suyas.map(r => `
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 0;border-top:1px solid var(--borde)">
            <span>${esc(servicioPorId(r.servicioId)?.nombre ?? r.servicioId)}<br>
              <span class="texto-2">${r.fecha === hoy ? 'Hoy' : esc(r.fecha)} · ${esc(r.hora)} h</span></span>
            <span class="chip ${esc(r.estado)}">${esc(Datos.ESTADOS[r.estado]?.texto ?? r.estado)}</span>
          </div>`).join('')
      : '<p class="texto-2" style="margin:0">No encontramos reservas activas para esa patente.</p>';
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
