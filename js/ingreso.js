/* Ingreso del equipo: correo y clave; cada persona va a su pantalla según su rol. */
(async () => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Datos.escapar;
  const mostrar = (html, tipo = '') => { $('#mensaje').innerHTML = html ? `<div class="aviso ${tipo}">${html}</div>` : ''; };

  Datos.negocio().then(n => { document.querySelectorAll('[data-negocio="nombre"]').forEach(el => { el.textContent = n.nombre; }); }).catch(() => {});

  // Si ya hay sesión, se va directo a su pantalla (salvo que venga rebotado por falta de permiso).
  const actual = await Datos.usuarioActual();
  const sinPermiso = new URLSearchParams(location.search).get('error') === 'acceso';
  if (actual && !actual.sinAcceso) {
    if (!sinPermiso) { location.replace(Datos.pantallaDe(actual)); return; }
    mostrar(`Esa pantalla no está disponible para tu cuenta. <a href="${Datos.pantallaDe(actual)}">Ir a mi pantalla</a>`);
  } else if (actual?.sinAcceso) {
    await Datos.salir();
    mostrar('Tu cuenta no tiene acceso a la app. Pídele al dueño que te habilite.');
  }

  async function entrar(email, clave) {
    const boton = $('#form-ingreso [type="submit"]');
    boton.disabled = true;
    try {
      const u = await Datos.ingresar(email, clave);
      location.replace(Datos.pantallaDe(u));
    } catch (err) {
      mostrar(esc(UI.mensajeError(err)));
      boton.disabled = false;
    }
  }

  $('#form-ingreso').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#f-email').value.trim();
    const clave = $('#f-clave').value;
    if (!email || !clave) { mostrar('Escribe tu correo y tu clave.'); return; }
    entrar(email, clave);
  });

  $('#olvide').addEventListener('click', async () => {
    const email = $('#f-email').value.trim();
    if (!email) { mostrar('Escribe tu correo arriba y vuelve a apretar "Olvidé mi clave".'); $('#f-email').focus(); return; }
    try {
      await Datos.recuperarClave(email);
      mostrar(`Te enviamos un correo a <strong>${esc(email)}</strong> para crear una clave nueva.`, 'exito');
    } catch (err) {
      mostrar(esc(UI.mensajeError(err)));
    }
  });

  // Modo demo: botones para entrar con las cuentas de prueba.
  if (Datos.modo === 'demo') {
    const cuentas = await fetch('data/equipo-demo.json').then(r => r.json()).catch(() => []);
    $('#botones-demo').innerHTML = cuentas.map(c => `
      <button type="button" class="btn btn-secundario btn-bloque" data-email="${esc(c.email)}" data-clave="${esc(c.clave)}">
        <svg class="icono" aria-hidden="true"><use href="#i-usuario"></use></svg>
        ${esc(c.nombre)} · ${esc(Datos.ROLES[c.rol])}
      </button>`).join('');
    $('#cuentas-demo').hidden = !cuentas.length;
    $('#botones-demo').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-email]');
      if (btn) entrar(btn.dataset.email, btn.dataset.clave);
    });
  }
})();
