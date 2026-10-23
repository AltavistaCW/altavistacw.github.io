/* Piezas de interfaz compartidas por el panel del dueño y la vista del trabajador. */
const UI = (() => {
  const esc = Datos.escapar;

  // Mensaje breve arriba de la pantalla; se anuncia a lectores de pantalla.
  // accion opcional { texto, alHacer }: un botón dentro del mensaje (ej. "Deshacer"); el mensaje dura más.
  let temporizador;
  function aviso(texto, tipo = 'exito', accion = null) {
    let caja = document.getElementById('toast');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'toast';
      caja.className = 'toast';
      caja.setAttribute('role', 'status');
      document.body.appendChild(caja);
    }
    caja.innerHTML = `<span>${esc(texto)}</span>${accion ? `<button type="button" class="toast-accion">${esc(accion.texto)}</button>` : ''}`;
    caja.dataset.tipo = tipo;
    caja.classList.add('visible');
    if (accion) {
      caja.querySelector('.toast-accion').addEventListener('click', () => {
        caja.classList.remove('visible');
        accion.alHacer();
      }, { once: true });
    }
    clearTimeout(temporizador);
    temporizador = setTimeout(() => caja.classList.remove('visible'), accion ? 10000 : 4000);
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
  // antesDeSalir(): devuelve false para no salir (ej. hay cambios sin guardar y la persona elige quedarse).
  function prepararCabecera(usuario, negocio, { antesDeSalir } = {}) {
    document.querySelectorAll('[data-usuario="nombre"]').forEach(el => { el.textContent = usuario.nombre; });
    if (negocio) document.querySelectorAll('[data-negocio="nombre"]').forEach(el => { el.textContent = negocio.nombre; });
    const boton = document.getElementById('salir');
    if (!boton || boton.dataset.listo) return;
    boton.dataset.listo = '1';
    boton.addEventListener('click', async () => {
      if (antesDeSalir && antesDeSalir() === false) return;
      if (!antesDeSalir && !confirm('¿Cerrar sesión?')) return;
      window.saliendo = true; // evita el aviso del navegador por cambios sin guardar
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
  // validar(form) opcional: devuelve un texto de error (no cierra y lo muestra) o false (no cierra, sin mensaje).
  function dialogo({ titulo, cuerpo, aceptar = 'Guardar', alAbrir, validar, peligro = false }) {
    return new Promise((resolver) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialogo';
      dlg.innerHTML = `
        <form method="dialog">
          <h2>${esc(titulo)}</h2>
          ${cuerpo}
          <p class="error dialogo-error" role="alert"></p>
          <div class="dialogo-acciones">
            <button type="button" class="btn btn-secundario" data-cancelar>Volver</button>
            <button type="submit" class="btn ${peligro ? 'btn-peligro-lleno' : 'btn-primario'}" value="ok" data-aceptar>${esc(aceptar)}</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      const form = dlg.querySelector('form');
      dlg.querySelector('[data-cancelar]').addEventListener('click', () => dlg.close(''));
      form.addEventListener('submit', (e) => {
        if (e.submitter?.value !== 'ok' || !validar) return;
        const error = validar(form);
        if (error === false || (typeof error === 'string' && error)) {
          e.preventDefault();
          form.querySelector('.dialogo-error').textContent = error || '';
        }
      });
      dlg.addEventListener('close', () => {
        const datos = dlg.returnValue === 'ok' ? Object.fromEntries(new FormData(form)) : null;
        dlg.remove();
        resolver(datos);
      });
      alAbrir?.(form);
      dlg.showModal();
    });
  }

  // Menú de opciones (botones grandes). Devuelve la clave elegida o null.
  function elegir(titulo, opciones, detalle = '') {
    return new Promise((resolver) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialogo';
      dlg.innerHTML = `
        <form method="dialog" class="menu-opciones">
          <h2>${esc(titulo)}</h2>
          ${detalle ? `<p class="texto-2">${detalle}</p>` : ''}
          ${opciones.map(o => `<button type="submit" value="${esc(o.clave)}" class="btn btn-bloque ${o.peligro ? 'btn-peligro' : 'btn-secundario'}">${esc(o.texto)}</button>`).join('')}
          <button type="submit" value="" class="btn btn-bloque btn-claro-gris">Volver</button>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => { const v = dlg.returnValue; dlg.remove(); resolver(v || null); });
      dlg.showModal();
    });
  }

  const MOTIVOS_AJUSTE = ['Descuento', 'Cliente frecuente', 'Servicio extra', 'Cortesía (sin costo)', 'Otro'];

  // Cobro: el precio de lista siempre a la vista; si se cobra distinto, se pide el motivo.
  function cobro(reserva, negocio, servicios) {
    const medios = negocio.mediosPago?.length ? negocio.mediosPago : ['Efectivo'];
    const servicio = Datos.nombreServicio(servicios, reserva.servicioId, reserva.servicioNombre);
    const lista = Number(reserva.precio) || 0;
    return dialogo({
      titulo: 'Cobrar y entregar',
      aceptar: 'Registrar cobro',
      cuerpo: `
        <p class="texto-2">Patente <span class="patente">${esc(reserva.patente)}</span> · ${esc(servicio)}</p>
        <div class="resumen"><div class="texto-2">Precio de lista</div><div class="total">${Datos.dinero(lista)}</div></div>
        <div class="campo">
          <label for="d-monto">Monto cobrado</label>
          <input id="d-monto" name="monto" type="number" inputmode="numeric" min="0" step="1" required value="${lista || ''}">
        </div>
        <div class="campo" id="d-motivo-campo" hidden>
          <label for="d-motivo">¿Por qué es distinto al precio de lista?</label>
          <select id="d-motivo" name="motivo">
            <option value="">Elige un motivo</option>
            ${MOTIVOS_AJUSTE.map(m => `<option>${esc(m)}</option>`).join('')}
          </select>
        </div>
        <fieldset class="campo opciones">
          <legend>Medio de pago</legend>
          ${medios.map((m, i) => `<label class="opcion"><input type="radio" name="medioPago" value="${esc(m)}" ${i === 0 ? 'checked' : ''} required> ${esc(m)}</label>`).join('')}
        </fieldset>`,
      alAbrir(form) {
        const revisar = () => { form.querySelector('#d-motivo-campo').hidden = Number(form.monto.value) === lista; };
        form.monto.addEventListener('input', revisar);
        revisar();
      },
      validar(form) {
        const monto = Number(form.monto.value);
        if (form.monto.value === '' || monto < 0) return 'Escribe el monto cobrado.';
        if (monto !== lista && !form.motivo.value) return `Cobras ${Datos.dinero(monto)} y el precio es ${Datos.dinero(lista)}. Elige el motivo.`;
        if (monto === 0 && form.motivo.value !== 'Cortesía (sin costo)') return 'Un cobro de $0 solo se registra como "Cortesía (sin costo)".';
        if (lista && monto < lista / 2 && !confirm(`¿Seguro? Vas a registrar ${Datos.dinero(monto)}, menos de la mitad del precio (${Datos.dinero(lista)}).`)) return false;
        return '';
      }
    }).then(d => d && { monto: Number(d.monto), medioPago: d.medioPago, motivo: Number(d.monto) === lista ? '' : d.motivo });
  }

  // revisar(servicio) opcional: devuelve { html, alcanza } con el aviso de si el lavado alcanza a hacerse ahora.
  function autoSinReserva(negocio, servicios, revisar) {
    const visibles = servicios.filter(s => !s.oculto);
    const opcionesServicio = visibles.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('');
    const opcionesVehiculo = negocio.tiposVehiculo.filter(v => !v.oculto).map(v => `<option value="${esc(v.id)}">${esc(v.nombre)}</option>`).join('');
    let alcanza = true;
    return dialogo({
      titulo: 'Auto sin reserva',
      aceptar: 'Iniciar lavado',
      cuerpo: `
        <div class="campo">
          <label for="d-patente">Patente</label>
          <input id="d-patente" name="patente" required maxlength="8" autocapitalize="characters" minlength="5" placeholder="KJTR34">
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
          const s = visibles.find(x => x.id === form.servicioId.value);
          form.querySelector('#d-precio').textContent = Datos.dinero(s?.precios[form.vehiculo.value]);
          if (revisar && s) {
            const r = revisar(s);
            alcanza = r.alcanza;
            form.querySelector('#d-alcance').innerHTML = r.html;
            form.querySelector('[data-aceptar]').textContent = alcanza ? 'Iniciar lavado' : 'Iniciar igual';
          }
        };
        form.servicioId.value = visibles.find(s => s.destacado)?.id ?? visibles[0]?.id;
        form.servicioId.addEventListener('change', pintarPrecio);
        form.vehiculo.addEventListener('change', pintarPrecio);
        pintarPrecio();
      },
      validar(form) {
        if (Datos.normalizarPatente(form.patente.value).length < 5) return 'Escribe la patente (ej.: KJTR34).';
        if (!alcanza && !confirm('El local estará lleno durante ese lavado. ¿Iniciar igual?')) return false;
        return '';
      }
    }).then(d => {
      if (!d) return null;
      const servicio = visibles.find(s => s.id === d.servicioId);
      return {
        patente: Datos.normalizarPatente(d.patente), servicioId: d.servicioId, servicioNombre: servicio.nombre, vehiculo: d.vehiculo,
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

  // ---- Mensajes por WhatsApp al cliente ----
  function mensajeConfirmacion(r, negocio, servicios) {
    const servicio = Datos.nombreServicio(servicios, r.servicioId, r.servicioNombre);
    const vehiculo = negocio.tiposVehiculo.find(v => v.id === r.vehiculo)?.nombre ?? '';
    const nombre = (r.cliente || '').split(' ')[0];
    return [
      `Hola${nombre ? ' ' + nombre : ''}, tu hora en ${negocio.nombre} quedó confirmada ✅`,
      `📅 ${textoFechaLarga(r.fecha)}, ${r.hora} h`,
      `🚗 ${[servicio, vehiculo].filter(Boolean).join(' · ')} · ${Datos.dinero(r.precio)}`,
      `📍 ${negocio.direccion}`,
      'Si no puedes venir, avísanos por aquí. ¡Te esperamos!'
    ].join('\n');
  }

  function enlaceCancelacion(r, negocio) {
    if (!r.telefono) return '';
    const nombre = (r.cliente || '').split(' ')[0];
    const texto = `Hola${nombre ? ' ' + nombre : ''}, te escribimos de ${negocio.nombre}: tu hora del ${textoFechaLarga(r.fecha)} a las ${r.hora} quedó cancelada. Si quieres, puedes reservar otra en ${new URL('./', location.href).href}`;
    return `https://wa.me/${r.telefono}?text=${encodeURIComponent(texto)}`;
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

  // ---- Fechas ----
  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const textoFechaLarga = (fecha) => mayuscula(new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }));
  function textoDia(fecha) {
    const hoy = Datos.fechaISO();
    if (fecha === hoy) return 'Hoy';
    if (fecha === Datos.sumarDias(hoy, -1)) return 'Ayer';
    if (fecha === Datos.sumarDias(hoy, 1)) return 'Mañana';
    return textoFechaLarga(fecha);
  }

  // ---- Lista de actividades agrupada por día ----
  function filaActividad(a, { servicios = [], conNombre = false, conCorregir = false } = {}) {
    const tipo = Datos.TIPOS_ACTIVIDAD[a.tipo]?.texto ?? a.tipo;
    const servicio = a.servicioId ? Datos.nombreServicio(servicios, a.servicioId, a.servicioNombre) : '';
    const detalle = [
      a.patente && `<span class="patente">${esc(a.patente)}</span>`,
      servicio && esc(servicio),
      a.minutos && `${a.minutos} min`,
      a.monto != null && `<strong>${Datos.dinero(a.monto)}</strong>`,
      a.medioPago && esc(a.medioPago),
      a.motivo && `${esc(a.motivo)}${a.precioLista ? ` (lista ${Datos.dinero(a.precioLista)})` : ''}`,
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
        ${conCorregir ? `<button type="button" class="btn btn-secundario btn-sm" data-corregir="${esc(a.id)}">Corregir</button>` : ''}
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

  return {
    aviso, mensajeError, prepararCabecera, pestanas, dialogo, elegir, cobro, autoSinReserva, otraActividad, telefonoWhatsApp,
    listaPorDia, textoDia, textoFechaLarga, mensajeConfirmacion, enlaceCancelacion, botonConfirmar
  };
})();
