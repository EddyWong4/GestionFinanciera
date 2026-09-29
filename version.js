// Versión de la app. Súbela en cada cambio publicado: la usan app.js (pantalla y avisos)
// y sw.js (nombre de la caché, para que la app instalada descargue la versión nueva).
const VERSION = '1.7.0';

const NOVEDADES = [
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
