/* Piezas de interfaz compartidas por el panel del dueño y la vista del trabajador. */
const UI = (() => {
  const esc = Datos.escapar;

  // Mensaje breve en la parte inferior; se anuncia a lectores de pantalla.
  let temporizador;
  function aviso(texto, tipo = 'exito') {
    let caja = document.getElementById('toast');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'toast';
      caja.className = 'toast';
      caja.setAttribute('role', 'status');
      document.body.appendChild(caja);
    }
    caja.textContent = texto;
    caja.dataset.tipo = tipo;
    caja.classList.add('visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => caja.classList.remove('visible'), 4000);
  }

  const ERRORES = {
    'auth/invalid-credential': 'Correo o clave incorrectos.',
    'auth/wrong-password': 'Correo o clave incorrectos.',
    'auth/user-not-found': 'Correo o clave incorrectos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/missing-email': 'Escribe tu correo.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
    'auth/weak-password': 'La clave debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    'auth/network-request-failed': 'Sin conexión a internet.',
    'permission-denied': 'No tienes permiso para hacer esto.',
    'unavailable': 'Sin conexión con la base de datos. Revisa tu internet.'
  };
  const mensajeError = (err) => ERRORES[err?.code] ?? err?.message ?? 'Ocurrió un error inesperado.';

  // Nombre de la persona y botón Salir en la cabecera.
  function prepararCabecera(usuario, negocio) {
    document.querySelectorAll('[data-usuario="nombre"]').forEach(el => { el.textContent = usuario.nombre; });
    if (negocio) document.querySelectorAll('[data-negocio="nombre"]').forEach(el => { el.textContent = negocio.nombre; });
    document.getElementById('salir')?.addEventListener('click', async () => {
      await Datos.salir();
      location.replace('ingreso.html');
    });
  }

  // Pestañas con enlaces #id: muestra el panel [data-panel] que corresponde y avisa el cambio.
  function pestanas(alCambiar) {
    const enlaces = [...document.querySelectorAll('[data-pestana]')];
    const paneles = [...document.querySelectorAll('[data-panel]')];
    function mostrar() {
      let id = location.hash.slice(1);
      if (!enlaces.some(a => a.dataset.pestana === id)) id = enlaces[0].dataset.pestana;
      enlaces.forEach(a => {
        if (a.dataset.pestana === id) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      paneles.forEach(p => { p.hidden = p.dataset.panel !== id; });
      window.scrollTo(0, 0);
      alCambiar?.(id);
    }
    window.addEventListener('hashchange', mostrar);
    mostrar();
  }

  // Ventana con formulario. Devuelve los datos ingresados, o null si se cancela.
  function dialogo({ titulo, cuerpo, aceptar = 'Guardar', alAbrir }) {
    return new Promise((resolver) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialogo';
      dlg.innerHTML = `
        <form method="dialog">
          <h2>${esc(titulo)}</h2>
          ${cuerpo}
          <div class="dialogo-acciones">
            <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
            <button type="submit" class="btn btn-primario" value="ok">${esc(aceptar)}</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      const form = dlg.querySelector('form');
      dlg.querySelector('[data-cancelar]').addEventListener('click', () => dlg.close(''));
      dlg.addEventListener('close', () => {
        const datos = dlg.returnValue === 'ok' ? Object.fromEntries(new FormData(form)) : null;
        dlg.remove();
        resolver(datos);
      });
      alAbrir?.(form);
      dlg.showModal();
    });
  }

  function cobro(reserva, negocio, servicios) {
    const medios = negocio.mediosPago?.length ? negocio.mediosPago : ['Efectivo'];
    const servicio = servicios.find(s => s.id === reserva.servicioId)?.nombre ?? '';
    return dialogo({
      titulo: 'Cobrar y entregar',
      aceptar: 'Registrar cobro',
      cuerpo: `
        <p class="texto-2">Patente <span class="patente">${esc(reserva.patente)}</span> · ${esc(servicio)}</p>
        <div class="campo">
          <label for="d-monto">Monto cobrado</label>
          <input id="d-monto" name="monto" type="number" inputmode="numeric" min="0" step="1" required value="${Number(reserva.precio) || ''}">
        </div>
        <fieldset class="campo opciones">
          <legend>Medio de pago</legend>
          ${medios.map((m, i) => `<label class="opcion"><input type="radio" name="medioPago" value="${esc(m)}" ${i === 0 ? 'checked' : ''} required> ${esc(m)}</label>`).join('')}
        </fieldset>`
    }).then(d => d && { monto: Number(d.monto), medioPago: d.medioPago });
  }

  // revisar(servicio) opcional: devuelve un aviso HTML de si el lavado alcanza a hacerse ahora.
  function autoSinReserva(negocio, servicios, revisar) {
    const opcionesServicio = servicios.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('');
    const opcionesVehiculo = negocio.tiposVehiculo.map(v => `<option value="${esc(v.id)}">${esc(v.nombre)}</option>`).join('');
    return dialogo({
      titulo: 'Auto sin reserva',
      aceptar: 'Iniciar lavado',
      cuerpo: `
        <div class="campo">
          <label for="d-patente">Patente</label>
          <input id="d-patente" name="patente" required maxlength="8" autocapitalize="characters" minlength="5" placeholder="ABCD12">
        </div>
        <div class="fila-2">
          <div class="campo"><label for="d-servicio">Servicio</label><select id="d-servicio" name="servicioId">${opcionesServicio}</select></div>
          <div class="campo"><label for="d-vehiculo">Vehículo</label><select id="d-vehiculo" name="vehiculo">${opcionesVehiculo}</select></div>
        </div>
        <div class="resumen"><div class="texto-2">Precio de lista</div><div class="total" id="d-precio"></div></div>
        <div id="d-alcance" aria-live="polite"></div>
        <div class="fila-2">
          <div class="campo"><label for="d-cliente">Nombre del cliente <span class="texto-2">(opcional)</span></label><input id="d-cliente" name="cliente" autocomplete="off"></div>
          <div class="campo"><label for="d-telefono">WhatsApp <span class="texto-2">(opcional)</span></label><input id="d-telefono" name="telefono" type="tel" inputmode="tel" placeholder="9 1234 5678"></div>
        </div>`,
      alAbrir(form) {
        const pintarPrecio = () => {
          const s = servicios.find(x => x.id === form.servicioId.value);
          form.querySelector('#d-precio').textContent = Datos.dinero(s?.precios[form.vehiculo.value]);
          if (revisar && s) form.querySelector('#d-alcance').innerHTML = revisar(s);
        };
        form.servicioId.value = servicios.find(s => s.destacado)?.id ?? servicios[0]?.id;
        form.servicioId.addEventListener('change', pintarPrecio);
        form.vehiculo.addEventListener('change', pintarPrecio);
        pintarPrecio();
      }
    }).then(d => {
      if (!d) return null;
      const servicio = servicios.find(s => s.id === d.servicioId);
      return {
        patente: Datos.normalizarPatente(d.patente), servicioId: d.servicioId, vehiculo: d.vehiculo,
        precio: servicio.precios[d.vehiculo], duracionMin: servicio.duracionMin,
        cliente: d.cliente.trim(), telefono: telefonoWhatsApp(d.telefono)
      };
    });
  }

  function otraActividad() {
    return dialogo({
      titulo: 'Otra actividad',
      aceptar: 'Registrar',
      cuerpo: `
        <div class="campo">
          <label for="d-nota">¿Qué hiciste?</label>
          <textarea id="d-nota" name="nota" rows="3" required maxlength="300" placeholder="Ej.: limpieza del local, compra de insumos, aspirado extra"></textarea>
        </div>
        <div class="campo">
          <label for="d-monto-otra">Monto <span class="texto-2">(opcional)</span></label>
          <input id="d-monto-otra" name="monto" type="number" inputmode="numeric" min="0" step="1">
          <span class="ayuda">Por ejemplo, si cobraste o gastaste algo.</span>
        </div>`
    }).then(d => d && { nota: d.nota.trim(), monto: d.monto === '' ? undefined : Number(d.monto) });
  }

  // Teléfono chileno a formato WhatsApp (569XXXXXXXX). Vacío si no hay número.
  function telefonoWhatsApp(txt) {
    const digitos = String(txt ?? '').replace(/\D/g, '');
    if (!digitos) return '';
    if (digitos.length === 9) return '56' + digitos;
    if (digitos.length === 8) return '569' + digitos;
    return digitos;
  }

  // ---- Confirmación de reservas por WhatsApp ----
  function mensajeConfirmacion(r, negocio, servicios) {
    const servicio = servicios.find(s => s.id === r.servicioId)?.nombre ?? '';
    const vehiculo = negocio.tiposVehiculo.find(v => v.id === r.vehiculo)?.nombre ?? '';
    const nombre = (r.cliente || '').split(' ')[0];
    return [
      `Hola${nombre ? ' ' + nombre : ''}, tu hora en ${negocio.nombre} quedó reservada ✅`,
      `📅 ${textoDia(r.fecha)}, ${r.hora} h`,
      `🚗 ${[servicio, vehiculo].filter(Boolean).join(' · ')} · ${Datos.dinero(r.precio)}`,
      `📍 ${negocio.direccion}`,
      'Si no puedes venir, avísanos por aquí. ¡Te esperamos!'
    ].join('\n');
  }

  // Abre WhatsApp con el mensaje listo; el clic también marca la reserva como confirmada (data-confirmar).
  function botonConfirmar(r, negocio, servicios) {
    const id = esc(r.id);
    if (!r.telefono) {
      return `<button type="button" class="btn btn-secundario btn-sm" data-confirmar="${id}">
        <svg class="icono" aria-hidden="true"><use href="#i-check"></use></svg> Marcar confirmada</button>`;
    }
    const texto = encodeURIComponent(mensajeConfirmacion(r, negocio, servicios));
    return `<a class="btn btn-whatsapp btn-sm" data-confirmar="${id}" target="_blank" rel="noopener" href="https://wa.me/${esc(r.telefono)}?text=${texto}">
      <svg class="icono" aria-hidden="true"><use href="#i-mensaje"></use></svg> Confirmar por WhatsApp</a>`;
  }

  // ---- Lista de actividades agrupada por día ----
  function textoDia(fecha) {
    const hoy = Datos.fechaISO();
    if (fecha === hoy) return 'Hoy';
    if (fecha === Datos.sumarDias(hoy, -1)) return 'Ayer';
    const t = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function filaActividad(a, { servicios = [], conNombre = false, conBorrar = false } = {}) {
    const tipo = Datos.TIPOS_ACTIVIDAD[a.tipo]?.texto ?? a.tipo;
    const servicio = servicios.find(s => s.id === a.servicioId)?.nombre;
    const detalle = [
      a.patente && `<span class="patente">${esc(a.patente)}</span>`,
      servicio && esc(servicio),
      a.minutos && `${a.minutos} min`,
      a.monto != null && `<strong>${Datos.dinero(a.monto)}</strong>`,
      a.medioPago && esc(a.medioPago),
      a.nota && esc(a.nota),
      a.registradoPor && `registrado por ${esc(a.registradoPor)}`
    ].filter(Boolean).join(' · ');
    return `
      <li class="fila-actividad">
        <span class="fila-hora">${esc(a.hora)}</span>
        <div class="fila-cuerpo">
          <div><span class="chip tipo-${esc(a.tipo)}">${esc(tipo)}</span>${conNombre ? ` <strong>${esc(a.nombre)}</strong>` : ''}</div>
          ${detalle ? `<div class="fila-detalle">${detalle}</div>` : ''}
        </div>
        ${conBorrar ? `<button type="button" class="btn btn-peligro btn-sm" data-borrar="${esc(a.id)}">Borrar</button>` : ''}
      </li>`;
  }

  function listaPorDia(lista, opciones) {
    if (!lista.length) return '<li class="tarjeta vacio">No hay registros en este período.</li>';
    let dia = null;
    return lista.map(a => {
      const cabecera = a.fecha !== dia ? `<li class="dia-cabecera">${esc(textoDia(a.fecha))}</li>` : '';
      dia = a.fecha;
      return cabecera + filaActividad(a, opciones);
    }).join('');
  }

  return { aviso, mensajeError, prepararCabecera, pestanas, dialogo, cobro, autoSinReserva, otraActividad, telefonoWhatsApp, listaPorDia, textoDia, mensajeConfirmacion, botonConfirmar };
})();
