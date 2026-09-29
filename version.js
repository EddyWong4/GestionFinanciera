// Versión de la app. Súbela en cada cambio publicado: la usan app.js (pantalla y avisos)
// y sw.js (nombre de la caché, para que la app instalada descargue la versión nueva).
const VERSION = '1.4.1';

const NOVEDADES = [
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
