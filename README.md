# Alta Vista Carwash — app de reservas y gestión del equipo

App web para una pyme de lavado de autos.

| Pantalla | Archivo | Para quién | Qué hace |
|---|---|---|---|
| Inicio y reserva | `index.html` | Clientes | Reserva paso a paso: **día (calendario) → vehículo → lavado → hora → datos**; accesos a mi auto, precios, WhatsApp y cómo llegar |
| Precios y estado | `cliente.html` | Clientes | Servicios y precios por vehículo; estado del auto por patente |
| Ingreso | `ingreso.html` | Equipo | Correo y clave; cada uno va a su pantalla según su rol |
| Trabajador | `trabajador.html` | Trabajadores | **Mi jornada** (entrada/salida, tomar autos, terminar lavado, cobrar, auto sin reserva, otra actividad) y **Mi historial** (lavados, cobrado, horas) |
| Panel maestro | `dueno.html` | Dueño | **Hoy** (agenda, KPIs, equipo en turno) · **Actividad** (registro, caja por medio de pago, horas por persona) · **Equipo** (dar/quitar acceso, roles) · **Precios** (servicios, precios, tipos de vehículo) · **Negocio** (datos, horario, días, capacidad, medios de pago) |

> Nombre, dirección, servicios y precios tomados del afiche del local. Teléfono, WhatsApp, horario, duraciones y reservas son **de ejemplo** (se editan desde el panel).

## Dos modos de funcionamiento

- **Modo demo** (actual): `js/firebase-config.js` vale `null`. Todo se guarda en el navegador y se entra con cuentas de prueba (clave `demo1234`): `dueno@demo.cl`, `pedro@demo.cl`, `luis@demo.cl`. Sirve para probar y mostrar.
- **Modo nube**: con la configuración de Firebase pegada en `js/firebase-config.js`, todos comparten los mismos datos desde sus celulares, con login real.

## Conectar Firebase (una sola vez, ~20 min)

1. Entrar a https://console.firebase.google.com con una cuenta Google → **Agregar proyecto** (ej. `altavista-carwash`). Google Analytics no es necesario.
2. **Authentication** → Comenzar → pestaña *Método de acceso* → habilitar **Correo electrónico/contraseña**.
3. **Authentication** → pestaña *Usuarios* → **Agregar usuario** con *tu* correo y una clave. Esa será la cuenta del dueño principal.
4. **Firestore Database** → Crear base de datos → ubicación `southamerica-east1` (São Paulo) → modo producción.
5. **Firestore** → pestaña *Reglas* → borrar lo que hay, pegar el contenido de `firestore.rules`, **cambiar `CAMBIAR-POR-TU-CORREO@ejemplo.cl` por tu correo del paso 3** → Publicar.
6. ⚙️ Configuración del proyecto → *Tus apps* → ícono `</>` (web) → registrar app → copiar el objeto `firebaseConfig` y pegarlo en `js/firebase-config.js` reemplazando `null` (hay un ejemplo en el archivo).
7. Authentication → Configuración → *Dominios autorizados* → agregar `altavistacw.github.io`.
8. Subir los cambios a GitHub. Entrar a `ingreso.html` con tu correo → en el panel aparece **Cargar datos iniciales** (sube precios y horario de `/data`). Desde ahí se edita todo en la pestaña Precios y Negocio.
9. En **Equipo**, dar acceso a cada trabajador (nombre, correo, clave inicial) y enviarle sus datos por WhatsApp con el botón.

Plan gratuito (Spark) de Firebase: alcanza de sobra para un local (50.000 lecturas y 20.000 escrituras diarias).

## Seguridad (modo nube)
- Las reglas de `firestore.rules` son las que protegen los datos: sin sesión solo se pueden ver precios/horarios y crear reservas.
- Nombre y teléfono del cliente van en `contactos/` y solo los ve el equipo. Las reservas (`reservas/`) son públicas para mostrar horas libres y el estado por patente.
- Quitar acceso a alguien es inmediato y conserva su historial. Para cambiar la clave de un trabajador se le envía un correo desde Equipo (necesita un correo real).

## ¿Qué archivo edito?

| Quiero cambiar… | Dónde |
|---|---|
| Precios, servicios, horario, datos del local, equipo | **Desde el panel del dueño** (no hace falta tocar código) |
| Datos iniciales que se cargan la primera vez | `data/negocio.json`, `data/servicios.json` |
| Datos de la demo | `data/reservas-demo.json`, `data/equipo-demo.json` |
| Conexión a Firebase | `js/firebase-config.js` |
| Permisos de la base de datos | `firestore.rules` (copiar a la consola de Firebase) |
| Colores, tipografía, espaciados | `css/estilos.css` |
| Íconos | `js/iconos.js` |
| Lógica de datos (reservas, lavados, cobros, actividades, sesión) | `js/datos.js` |
| Motor de guardado (navegador o Firebase) | `js/almacen.js` |
| Ventanas, mensajes y pestañas compartidas | `js/ui.js` |
| Cada pantalla | `js/reserva.js` (inicio), `js/cliente.js`, `js/ingreso.js`, `js/trabajador.js`, `js/dueno.js` |
| Archivos para uso sin conexión | `sw.js` (al agregar un archivo, sumarlo a la lista y subir la versión `altavista-v5` → `v6`) |

## Probar en el computador

Los datos se cargan con `fetch`, que no funciona abriendo el archivo con doble clic. Hay que levantar un servidor local:

```
cd 01-Apps/lavado-auto
python -m http.server 8000
```

Luego abrir http://localhost:8000

## Limitaciones actuales
- En modo demo cada navegador tiene sus propios datos: el dueño no ve lo que registra un trabajador desde otro celular. Se resuelve conectando Firebase.
- Los cálculos de pago a trabajadores no están incluidos (solo registro de lavados, cobros y horas).
- La disponibilidad se revisa justo antes de confirmar, pero dos clientes que confirman en el mismo segundo podrían tomar la misma hora.
