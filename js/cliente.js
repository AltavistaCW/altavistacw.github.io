/* Página "Mi auto": estado del auto por patente y cómo contactar al local. La reserva se hace en index.html (paso a paso). */
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
  document.title = `Mi auto · ${negocio.nombre}`;

  // ---- Contacto ----
  $('#c-llamar').href = `tel:${negocio.telefono.replace(/\s/g, '')}`;
  $('#c-whatsapp').href = `https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola ${negocio.nombre}, quería consultar por mi auto.`)}`;
  $('#c-mapa').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(negocio.direccion)}`;

  // "Hoy abierto hasta las 19:00" o "Ahora cerrado · abre mañana a las 09:00"
  function pintarHorarioHoy() {
    const abierto = Datos.estaAbierto(negocio);
    const el = $('#horario-hoy');
    el.classList.toggle('abierto', Boolean(abierto));
    if (abierto) { el.textContent = `Hoy abierto hasta las ${abierto.cierre}`; return; }
    const p = Datos.proximaApertura(negocio);
    const dia = p && new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long' });
    el.textContent = !p ? 'Ahora cerrado' : `Ahora cerrado · abre ${p.enDias === 0 ? 'hoy' : p.enDias === 1 ? 'mañana' : `el ${dia}`} a las ${p.hora}`;
  }
  pintarHorarioHoy();
  setInterval(pintarHorarioHoy, 60000);

  // ---- Estado del auto, explicado en una frase ----
  function frase(r) {
    const cierre = Datos.horarioDelDia(negocio, r.fecha).cierre;
    if (r.estado === 'listo') return { titulo: 'Tu auto está listo', texto: `Puedes pasar a retirarlo. Estamos abiertos hasta las ${cierre}.`, clase: 'listo' };
    if (r.estado === 'en-proceso') return { titulo: 'Estamos lavando tu auto', texto: 'Te avisaremos por WhatsApp cuando esté listo.', clase: 'en-proceso' };
    if (r.estado === 'entregado') return { titulo: 'Auto entregado', texto: '¡Gracias por preferirnos!', clase: 'entregado' };
    if (r.estado === 'cancelada') return { titulo: 'Reserva cancelada', texto: 'Si quieres, puedes reservar otra hora desde el inicio.', clase: 'cancelada' };
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
    $('#resultado-estado').innerHTML = suyas.length
      ? suyas.map(r => {
          const f = frase(r);
          return `
            <div class="estado-auto ${esc(f.clase)}">
              <strong class="estado-auto-titulo">${esc(f.titulo)}</strong>
              <span>${esc(f.texto)}</span>
              <span class="texto-2">${esc(UI.textoDia(r.fecha))}, ${esc(r.hora)} h · ${esc(Datos.nombreServicio(servicios, r.servicioId, r.servicioNombre))}</span>
            </div>`;
        }).join('')
      : `<p class="texto-2" style="margin:0">No encontramos reservas desde hoy para la patente <span class="patente">${esc(patente)}</span>. Revisa que esté bien escrita.</p>`;
  }

  $('#form-estado').addEventListener('submit', (e) => {
    e.preventDefault();
    consultar(Datos.normalizarPatente($('#f-buscar-patente').value));
  });

  // Patente a consultar: la del enlace (?patente=XXXX, desde la confirmación) o la última reservada desde este celular.
  function patenteRecordada() {
    try {
      const mias = (JSON.parse(localStorage.getItem('lavado.mis-reservas')) ?? []).filter(r => r.fecha >= Datos.fechaISO());
      return mias.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))[0]?.patente ?? '';
    } catch { return ''; }
  }
  const patente = Datos.normalizarPatente(new URLSearchParams(location.search).get('patente')) || patenteRecordada();
  if (patente) {
    $('#f-buscar-patente').value = patente;
    consultar(patente);
  }
})();
