# Usuarios de FerroMaster

El propietario `carzunsan@gmail.com` conserva el rol de administrador.
Desde Usuarios puede agregar un cajero por nombre y correo, o desactivar su acceso.
El cajero abre la misma web y solicita su enlace de acceso con su propio correo.
Agregar un usuario autoriza su correo; no envia automaticamente una invitacion.

Los cajeros solo leen `catalog`, sin costos de compra. No leen inventario privado,
costos historicos, listas de usuarios ni ventas anteriores. No pueden modificar
precios, dar permisos, anular ventas ni hacer devoluciones. Desactivar su perfil
revoca las operaciones en las reglas, incluso si su sesion sigue abierta.

Las ventas de cajero admiten hasta 8 productos distintos por transaccion, con
varias unidades/cajas de cada producto. Este limite permite validar el carrito
completo con reglas de Firestore, sin activar Cloud Functions ni facturacion.
Las cantidades, existencias y referencia de precio historico se validan en el
servidor. Los costos y precios historicos se guardan en versiones inmutables
privadas, para que editar el inventario no modifique ganancias pasadas.

`catalog.stock` es la existencia autoritativa tras ventas de cajero. La interfaz
administrativa combina ese stock con los datos privados de `inventory`.
Al crear el primer cajero, la app prepara los catalogos que faltan sin cambiar
las existencias ni borrar productos. Recargar pestañas antiguas antes de usar
esta version junto con cuentas de cajero.

No se implementan turnos, arqueos, descuentos ni aprobaciones remotas en esta
version. Las devoluciones existentes siguen siendo exclusivas del propietario.

Pruebas: `npm test` y `npm run test:rules` (Java 21 y Firebase CLI).
