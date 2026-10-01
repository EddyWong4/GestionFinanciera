// Versión de la app. Súbela en cada cambio publicado: la usan app.js (pantalla y avisos)
// y sw.js (nombre de la caché, para que la app instalada descargue la versión nueva).
const VERSION = '1.17.0';

const NOVEDADES = [
  { v: '1.17.0', fecha: '2026-10-01', cambios: [
    'Metas de ahorro: indica dónde guardas el dinero (ej. BBVA · Apartado). Al aportar, la app elige esa cuenta sola.',
    'Mis cuentas muestra cuánto tienes en apartados de cada banco, para cuadrar con la app de tu banco.',
  ] },
  { v: '1.16.1', fecha: '2026-10-01', cambios: [
    'Nuevo diseño de Salud financiera: termómetro de colores con tu carita marcando dónde estás, y la lista de indicadores con su semáforo y su dato.',
  ] },
  { v: '1.16.0', fecha: '2026-10-01', cambios: [
    '🩺 Salud financiera en el Resumen: una calificación de 0 a 100 con carita 😁🙂😐😟😱 según cómo vas.',
    'Semáforo 🟢🟡🟠🔴 de 6 indicadores: ahorro, fondo de emergencia, carga de deudas, gasto, deuda cara y uso de crédito.',
    'Plan con acciones concretas (con montos) ordenadas por los puntos que te suben, y cómo cambió contra el mes pasado.',
  ] },
  { v: '1.15.0', fecha: '2026-10-01', cambios: [
    'Plan para liquidar más claro: eliges en cuánto tiempo quieres salir de deudas (6 meses, 1 año, 18 meses, 2 años) y te dice cuánto pagar al mes y por quincena.',
    'Te dice cómo repartir ese pago este mes: cuánto a cada tarjeta (mínimo + extra).',
    'Si prefieres, puedes poner tú el monto mensual y ver cuándo terminas.',
  ] },
  { v: '1.14.3', fecha: '2026-09-30', cambios: [
    '"Dinero libre" ahora se llama "Balance de la quincena" (lo que entró menos lo que salió) y muestra cuánto tienes en tus cuentas, para no confundirlos.',
    'Si el balance sale negativo por abonar a tus deudas, el asesor lo reconoce como algo bueno en lugar de alarmarte.',
  ] },
  { v: '1.14.2', fecha: '2026-09-29', cambios: [
    'Fijos semanales (ej. gimnasio): ahora salen en un solo renglón con las fechas de la quincena para marcar cada una, en lugar de repetirse.',
    'Próximos pagos ya no repite lo que está en "Fijos de la quincena"; ahí se muestra "vence mañana" o "en 2 días".',
  ] },
  { v: '1.14.1', fecha: '2026-09-29', cambios: [
    'Nuevo movimiento: la nota ya no se encima con la fecha (se corrigió en todos los formularios).',
    'El aviso de "versión nueva" ahora tiene botón para cerrarlo y ya no aparece si ya tienes la última versión.',
  ] },
  { v: '1.14.0', fecha: '2026-09-29', cambios: [
    'Resumen → Próximos pagos: tarjetas, mensualidades, fijos y gastos del año que vencen en los próximos 7 días, con botón para pagar.',
    'Si tu teléfono lo permite, el ícono de la app muestra cuántos pagos vencen en los próximos 3 días.',
  ] },
  { v: '1.13.0', fecha: '2026-09-29', cambios: [
    'Movimientos: buscador en todas tus fechas (por categoría, nota, cuenta, monto o etiqueta).',
    'Filtros por categoría y por etiqueta, con el total de lo filtrado.',
    'Etiquetas en tus movimientos (ej. #viaje): toca una para ver todo lo que tiene esa etiqueta.',
  ] },
  { v: '1.12.0', fecha: '2026-09-29', cambios: [
    'Ajustes → Seguridad: pon un PIN para abrir la app (y huella o rostro si tu teléfono lo tiene).',
    'La app se oculta al salir y pide el PIN si pasó más de 1 minuto.',
    'Respaldos con contraseña: el archivo va cifrado y solo se abre con ella.',
  ] },
  { v: '1.11.0', fecha: '2026-09-29', cambios: [
    'Nueva pestaña Reportes: patrimonio neto (lo que tienes menos lo que debes) y su evolución mes a mes.',
    'Comparativo de este mes contra el anterior, general y por categoría.',
    'Tu año mes por mes y en qué se fue tu dinero.',
    'Exportar movimientos a Excel (CSV).',
  ] },
  { v: '1.10.0', fecha: '2026-09-29', cambios: [
    'Préstamos personales, automotrices e hipotecarios con pago fijo: pagos restantes, fecha de término e intereses por pagar.',
    'Entre personas: lleva lo que prestas y lo que te prestan, con sus abonos.',
    'Los créditos hipotecarios ya no suman IVA a los intereses.',
  ] },
  { v: '1.9.0', fecha: '2026-09-29', cambios: [
    'Ahorro → Gastos del año: tenencia, seguro, predial, inscripciones, regalos… con cuánto apartar por quincena.',
    '"Ya lo pagué" usa lo apartado, registra el gasto y lo pasa al año siguiente.',
    'La proyección de quincenas incluye lo que toca apartar.',
    'El asesor te sugiere cómo usar el aguinaldo.',
  ] },
  { v: '1.8.0', fecha: '2026-09-29', cambios: [
    'Próximas quincenas: proyección de las siguientes 6 quincenas con lo que entra, lo que sale y cuánto te quedará.',
    'Aviso anticipado cuando una quincena futura se ve apretada.',
  ] },
  { v: '1.7.0', fecha: '2026-09-29', cambios: [
    'Presupuesto por categoría: ponle un tope por quincena a cada categoría.',
    'Barras en verde, amarillo (80%) y rojo (te pasaste), con lo que te queda.',
    'Botón para sugerir el presupuesto según tus gastos de los últimos 3 meses.',
  ] },
  { v: '1.6.0', fecha: '2026-09-29', cambios: [
    'Mis cuentas: efectivo, débito/nómina y ahorro, con su saldo real. Ajústalo con ✏️ para que coincida con tu banco.',
    'Cada gasto dice con qué se pagó: una cuenta o una tarjeta de crédito.',
    'Las compras con tarjeta suben el saldo de la tarjeta y no descuentan de tus cuentas; pagar la tarjeta ya no se cuenta como otro gasto (antes se contaba doble).',
    'Traspasos entre cuentas (ej. sacar efectivo del cajero).',
    '"Dinero libre" ahora es lo que entró menos lo que salió de tus cuentas.',
  ] },
  { v: '1.5.0', fecha: '2026-09-29', cambios: [
    'Compras a meses: sin intereses (MSI) o con intereses, en Deudas → Compras a meses.',
    'Cada mensualidad aparece en la quincena en que vence para marcarla como pagada.',
    'El uso de línea de la tarjeta ya incluye lo que tienes a meses.',
  ] },
  { v: '1.4.1', fecha: '2026-09-29', cambios: ['Buscar actualización ya no guarda copias de más en el teléfono.'] },
  { v: '1.4.0', fecha: '2026-09-29', cambios: [
    'Ahora ves qué versión tienes en Ajustes → Versión de la app.',
    'Aviso con las novedades cada vez que la app se actualiza.',
    'Botón "Buscar actualización" y descarga automática de la versión más reciente cuando hay internet.',
  ] },
  { v: '1.3.0', fecha: '2026-09-29', cambios: [
    'Nueva opción "Una vez al mes" para fijos como el gimnasio (ya no se duplican).',
    'Al editar un fijo: "Quitar solo esta vez" o "Eliminar para siempre".',
  ] },
  { v: '1.2.0', fecha: '2026-09-29', cambios: ['Gastos e ingresos fijos semanales (ej. súper cada sábado).'] },
  { v: '1.1.0', fecha: '2026-09-29', cambios: ['Todo se organiza por quincena.', 'Lista de fijos de la quincena y cuánto te queda libre.'] },
  { v: '1.0.0', fecha: '2026-09-29', cambios: ['Primera versión: ingresos, gastos, ahorro, deudas y respaldos locales.'] },
];
