'use strict';

/* =========================================================
   Mis Finanzas — PWA offline, datos 100% en el dispositivo
   Almacenamiento: IndexedDB (estado + respaldos automáticos)
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fmt = n => MXN.format(Math.round((n || 0) * 100) / 100);
const pct = n => (isFinite(n) ? (n * 100).toFixed(0) : '0') + '%';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(/[,$\s]/g, '')); return isFinite(n) ? n : 0; };
const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const mesDe = f => f.slice(0, 7);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]} ${y}`; };
const nombreMes = ym => { const [y, m] = ym.split('-'); return `${MESES[+m - 1]} ${y.slice(2)}`; };

/* ---------- Catálogos ---------- */
// Grupo de la regla 50/30/20: N = necesidades, D = deseos, A = ahorro / pago de deuda
const CATS = {
  ingreso: ['Sueldo', 'Honorarios / freelance', 'Negocio', 'Aguinaldo / bonos', 'Rentas', 'Otros ingresos'],
  gasto: [
    ['Vivienda', 'N'], ['Servicios (luz, agua, gas, internet)', 'N'], ['Súper y despensa', 'N'],
    ['Transporte / gasolina', 'N'], ['Salud', 'N'], ['Educación', 'N'], ['Seguros', 'N'],
    ['Restaurantes y comida fuera', 'D'], ['Entretenimiento', 'D'], ['Ropa y calzado', 'D'],
    ['Suscripciones', 'D'], ['Regalos', 'D'], ['Otros gastos', 'D'], ['Pago de deuda', 'A'],
  ],
};
const GRUPO = Object.fromEntries(CATS.gasto);
const TIPOS_DEUDA = { tc: 'Tarjeta de crédito', dep: 'Tienda departamental', prestamo: 'Préstamo personal', otra: 'Otra' };
const IVA = 1.16; // En México el IVA se cobra sobre los intereses de tarjetas

/* ---------- Estado ---------- */
const estadoVacio = () => ({
  version: 1,
  movs: [],     // {id, tipo:'ingreso'|'gasto'|'ahorro', monto, cat, fecha, nota, metaId?, deudaId?, histId?}
  metas: [],    // {id, nombre, objetivo, inicial, fechaMeta?}
  deudas: [],   // {id, nombre, tipo, saldoInicial, tasa, minimo, limite, diaCorte, diaPago, hist:[{id,fecha,tipo,monto}]}
  fijos: [],    // {id, tipo:'gasto'|'ingreso', nombre, monto, cat, cuando:'cada'|'q1'|'q2'|'semanal', dia?, diaSemana?}
  ajustes: { iva: true, estrategia: 'avalancha', presupuestoDeuda: 0, ultimoExport: null, modo: 'quincena' },
});
let S = estadoVacio();
let vista = 'resumen';
let filtroMov = 'todos';

/* ---------- Periodos: quincena ('2026-09-1' / '2026-09-2') o mes ('2026-09') ---------- */
const esMes = () => S.ajustes.modo === 'mes';
const diasDelMes = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const periodoDe = f => esMes() ? f.slice(0, 7) : `${f.slice(0, 7)}-${+f.slice(8, 10) <= 15 ? 1 : 2}`;
function rango(p) {
  const ym = p.slice(0, 7), q = +p.split('-')[2] || 0, fin = `${ym}-${diasDelMes(ym)}`;
  if (!q) return [`${ym}-01`, fin];
  return q === 1 ? [`${ym}-01`, `${ym}-15`] : [`${ym}-16`, fin];
}
function moverPeriodo(p, delta) {
  const [y, m, q] = p.split('-').map(Number);
  if (!q) { const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  const i = (y * 12 + m - 1) * 2 + q - 1 + delta;
  return `${Math.floor(i / 24)}-${String(Math.floor((i % 24) / 2) + 1).padStart(2, '0')}-${(i % 2) + 1}`;
}
function nombrePeriodo(p, corto = false) {
  const [y, m, q] = p.split('-').map(Number);
  if (!q) return corto ? `${MESES[m - 1]} ${String(y).slice(2)}` : `${MESES[m - 1]} ${y}`;
  return corto ? `${q}ª ${MESES[m - 1]}` : `${q === 1 ? '1ª' : '2ª'} quincena ${MESES[m - 1]} ${y}`;
}
const quincenasDe = p => p.split('-').length === 3 ? [p] : [`${p}-1`, `${p}-2`];
const enRango = (f, [a, b]) => f >= a && f <= b;
const palabraPeriodo = () => esMes() ? 'este mes' : 'esta quincena';
let per = periodoDe(hoyISO());

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  abrir() {
    return new Promise((ok, mal) => {
      const r = indexedDB.open('mis-finanzas', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('estado');
        db.createObjectStore('respaldos', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; ok(); };
      r.onerror = () => mal(r.error);
    });
  },
  tx(store, modo, fn) {
    return new Promise((ok, mal) => {
      const t = this.db.transaction(store, modo);
      const res = fn(t.objectStore(store));
      t.oncomplete = () => ok(res && 'result' in res ? res.result : undefined);
      t.onerror = () => mal(t.error);
    });
  },
  leer() { return this.tx('estado', 'readonly', s => s.get('principal')); },
  escribir(v) { return this.tx('estado', 'readwrite', s => s.put(v, 'principal')); },
  respaldos() { return this.tx('respaldos', 'readonly', s => s.getAll()); },
  guardarRespaldo(r) { return this.tx('respaldos', 'readwrite', s => s.put(r)); },
  borrarRespaldo(id) { return this.tx('respaldos', 'readwrite', s => s.delete(id)); },
};

const MAX_RESPALDOS = 14;
let timerGuardar;
function guardar() {
  clearTimeout(timerGuardar);
  timerGuardar = setTimeout(async () => {
    try {
      await DB.escribir(S);
      await respaldoAutomatico();
    } catch (e) { toast('⚠️ No se pudo guardar: ' + e.message); }
  }, 250);
}

// Un respaldo automático por día, se conservan los últimos MAX_RESPALDOS
async function respaldoAutomatico() {
  const lista = await DB.respaldos();
  const hoy = hoyISO();
  if (lista.some(r => r.auto && r.fecha.slice(0, 10) === hoy)) {
    // Actualiza el respaldo automático de hoy con la versión más reciente
    const r = lista.find(r => r.auto && r.fecha.slice(0, 10) === hoy);
    r.datos = structuredClone(S); r.fecha = new Date().toISOString();
    await DB.guardarRespaldo(r);
  } else if (S.movs.length || S.deudas.length || S.metas.length) {
    await DB.guardarRespaldo({ id: uid(), fecha: new Date().toISOString(), auto: true, datos: structuredClone(S) });
  }
  await podarRespaldos();
}
async function podarRespaldos() {
  const lista = (await DB.respaldos()).filter(r => r.auto).sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const r of lista.slice(MAX_RESPALDOS)) await DB.borrarRespaldo(r.id);
}

/* ---------- Cálculos ---------- */
const movsPer = p => { const r = rango(p); return S.movs.filter(x => enRango(x.fecha, r)); };
function totales(p) {
  const t = { ingreso: 0, gasto: 0, ahorro: 0, N: 0, D: 0, A: 0, deuda: 0, porCat: {} };
  for (const x of movsPer(p)) {
    if (x.tipo === 'ingreso') t.ingreso += x.monto;
    else if (x.tipo === 'ahorro') { t.ahorro += x.monto; t.A += x.monto; }
    else {
      t.gasto += x.monto;
      const g = GRUPO[x.cat] || 'D';
      t[g] += x.monto;
      if (x.cat === 'Pago de deuda') t.deuda += x.monto;
      t.porCat[x.cat] = (t.porCat[x.cat] || 0) + x.monto;
    }
  }
  t.libre = t.ingreso - t.gasto - t.ahorro;
  return t;
}
const acumuladoMeta = mt => mt.inicial + S.movs.filter(x => x.metaId === mt.id).reduce((a, x) => a + x.monto, 0);
const saldoDeuda = d => Math.max(0, d.saldoInicial + d.hist.reduce((a, h) => a + (h.tipo === 'pago' ? -h.monto : h.monto), 0));
const factorIVA = () => (S.ajustes.iva ? IVA : 1);
const interesMensual = d => saldoDeuda(d) * d.tasa / 100 / 12 * factorIVA();
const deudasActivas = () => S.deudas.filter(d => saldoDeuda(d) > 0.5);

function promedioGastoMensual() {
  // Promedio de gastos (sin pagos de deuda) de los últimos 3 meses con registros
  const meses = [...new Set(S.movs.map(x => mesDe(x.fecha)))].sort().reverse().slice(0, 3);
  if (!meses.length) return 0;
  return meses.reduce((a, m) => { const t = totales(m); return a + t.gasto - t.deuda; }, 0) / meses.length;
}

// Fijos (y tarjetas por vencer) que tocan en cada quincena del periodo, con su estado de pago
function compromisos(p) {
  return quincenasDe(p).map(q => {
    const r = rango(q);
    // Los semanales generan una ocurrencia por cada vez que su día cae en la quincena (2 o 3)
    // clave: identifica cada ocurrencia (fecha si es semanal, quincena si no) para poder omitirla sola
    const fijos = [];
    const ultimo = diasDelMes(q.slice(0, 7));
    for (const f of S.fijos) {
      const omit = f.omitidos || [];
      if (f.cuando === 'semanal') {
        for (const fecha of fechasDiaSemana(r, f.diaSemana)) {
          if (!omit.includes(fecha)) fijos.push({ f, fecha, clave: fecha, mov: S.movs.find(x => x.fijoId === f.id && x.ocurrencia === fecha) });
        }
      } else {
        const toca = f.cuando === 'cada' || (() => { const d = Math.min(diaMensual(f), ultimo); return d >= +r[0].slice(8) && d <= +r[1].slice(8); })();
        if (toca && !omit.includes(q)) fijos.push({ f, fecha: null, clave: q, mov: S.movs.find(x => x.fijoId === f.id && !x.ocurrencia && enRango(x.fecha, r)) });
      }
    }
    const orden = x => x.fecha ? +x.fecha.slice(8, 10) : (x.f.dia || 99);
    fijos.sort((a, b) => orden(a) - orden(b));
    const [dIni, dFin] = r.map(x => +x.slice(8, 10));
    const ultimoDia = diasDelMes(q.slice(0, 7));
    const tarjetas = deudasActivas()
      .filter(d => { const dia = Math.min(d.diaPago || 0, ultimoDia); return dia >= dIni && dia <= dFin; })
      .map(d => ({ d, pagado: d.hist.some(h => h.tipo === 'pago' && enRango(h.fecha, r)) }));
    return { q, r, fijos, tarjetas };
  });
}
function pendientes(p) {
  let gasto = 0, ingreso = 0, tarjetas = 0;
  for (const c of compromisos(p)) {
    for (const { f, mov } of c.fijos) if (!mov) f.tipo === 'ingreso' ? ingreso += f.monto : gasto += f.monto;
    for (const { d, pagado } of c.tarjetas) if (!pagado) tarjetas += Math.min(d.minimo, saldoDeuda(d));
  }
  return { gasto, ingreso, tarjetas };
}
function fechasDiaSemana([ini, fin], dow) {
  const out = [];
  const d = new Date(ini + 'T12:00:00');
  const f = new Date(fin + 'T12:00:00');
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  for (; d <= f; d.setDate(d.getDate() + 7)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  return out;
}
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
// Día del mes de un fijo mensual (el formato anterior q1/q2 sin día cae al inicio de su quincena)
const diaMensual = f => f.dia || (f.cuando === 'q2' ? 16 : 1);
const cuandoTexto = f => f.cuando === 'semanal' ? `cada ${DIAS[f.diaSemana]}`
  : f.cuando === 'cada' ? 'cada quincena' : `mensual · día ${diaMensual(f)}`;
// Fecha en que se registra un fijo: su día si cae en la quincena; si no, hoy (si aplica) o el inicio
function fechaFijo(f, r) {
  const ym = r[0].slice(0, 7);
  if (f.dia) { const d = `${ym}-${String(Math.min(f.dia, diasDelMes(ym))).padStart(2, '0')}`; if (enRango(d, r)) return d; }
  return enRango(hoyISO(), r) ? hoyISO() : r[0];
}

function proximaFecha(dia) {
  if (!dia) return null;
  const h = new Date(); h.setHours(0, 0, 0, 0);
  const crear = (y, m) => new Date(y, m, Math.min(dia, new Date(y, m + 1, 0).getDate()));
  let f = crear(h.getFullYear(), h.getMonth());
  if (f < h) f = crear(h.getFullYear(), h.getMonth() + 1);
  return { fecha: f, dias: Math.round((f - h) / 864e5) };
}

/**
 * Simula el pago mes a mes.
 * - Cada mes se generan intereses (tasa anual / 12, + IVA opcional).
 * - Se cubren los mínimos de todas y el sobrante va a la deuda prioritaria.
 * - Al liquidar una deuda, su mínimo se "rueda" a la siguiente (efecto bola de nieve).
 */
function simular(presupuesto, estrategia) {
  const f = factorIVA();
  const ds = deudasActivas().map(d => ({ id: d.id, nombre: d.nombre, tipo: d.tipo, saldo: saldoDeuda(d), tasa: d.tasa, min: d.minimo, interes: 0, mes: null }));
  if (!ds.length) return { meses: 0, interes: 0, orden: [] };
  const sumMin = ds.reduce((a, d) => a + Math.min(d.min, d.saldo), 0);
  if (presupuesto + 0.01 < sumMin) return { error: 'insuficiente', sumMin };
  let mesN = 0, interes = 0;
  const ordenar = estrategia === 'avalancha'
    ? (a, b) => b.tasa - a.tasa || a.saldo - b.saldo
    : (a, b) => a.saldo - b.saldo || b.tasa - a.tasa;
  while (ds.some(d => d.saldo > 0.005) && mesN < 600) {
    mesN++;
    const activas = ds.filter(d => d.saldo > 0.005);
    for (const d of activas) { const i = d.saldo * d.tasa / 100 / 12 * f; d.saldo += i; d.interes += i; interes += i; }
    let disp = presupuesto;
    for (const d of activas) { const p = Math.min(d.min, d.saldo, disp); d.saldo -= p; disp -= p; }
    for (const d of activas.sort(ordenar)) { if (disp <= 0) break; const p = Math.min(disp, d.saldo); d.saldo -= p; disp -= p; }
    for (const d of ds) if (d.saldo <= 0.005 && d.mes == null) d.mes = mesN;
  }
  return { meses: mesN, interes, sinFin: mesN >= 600, orden: ds.sort((a, b) => (a.mes ?? 1e9) - (b.mes ?? 1e9)), sumMin };
}

// Escenario de pagar SOLO el mínimo fijo en cada deuda, sin rodar pagos
function simularSoloMinimos() {
  const f = factorIVA();
  let maxMes = 0, interes = 0, sinFin = false;
  for (const d of deudasActivas()) {
    let s = saldoDeuda(d), m = 0;
    while (s > 0.005 && m < 600) { m++; const i = s * d.tasa / 100 / 12 * f; s += i; interes += i; s -= Math.min(d.minimo, s); }
    if (m >= 600) sinFin = true;
    maxMes = Math.max(maxMes, m);
  }
  return { meses: maxMes, interes, sinFin };
}

const duracion = m => {
  if (m >= 600) return 'Nunca (50+ años)';
  const a = Math.floor(m / 12), r = m % 12;
  return [a ? `${a} año${a > 1 ? 's' : ''}` : '', r ? `${r} mes${r > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' y ') || '0 meses';
};
const fechaFin = m => { const d = new Date(); d.setMonth(d.getMonth() + m); return `${MESES[d.getMonth()]} ${d.getFullYear()}`; };

/* ---------- Asesor financiero: consejos ---------- */
function consejos(t) {
  const out = [];
  const add = (nivel, ic, txt) => out.push({ nivel, ic, txt });
  const ing = t.ingreso;

  if (!S.movs.length) {
    add('info', '👋', 'Empieza registrando tus ingresos, tus gastos fijos de cada quincena y cada gasto, por pequeño que sea. Lo que no se mide no se puede mejorar.');
  }
  if (ing > 0) {
    const tasaAhorro = t.ahorro / ing;
    if (tasaAhorro >= 0.2) add('ok', '🏆', `Estás ahorrando el ${pct(tasaAhorro)} de tu ingreso. ¡Excelente disciplina!`);
    else if (tasaAhorro >= 0.1) add('warn', '📈', `Ahorras el ${pct(tasaAhorro)} de tu ingreso. Intenta llegar al 20% automatizando el ahorro el día de pago ("págate primero").`);
    else add('bad', '🐷', `Tu ahorro ${palabraPeriodo()} es de ${pct(tasaAhorro)}. Meta mínima sugerida: 10% del ingreso, apartado el mismo día que cobras.`);

    if (t.N / ing > 0.6) add('warn', '🏠', `Tus necesidades consumen el ${pct(t.N / ing)} del ingreso (ideal ≤ 50%). Revisa renta, servicios y súper para encontrar ahorros.`);
    if (t.D / ing > 0.3) add('warn', '🛍️', `Los gastos de deseos son el ${pct(t.D / ing)} del ingreso (ideal ≤ 30%). Es el rubro más fácil de recortar.`);
    if (t.libre < 0) add('bad', '🚨', `Gastaste ${fmt(-t.libre)} más de lo que ingresó ${palabraPeriodo()}. Revisa si estás financiando el día a día con tarjeta.`);
  }
  const pend = pendientes(per);
  const proyectado = t.libre + pend.ingreso - pend.gasto - pend.tarjetas;
  if (pend.gasto + pend.tarjetas > 0 && proyectado < 0) add('bad', '📌', `Tus pendientes de ${palabraPeriodo()} (${fmt(pend.gasto + pend.tarjetas)}) superan lo que te queda. Te faltarían ${fmt(-proyectado)}: pospón gastos de "deseos" hasta cubrir los fijos.`);
  const semanales = S.fijos.filter(f => f.cuando === 'semanal' && f.tipo === 'gasto').reduce((a, f) => a + f.monto, 0);
  if (semanales > 0) add('info', '📅', `Tus gastos semanales (${fmt(semanales)} por semana) equivalen a unos <b>${fmt(semanales * 52 / 12)} al mes</b>. Hay quincenas con 3 semanas: en esas separa un poco más.`);
  if (!S.fijos.length && S.movs.length) add('info', '📌', 'Da de alta tus <b>gastos fijos</b> (renta, luz, colegiaturas…) y tu sueldo quincenal. Así sabrás desde el día de pago cuánto te queda realmente libre.');

  const activas = deudasActivas();
  const totalDeuda = activas.reduce((a, d) => a + saldoDeuda(d), 0);
  for (const d of activas) {
    const i = interesMensual(d);
    if (d.minimo <= i) add('bad', '⛔', `<b>${esc(d.nombre)}</b>: el pago mínimo (${fmt(d.minimo)}) no cubre los intereses (${fmt(i)}/mes). La deuda <u>crece</u> aunque pagues. Aumenta el pago cuanto antes.`);
    if (d.limite > 0 && saldoDeuda(d) / d.limite > 0.3) add('warn', '📉', `<b>${esc(d.nombre)}</b> usa el ${pct(saldoDeuda(d) / d.limite)} de su línea. Mantenerlo bajo 30% mejora tu historial en Buró de Crédito.`);
  }
  if (activas.some(d => d.tipo === 'dep' && d.tasa >= 50)) add('info', '🏬', 'Las tarjetas departamentales suelen tener tasas muy altas (60%–100% anual). Deja de usarlas mientras las liquidas y evita "meses sin intereses" que no puedas cubrir.');
  if (ing > 0 && totalDeuda > 0) {
    const pagoMin = activas.reduce((a, d) => a + d.minimo, 0);
    const r = pagoMin / ing;
    if (r > 0.3) add('bad', '⚖️', `Tus pagos mínimos equivalen al ${pct(r)} de tu ingreso. Arriba del 30% es zona de riesgo: no adquieras nuevas deudas.`);
  }

  const emergencia = S.metas.find(m => /emergencia/i.test(m.nombre));
  const gastoProm = promedioGastoMensual();
  if (!emergencia) add('info', '🛟', 'Crea un <b>Fondo de emergencia</b> en Ahorro. Objetivo: 3 a 6 meses de tus gastos básicos. Evita volver a endeudarte ante un imprevisto.');
  else if (gastoProm > 0 && acumuladoMeta(emergencia) < gastoProm * 3) add('info', '🛟', `Tu fondo de emergencia cubre ${(acumuladoMeta(emergencia) / gastoProm).toFixed(1)} meses de gastos. Meta: 3 a 6 meses (${fmt(gastoProm * 3)} – ${fmt(gastoProm * 6)}).`);
  if (activas.length && emergencia && acumuladoMeta(emergencia) >= 5000) add('info', '💡', 'Con deudas de tasa alta, conviene tener un fondo de emergencia básico y destinar el resto del ahorro a liquidar tarjetas: ninguna inversión rinde 60% anual.');

  const dias = S.ajustes.ultimoExport ? (Date.now() - new Date(S.ajustes.ultimoExport)) / 864e5 : Infinity;
  if (S.movs.length > 5 && dias > 30) add('warn', '💾', 'Hace más de un mes que no exportas un archivo de respaldo. Ve a Ajustes → "Exportar archivo de respaldo" y guárdalo en tu dispositivo.');
  return out;
}
const htmlTips = tips => tips.map(c => `<div class="tip ${c.nivel}"><span class="ic">${c.ic}</span><div>${c.txt}</div></div>`).join('');

/* ---------- Vistas ---------- */
const TITULOS = { resumen: 'Resumen', movs: 'Movimientos', ahorro: 'Ahorro', deudas: 'Deudas', ajustes: 'Ajustes' };
function render() {
  $('#titulo').textContent = TITULOS[vista];
  $('#per-lbl').textContent = nombrePeriodo(per);
  $('#per-lbl').classList.toggle('actual', per === periodoDe(hoyISO()));
  $('.mes-nav').style.visibility = (vista === 'resumen' || vista === 'movs') ? 'visible' : 'hidden';
  $('.fab').style.display = vista === 'ajustes' ? 'none' : '';
  $$('.tabbar button').forEach(b => b.classList.toggle('activo', b.dataset.tab === vista));
  $('#vista').innerHTML = VISTAS[vista]();
}

function htmlCompromisos(pend, proyectado) {
  const bloques = compromisos(per);
  const hayAlgo = bloques.some(b => b.fijos.length || b.tarjetas.length);
  const titulo = esMes() ? 'Fijos del mes' : 'Fijos de la quincena';
  if (!hayAlgo) return `<section class="card">
    <div class="row"><h2 style="margin:0">📌 ${titulo}</h2><button class="btn mini" data-action="nuevo-fijo">+ Agregar fijo</button></div>
    <p class="small muted" style="margin-bottom:0">Da de alta lo que pagas o cobras cada quincena (renta, luz, colegiatura, sueldo…). Cada quincena aparecerá como lista para marcarlo con un toque.</p>
  </section>`;

  let nPend = 0;
  const cuerpo = bloques.map(b => {
    const items = b.fijos.map(({ f, fecha, clave, mov }) => {
      if (!mov) nPend++;
      const ing = f.tipo === 'ingreso';
      return `<li class="${mov ? 'hecho' : ''}">
        <button class="check-btn ${mov ? 'on' : ''}" data-action="marcar-fijo" data-id="${f.id}" data-q="${b.q}" data-fecha="${fecha || ''}" aria-label="${mov ? 'Desmarcar' : 'Marcar como ' + (ing ? 'recibido' : 'pagado')}">${mov ? '✓' : ''}</button>
        <div class="info"><b>${esc(f.nombre)}${fecha ? ` <span class="badge sem">${DIAS[f.diaSemana].slice(0, 3)} ${+fecha.slice(8, 10)}</span>` : ''}</b><span class="muted small">${ing ? 'Ingreso' : esc(f.cat)}${cuandoTexto(f) ? ' · ' + cuandoTexto(f) : ''}${mov ? ` · ${ing ? 'recibido' : 'pagado'} ${fechaCorta(mov.fecha)}` : ''}</span></div>
        <span class="monto ${ing ? 'c-ingreso' : 'c-gasto'}">${ing ? '+' : '−'} ${fmt(mov ? mov.monto : f.monto)}</span>
        <button class="link-btn" data-action="editar-fijo" data-id="${f.id}" data-clave="${clave}" data-etiqueta="${fecha ? fechaCorta(fecha).slice(0, -5) : nombrePeriodo(clave, true)}" data-pagado="${mov ? 1 : 0}" aria-label="Editar fijo">✏️</button>
      </li>`;
    }).concat(b.tarjetas.map(({ d, pagado }) => `<li class="${pagado ? 'hecho' : ''}">
        <button class="check-btn ${pagado ? 'on' : ''}" data-action="pagar-deuda" data-id="${d.id}" aria-label="Registrar pago de ${esc(d.nombre)}" ${pagado ? 'disabled' : ''}>${pagado ? '✓' : ''}</button>
        <div class="info"><b>💳 ${esc(d.nombre)}</b><span class="muted small">Pago mínimo · vence día ${d.diaPago}</span></div>
        <span class="monto c-deuda">− ${fmt(Math.min(d.minimo, saldoDeuda(d)))}</span>
      </li>`)).join('');
    return (esMes() ? `<p class="dia">${nombrePeriodo(b.q)}</p>` : '') + `<ul class="lista">${items || '<li class="muted small">Nada programado.</li>'}</ul>`;
  }).join('');

  return `<section class="card">
    <div class="row"><h2 style="margin:0">📌 ${titulo}</h2><button class="btn mini sec" data-action="nuevo-fijo">+ Fijo</button></div>
    ${cuerpo}
    <div class="resumen-fijos">
      ${pend.ingreso ? `<div class="row small"><span>Por recibir</span><b class="c-ingreso">${fmt(pend.ingreso)}</b></div>` : ''}
      <div class="row small"><span>Por pagar (fijos + tarjetas)</span><b class="c-gasto">${fmt(pend.gasto + pend.tarjetas)}</b></div>
      <div class="row"><span><b>Te quedará libre</b></span><b style="font-size:1.1rem;color:${proyectado < 0 ? 'var(--deuda)' : 'var(--ingreso)'}">${fmt(proyectado)}</b></div>
    </div>
    ${nPend > 1 ? `<button class="btn mini sec" data-action="marcar-todos" style="width:100%;margin-top:10px">Marcar todos los fijos pendientes</button>` : ''}
  </section>`;
}

const VISTAS = {
  resumen() {
    const t = totales(per);
    const pend = pendientes(per);
    const proyectado = t.libre + pend.ingreso - pend.gasto - pend.tarjetas;
    const ing = t.ingreso || 1;
    const totalDeuda = deudasActivas().reduce((a, d) => a + saldoDeuda(d), 0);
    const cats = Object.entries(t.porCat).sort((a, b) => b[1] - a[1]);
    const maxCat = cats[0]?.[1] || 1;

    // Tendencia de los últimos 6 periodos
    const ult = Array.from({ length: 6 }, (_, i) => moverPeriodo(per, i - 5));
    const tots = ult.map(totales);
    const maxT = Math.max(1, ...tots.flatMap(x => [x.ingreso, x.gasto + x.ahorro]));

    const regla = [
      ['Necesidades', t.N, 0.5, 'var(--gasto)'],
      ['Deseos', t.D, 0.3, 'var(--warn)'],
      ['Ahorro y pago de deudas', t.A, 0.2, 'var(--ahorro)'],
    ];

    return `
      <div class="kpis">
        <div class="kpi"><div class="lbl">Ingresos</div><div class="val c-ingreso">${fmt(t.ingreso)}</div></div>
        <div class="kpi"><div class="lbl">Gastos</div><div class="val c-gasto">${fmt(t.gasto)}</div></div>
        <div class="kpi"><div class="lbl">Ahorrado</div><div class="val c-ahorro">${fmt(t.ahorro)}</div></div>
        <div class="kpi"><div class="lbl">Disponible hoy</div><div class="val" style="color:${t.libre < 0 ? 'var(--deuda)' : 'inherit'}">${fmt(t.libre)}</div></div>
      </div>

      ${htmlCompromisos(pend, proyectado)}

      <section class="card">
        <h2>🧑‍💼 Tu asesor dice</h2>
        ${htmlTips(consejos(t)) || '<p class="muted">Todo en orden por ahora.</p>'}
      </section>

      <section class="card">
        <h2>Regla 50 / 30 / 20</h2>
        <p class="muted small" style="margin-top:-6px">Porcentaje de tu ingreso del periodo destinado a cada bloque.</p>
        ${regla.map(([n, v, meta, c]) => {
          const p = t.ingreso ? v / ing : 0;
          return `<div class="bar-row">
            <div class="row"><span>${n}</span><span><b>${pct(p)}</b> <span class="meta">/ meta ${n.startsWith('Ahorro') ? '≥' : '≤'} ${meta * 100}%</span></span></div>
            <div class="bar"><span style="width:${Math.min(100, p * 100)}%;background:${c}"></span></div>
          </div>`;
        }).join('')}
      </section>

      <section class="card">
        <h2>${esMes() ? 'Últimos 6 meses' : 'Últimas 6 quincenas'}</h2>
        <div class="tendencia">
          ${tots.map((x, i) => `<div class="col">
            <div class="pair">
              <span style="height:${x.ingreso / maxT * 100}%;background:var(--ingreso)" title="Ingresos ${fmt(x.ingreso)}"></span>
              <span style="height:${(x.gasto + x.ahorro) / maxT * 100}%;background:var(--gasto)" title="Egresos ${fmt(x.gasto + x.ahorro)}"></span>
            </div>
            <div class="lbl">${nombrePeriodo(ult[i], true)}</div>
          </div>`).join('')}
        </div>
        <div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos</span><span><i style="background:var(--gasto)"></i>Gastos + ahorro</span></div>
      </section>

      <section class="card">
        <h2>Gastos por categoría</h2>
        ${cats.length ? cats.map(([c, v]) => `<div class="bar-row">
            <div class="row"><span>${esc(c)}</span><b>${fmt(v)}</b></div>
            <div class="bar"><span style="width:${v / maxCat * 100}%;background:var(--gasto)"></span></div>
          </div>`).join('') : '<p class="muted">Sin gastos registrados en este periodo.</p>'}
      </section>

      <p class="small muted" style="text-align:center;margin:4px 0 0" data-tab="ajustes">Mis Finanzas v${VERSION}</p>
      ${totalDeuda > 0 ? `<section class="card row" data-tab="deudas" style="cursor:pointer">
        <div><h2 style="margin:0">Deuda total</h2><span class="muted small">${deudasActivas().length} cuenta(s) activas · ver plan</span></div>
        <div class="deuda-saldo">${fmt(totalDeuda)}</div>
      </section>` : ''}
    `;
  },

  movs() {
    let lista = movsPer(per);
    if (filtroMov !== 'todos') lista = lista.filter(x => x.tipo === filtroMov);
    lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
    const chips = [['todos', 'Todos'], ['ingreso', 'Ingresos'], ['gasto', 'Gastos'], ['ahorro', 'Ahorro']]
      .map(([k, n]) => `<button class="chip ${filtroMov === k ? 'on' : ''}" data-action="filtro" data-v="${k}">${n}</button>`).join('');
    if (!lista.length) return `<div class="chips">${chips}</div><div class="card vacio"><div class="big">🧾</div><p>No hay movimientos en la ${nombrePeriodo(per)}.</p><button class="btn" data-action="nuevo-mov">Registrar el primero</button></div>`;

    let html = `<div class="chips">${chips}</div><div class="card" style="padding-top:4px">`;
    let dia = '';
    for (const x of lista) {
      if (x.fecha !== dia) { if (dia) html += '</ul>'; dia = x.fecha; html += `<p class="dia">${fechaCorta(dia)}</p><ul class="lista">`; }
      const signo = x.tipo === 'ingreso' ? '+' : x.tipo === 'ahorro' ? (x.monto < 0 ? '↩' : '→') : '−';
      const color = x.tipo === 'ingreso' ? 'c-ingreso' : x.tipo === 'ahorro' ? 'c-ahorro' : 'c-gasto';
      const ic = x.tipo === 'ingreso' ? '💰' : x.tipo === 'ahorro' ? '🐷' : x.cat === 'Pago de deuda' ? '💳' : x.fijoId ? '📌' : '🛒';
      html += `<li>
        <span style="font-size:1.3rem">${ic}</span>
        <div class="info"><b>${esc(x.cat)}</b><span class="muted small">${esc(x.nota) || '&nbsp;'}</span></div>
        <span class="monto ${color}">${signo} ${fmt(Math.abs(x.monto))}</span>
        ${!x.metaId && !x.deudaId ? `<button class="link-btn" data-action="editar-mov" data-id="${x.id}" aria-label="Editar">✏️</button>` : ''}
        <button class="link-btn" data-action="borrar-mov" data-id="${x.id}" aria-label="Eliminar">🗑️</button>
      </li>`;
    }
    return html + '</ul></div>';
  },

  ahorro() {
    const total = S.metas.reduce((a, m) => a + acumuladoMeta(m), 0);
    const gastoProm = promedioGastoMensual();
    let html = `<div class="kpis" style="grid-template-columns:1fr 1fr">
      <div class="kpi"><div class="lbl">Total ahorrado</div><div class="val c-ahorro">${fmt(total)}</div></div>
      <div class="kpi"><div class="lbl">Gasto mensual prom.</div><div class="val">${fmt(gastoProm)}</div></div>
    </div>`;
    if (!S.metas.length) {
      return html + `<div class="card vacio"><div class="big">🐷</div><p>Aún no tienes metas de ahorro.<br>Te recomiendo empezar por un fondo de emergencia.</p>
        <div class="acciones" style="justify-content:center">
          <button class="btn" data-action="meta-emergencia">Crear fondo de emergencia</button>
          <button class="btn sec" data-action="nueva-meta">Otra meta</button>
        </div></div>`;
    }
    for (const m of S.metas) {
      const acc = acumuladoMeta(m);
      const p = m.objetivo ? acc / m.objetivo : 0;
      let extra = '';
      if (m.fechaMeta && acc < m.objetivo) {
        const [fy, fm] = m.fechaMeta.split('-').map(Number);
        const h = new Date();
        const mesesRest = Math.max(1, (fy - h.getFullYear()) * 12 + (fm - 1 - h.getMonth()));
        extra = `<p class="small muted">Para llegar a tiempo (${nombreMes(m.fechaMeta)}) aparta <b>${fmt((m.objetivo - acc) / mesesRest / 2)}</b> por quincena (${fmt((m.objetivo - acc) / mesesRest)} al mes).</p>`;
      }
      html += `<section class="card">
        <div class="row"><h3>${esc(m.nombre)}</h3><button class="link-btn" data-action="editar-meta" data-id="${m.id}" aria-label="Editar meta">✏️</button></div>
        <div class="row small"><span><b class="c-ahorro">${fmt(acc)}</b> de ${fmt(m.objetivo)}</span><b>${pct(Math.min(p, 1))}</b></div>
        <div class="bar" style="margin:6px 0"><span style="width:${Math.min(100, p * 100)}%;background:var(--ahorro)"></span></div>
        ${acc >= m.objetivo && m.objetivo > 0 ? '<div class="tip ok"><span class="ic">🎉</span><div>¡Meta alcanzada!</div></div>' : extra}
        <div class="acciones">
          <button class="btn mini" data-action="aportar" data-id="${m.id}">+ Aportar</button>
          <button class="btn mini sec" data-action="retirar" data-id="${m.id}">Retirar</button>
        </div>
      </section>`;
    }
    return html + `<button class="btn sec" data-action="nueva-meta" style="width:100%">+ Nueva meta de ahorro</button>`;
  },

  deudas() {
    const activas = deudasActivas();
    const liquidadas = S.deudas.filter(d => saldoDeuda(d) <= 0.5);
    const total = activas.reduce((a, d) => a + saldoDeuda(d), 0);
    const sumMin = activas.reduce((a, d) => a + d.minimo, 0);
    const intMes = activas.reduce((a, d) => a + interesMensual(d), 0);

    if (!S.deudas.length) return `<div class="card vacio"><div class="big">💳</div>
      <p>Registra tus tarjetas de crédito y departamentales.<br>Te armo un plan para liquidarlas y te digo cuánto ahorras en intereses.</p>
      <button class="btn" data-action="nueva-deuda">Agregar deuda</button></div>`;

    let html = `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="lbl">Deuda total</div><div class="val c-deuda">${fmt(total)}</div></div>
      <div class="kpi"><div class="lbl">Mínimos / mes</div><div class="val">${fmt(sumMin)}</div></div>
      <div class="kpi"><div class="lbl">Intereses / mes</div><div class="val c-deuda">${fmt(intMes)}</div></div>
    </div>`;

    if (activas.length) html += planHTML(activas, sumMin);

    for (const d of activas) html += tarjetaDeuda(d);
    html += `<button class="btn sec" data-action="nueva-deuda" style="width:100%;margin-bottom:14px">+ Agregar deuda</button>`;
    if (liquidadas.length) html += `<section class="card"><h2>🎉 Liquidadas</h2><ul class="lista">${liquidadas.map(d =>
      `<li><div class="info"><b>${esc(d.nombre)}</b><span class="muted small">${TIPOS_DEUDA[d.tipo]}</span></div>
       <button class="link-btn" data-action="borrar-deuda" data-id="${d.id}" aria-label="Eliminar">🗑️</button></li>`).join('')}</ul></section>`;
    return html;
  },

  ajustes() {
    return `
      <section class="card">
        <h2>🗓️ Organizar por</h2>
        <div class="chips" style="margin-bottom:4px">
          <button class="chip ${esMes() ? '' : 'on'}" data-action="modo" data-v="quincena">Quincena</button>
          <button class="chip ${esMes() ? 'on' : ''}" data-action="modo" data-v="mes">Mes</button>
        </div>
        <p class="small muted">Quincena: del 1 al 15 y del 16 a fin de mes. Resumen, movimientos y fijos se muestran por ese periodo.</p>
      </section>
      <section class="card">
        <h2>💾 Respaldos (en este dispositivo)</h2>
        <p class="small muted" style="margin-top:-4px">Tus datos <b>nunca salen de tu dispositivo</b>: no hay cuentas ni nube. La app funciona sin internet.</p>
        <div class="tip info"><span class="ic">🔄</span><div>Se crea un <b>respaldo automático diario</b> dentro de la app (se guardan los últimos ${MAX_RESPALDOS} días).</div></div>
        <div class="tip warn"><span class="ic">📁</span><div>Si borras los datos del navegador o desinstalas la app, se pierden también los respaldos internos. Exporta un <b>archivo</b> de vez en cuando y guárdalo en tu dispositivo (Descargas, tarjeta SD, etc.).
        ${S.ajustes.ultimoExport ? `<br><span class="small">Último archivo exportado: ${fechaCorta(S.ajustes.ultimoExport.slice(0, 10))}</span>` : ''}</div></div>
        <div class="acciones">
          <button class="btn" data-action="exportar">Exportar archivo de respaldo</button>
          <button class="btn sec" data-action="importar">Restaurar desde archivo</button>
          <button class="btn sec" data-action="respaldo-manual">Crear punto de restauración</button>
        </div>
        <input type="file" id="archivo" accept="application/json,.json" hidden>
        <h3 style="margin-top:16px">Puntos de restauración</h3>
        <ul class="lista" id="lista-respaldos"><li class="muted small">Cargando…</li></ul>
      </section>

      <section class="card">
        <h2>Cálculo de intereses</h2>
        <label class="check"><input type="checkbox" data-action="toggle-iva" ${S.ajustes.iva ? 'checked' : ''}> Sumar IVA (16%) a los intereses de las deudas</label>
        <p class="small muted">En México los bancos y tiendas cobran IVA sobre los intereses. Déjalo activado para simulaciones realistas.</p>
      </section>

      <section class="card">
        <div class="row"><h2 style="margin:0">📱 Versión de la app</h2><span class="badge version">v${VERSION}</span></div>
        <p class="small muted">Con internet, la app descarga sola la versión más reciente al abrirse.</p>
        <div class="acciones" style="margin-top:0">
          <button class="btn mini" data-action="buscar-actualizacion">Buscar actualización</button>
          <button class="btn mini sec" data-action="ver-novedades">Ver novedades</button>
        </div>
      </section>

      <section class="card">
        <h2>Instalar la app</h2>
        <p class="small muted">Instálala para abrirla como app y usarla sin conexión.</p>
        <button class="btn" data-action="instalar" id="btn-instalar" ${deferredInstall ? '' : 'hidden'}>Instalar en este dispositivo</button>
        <p class="small muted" ${deferredInstall ? 'hidden' : ''}>En Android/Chrome: menú ⋮ → "Instalar app". En iPhone/Safari: Compartir → "Agregar a inicio".</p>
      </section>

      <section class="card">
        <h2>Zona de peligro</h2>
        <button class="btn peligro" data-action="borrar-todo">Borrar todos los datos</button>
        <p class="small muted">Antes de borrar se crea un punto de restauración automáticamente.</p>
      </section>
      <p class="small muted" style="text-align:center">Mis Finanzas · v${VERSION} · datos locales</p>
    `;
  },
};

function planHTML(activas, sumMin) {
  const est = S.ajustes.estrategia;
  let presupuesto = S.ajustes.presupuestoDeuda || Math.ceil(sumMin);
  const r = simular(presupuesto, est);
  const alt = simular(presupuesto, est === 'avalancha' ? 'bola' : 'avalancha');
  const sm = simularSoloMinimos();

  let cuerpo;
  if (r.error) {
    cuerpo = `<div class="tip bad"><span class="ic">⚠️</span><div>Tu presupuesto no alcanza para cubrir los pagos mínimos (${fmt(r.sumMin)}). Aumenta el monto.</div></div>`;
  } else {
    const ahorroInt = sm.interes - r.interes;
    cuerpo = `
      <div class="comparativo">
        <div><span class="small muted">Solo pagando mínimos</span><b class="c-deuda">${duracion(sm.meses)}</b><span class="small">Intereses: ${sm.sinFin ? 'infinitos' : fmt(sm.interes)}</span></div>
        <div class="gana"><span class="small muted">Con tu plan (${fmt(presupuesto)}/mes)</span><b>${duracion(r.meses)}</b><span class="small">Intereses: ${r.sinFin ? 'infinitos' : fmt(r.interes)}</span></div>
      </div>
      ${!r.sinFin && ahorroInt > 1 ? `<div class="tip ok"><span class="ic">💸</span><div>Con este plan te ahorras <b>${sm.sinFin ? 'una deuda que nunca terminaría' : fmt(ahorroInt) + ' en intereses'}</b> y quedas libre de deudas en <b>${fechaFin(r.meses)}</b>.</div></div>` : ''}
      ${r.sinFin ? `<div class="tip bad"><span class="ic">⛔</span><div>Con este monto la deuda no se termina de pagar. Necesitas destinar más dinero al mes.</div></div>` : ''}
      ${!alt.error && !r.sinFin && Math.abs(alt.interes - r.interes) > 1 ? `<p class="small muted">Con el método ${est === 'avalancha' ? 'bola de nieve' : 'avalancha'} pagarías ${fmt(alt.interes)} en intereses y terminarías en ${duracion(alt.meses)}.</p>` : ''}
      <table class="plan">
        <thead><tr><th>#</th><th>Orden de liquidación</th><th class="n">Liquidada en</th><th class="n">Intereses</th></tr></thead>
        <tbody>${r.orden.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.nombre)} <span class="muted small">${d.tasa}%</span></td><td class="n">${d.mes ? fechaFin(d.mes) : '—'}</td><td class="n">${fmt(d.interes)}</td></tr>`).join('')}</tbody>
      </table>
      <p class="small muted">Paga el mínimo en todas y todo el excedente a la #${1} de la lista. Cuando la liquides, su pago se suma a la siguiente.</p>`;
  }

  return `<section class="card">
    <h2>🎯 Plan para liquidar</h2>
    <div class="chips">
      <button class="chip ${est === 'avalancha' ? 'on' : ''}" data-action="estrategia" data-v="avalancha">🏔️ Avalancha</button>
      <button class="chip ${est === 'bola' ? 'on' : ''}" data-action="estrategia" data-v="bola">⛄ Bola de nieve</button>
    </div>
    <p class="small muted" style="margin-top:-4px">${est === 'avalancha'
      ? '<b>Avalancha:</b> primero la tasa más alta. Matemáticamente es la que menos intereses paga.'
      : '<b>Bola de nieve:</b> primero el saldo más pequeño. Liquidas cuentas rápido y te motiva a seguir.'}</p>
    <label class="campo">¿Cuánto puedes destinar al mes a tus deudas?
      <input type="number" inputmode="decimal" min="0" step="100" id="presupuesto" value="${presupuesto}">
      <span class="hint">Equivale a <b>${fmt(presupuesto / 2)} por quincena</b>. Mínimo necesario: ${fmt(sumMin)} al mes. Cada peso extra reduce intereses y tiempo.</span>
    </label>
    ${cuerpo}
  </section>`;
}

function tarjetaDeuda(d) {
  const s = saldoDeuda(d);
  const i = interesMensual(d);
  const pago = proximaFecha(d.diaPago);
  const corte = proximaFecha(d.diaCorte);
  const uso = d.limite > 0 ? s / d.limite : null;
  const cls = d.tipo === 'dep' ? 'dep' : d.tipo === 'tc' ? 'tc' : '';
  const ultimos = [...d.hist].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 3);
  return `<section class="card">
    <div class="deuda-top">
      <div><h3>${esc(d.nombre)}</h3><span class="badge ${cls}">${TIPOS_DEUDA[d.tipo]}</span></div>
      <div style="text-align:right"><div class="deuda-saldo">${fmt(s)}</div><span class="small muted">saldo actual</span></div>
    </div>
    ${uso != null ? `<div class="bar" style="margin-top:10px"><span style="width:${Math.min(100, uso * 100)}%;background:${uso > 0.3 ? 'var(--deuda)' : 'var(--accent)'}"></span></div>
      <div class="small muted" style="margin-top:3px">Uso de línea: ${pct(uso)} de ${fmt(d.limite)}</div>` : ''}
    <div class="datos">
      <div>Tasa anual<b>${d.tasa}%</b></div>
      <div>Pago mínimo<b>${fmt(d.minimo)}</b></div>
      <div>Interés / mes<b class="${d.minimo <= i ? 'c-deuda' : ''}">${fmt(i)}</b></div>
      ${corte ? `<div>Corte<b>${corte.fecha.getDate()} ${MESES[corte.fecha.getMonth()]}</b></div>` : ''}
      ${pago ? `<div>Pagar antes de<b style="${pago.dias <= 5 ? 'color:var(--deuda)' : ''}">${pago.fecha.getDate()} ${MESES[pago.fecha.getMonth()]}</b></div><div>Faltan<b>${pago.dias} día${pago.dias === 1 ? '' : 's'}</b></div>` : ''}
    </div>
    ${d.minimo <= i ? `<div class="tip bad"><span class="ic">⛔</span><div>El mínimo no cubre los intereses: esta deuda crece cada mes.</div></div>` : ''}
    ${ultimos.length ? `<ul class="lista small" style="margin-top:8px">${ultimos.map(h => `<li><span>${h.tipo === 'pago' ? '✅' : '🛍️'}</span><div class="info">${h.tipo === 'pago' ? 'Pago' : h.tipo === 'interes' ? 'Intereses / comisiones' : 'Cargo'} · <span class="muted">${fechaCorta(h.fecha)}</span></div><span class="monto ${h.tipo === 'pago' ? 'c-ingreso' : 'c-deuda'}">${h.tipo === 'pago' ? '−' : '+'}${fmt(h.monto)}</span></li>`).join('')}</ul>` : ''}
    <div class="acciones">
      <button class="btn mini" data-action="pagar-deuda" data-id="${d.id}">Registrar pago</button>
      <button class="btn mini sec" data-action="cargo-deuda" data-id="${d.id}">+ Cargo / intereses</button>
      <button class="btn mini sec" data-action="editar-deuda" data-id="${d.id}">Editar</button>
      <button class="btn mini sec" data-action="borrar-deuda" data-id="${d.id}">Eliminar</button>
    </div>
  </section>`;
}

/* ---------- Diálogos y formularios ---------- */
function dialogo(titulo, html, onOk, textoOk = 'Guardar') {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = titulo;
  $('#dlg-body').innerHTML = html;
  $('#dlg-ok').textContent = textoOk;
  $('[data-action=cerrar-dlg]').hidden = false;
  $('#dlg-form').onsubmit = e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target));
    if (onOk(datos) === false) return;
    dlg.close(); guardar(); render();
  };
  dlg.showModal();
  const primero = $('#dlg-body input:not([type=radio]):not([type=hidden])');
  if (primero && matchMedia('(pointer:fine)').matches) primero.focus();
}
const campo = (lbl, attrs, hint = '') => `<label class="campo">${lbl}<input ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
const opciones = (lista, sel) => lista.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

function formMov(mov) {
  const m = mov || { tipo: 'gasto', monto: '', cat: '', fecha: enRango(hoyISO(), rango(per)) ? hoyISO() : rango(per)[0], nota: '' };
  const catsDe = t => t === 'ingreso' ? CATS.ingreso : CATS.gasto.map(c => c[0]).filter(c => c !== 'Pago de deuda');
  dialogo(mov ? 'Editar movimiento' : 'Nuevo movimiento', `
    <div class="segmento">
      <input type="radio" name="tipo" id="t-g" value="gasto" ${m.tipo === 'gasto' ? 'checked' : ''}><label for="t-g" class="gas">Gasto</label>
      <input type="radio" name="tipo" id="t-i" value="ingreso" ${m.tipo === 'ingreso' ? 'checked' : ''}><label for="t-i" class="ing">Ingreso</label>
    </div>
    ${campo('Monto', `name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${m.monto}" placeholder="0.00"`)}
    <label class="campo">Categoría<select name="cat" id="sel-cat">${opciones(catsDe(m.tipo), m.cat)}</select></label>
    <div class="grid2">
      ${campo('Fecha', `name="fecha" type="date" required value="${m.fecha}"`)}
      ${campo('Nota (opcional)', `name="nota" maxlength="80" value="${esc(m.nota)}"`)}
    </div>
    <p class="hint">¿Ahorro o pago de tarjeta? Regístralos desde las secciones Ahorro y Deudas.</p>
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const datos = { tipo: d.tipo, monto, cat: d.cat, fecha: d.fecha, nota: d.nota.trim() };
    if (mov) Object.assign(mov, datos); else S.movs.push({ id: uid(), ...datos });
    per = periodoDe(d.fecha);
    toast(mov ? 'Movimiento actualizado' : (d.tipo === 'ingreso' ? '💰 Ingreso registrado' : '🧾 Gasto registrado'));
  });
  $$('#dlg-body input[name=tipo]').forEach(r => r.onchange = () => { $('#sel-cat').innerHTML = opciones(catsDe(r.value)); });
}

// occ: la fecha concreta desde la que se abrió (para "Quitar solo esta vez")
function formFijo(fijo, occ) {
  const f = fijo ? { ...fijo } : { tipo: 'gasto', nombre: '', monto: '', cat: 'Vivienda', cuando: 'mensual', dia: '', diaSemana: 6 };
  if (f.cuando === 'q1' || f.cuando === 'q2') { f.dia = diaMensual(f); f.cuando = 'mensual'; } // formato anterior
  const semanal = f.cuando === 'semanal', mensual = f.cuando === 'mensual';
  const puedeOmitir = fijo && occ && !occ.pagado;
  const catsGasto = CATS.gasto.map(c => c[0]).filter(c => c !== 'Pago de deuda');
  dialogo(fijo ? 'Editar fijo' : 'Nuevo gasto o ingreso fijo', `
    <div class="segmento">
      <input type="radio" name="tipo" id="f-g" value="gasto" ${f.tipo === 'gasto' ? 'checked' : ''}><label for="f-g" class="gas">Gasto fijo</label>
      <input type="radio" name="tipo" id="f-i" value="ingreso" ${f.tipo === 'ingreso' ? 'checked' : ''}><label for="f-i" class="ing">Ingreso fijo</label>
    </div>
    ${campo('Nombre', `name="nombre" required maxlength="40" value="${esc(f.nombre)}" placeholder="Ej. Renta, súper, gasolina, sueldo…"`)}
    <label class="campo">¿Cada cuándo?<select name="cuando">
      <option value="mensual" ${mensual ? 'selected' : ''}>Una vez al mes</option>
      <option value="cada" ${f.cuando === 'cada' ? 'selected' : ''}>Cada quincena (2 veces al mes)</option>
      <option value="semanal" ${semanal ? 'selected' : ''}>Cada semana</option>
    </select></label>
    <div class="grid2">
      ${campo('Monto', `name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${f.monto}"`, 'Si varía, pon un aproximado')}
      <div id="campo-dia" ${mensual ? '' : 'hidden'}>${campo('Día del mes', `name="dia" type="number" min="1" max="31" value="${f.dia || ''}" ${mensual ? 'required' : ''}`, 'Define en qué quincena cae')}</div>
      <label class="campo" id="campo-dsem" ${semanal ? '' : 'hidden'}>Día de la semana<select name="diaSemana">${DIAS.map((n, i) => `<option value="${i}" ${+f.diaSemana === i ? 'selected' : ''}>${n[0].toUpperCase() + n.slice(1)}</option>`).join('')}</select></label>
    </div>
    <p class="hint" id="hint-sem" ${semanal ? '' : 'hidden'} style="margin:-4px 0 12px">Cada quincena trae 2 o 3 veces ese día; la app las pone todas en la lista.</p>
    <label class="campo" id="campo-cat" ${f.tipo === 'ingreso' ? 'hidden' : ''}>Categoría<select name="cat">${opciones(catsGasto, f.cat)}</select></label>
    ${fijo ? `<div class="acciones">
      ${puedeOmitir ? `<button type="button" class="btn mini sec" data-action="omitir-fijo" data-id="${fijo.id}" data-clave="${occ.clave}">Quitar solo esta vez (${occ.etiqueta})</button>` : ''}
      <button type="button" class="btn mini peligro" data-action="borrar-fijo" data-id="${fijo.id}">Eliminar para siempre</button>
    </div>` : ''}
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const cuando = d.cuando;
    const dia = cuando === 'mensual' ? parseInt(d.dia) || null : null;
    if (cuando === 'mensual' && !dia) return toast('Indica el día del mes'), false;
    const datos = { tipo: d.tipo, nombre: d.nombre.trim(), monto, cat: d.tipo === 'ingreso' ? 'Sueldo' : d.cat, cuando, dia, diaSemana: cuando === 'semanal' ? +d.diaSemana : null };
    if (fijo) Object.assign(fijo, datos); else S.fijos.push({ id: uid(), ...datos, omitidos: [] });
    toast('📌 Fijo guardado');
  });
  $$('#dlg-body input[name=tipo]').forEach(r => r.onchange = () => { $('#campo-cat').hidden = r.value === 'ingreso'; });
  const sel = $('#dlg-body select[name=cuando]'), dia = $('#dlg-body input[name=dia]');
  sel.onchange = () => {
    const v = sel.value;
    $('#campo-dia').hidden = v !== 'mensual'; dia.required = v === 'mensual';
    $('#campo-dsem').hidden = v !== 'semanal'; $('#hint-sem').hidden = v !== 'semanal';
  };
}

function marcarFijo(f, q, fecha) {
  const mov = { id: uid(), tipo: f.tipo, monto: f.monto, cat: f.tipo === 'ingreso' ? (f.cat || 'Sueldo') : f.cat, fecha: fecha || fechaFijo(f, rango(q)), nota: f.nombre, fijoId: f.id };
  if (fecha) mov.ocurrencia = fecha; // semanal: identifica qué semana se pagó
  S.movs.push(mov);
}

function formMeta(meta, sugerida) {
  const m = meta || sugerida || { nombre: '', objetivo: '', inicial: 0, fechaMeta: '' };
  dialogo(meta ? 'Editar meta' : 'Nueva meta de ahorro', `
    ${campo('Nombre', `name="nombre" required maxlength="40" value="${esc(m.nombre)}" placeholder="Ej. Fondo de emergencia, vacaciones…"`)}
    ${campo('Monto objetivo', `name="objetivo" type="number" inputmode="decimal" min="1" step="0.01" required value="${m.objetivo}"`, sugerida?.hint || '')}
    <div class="grid2">
      ${campo('Ya tengo ahorrado', `name="inicial" type="number" inputmode="decimal" min="0" step="0.01" value="${m.inicial}"`)}
      ${campo('Fecha objetivo (opcional)', `name="fechaMeta" type="month" value="${m.fechaMeta || ''}"`)}
    </div>
    ${meta ? `<button type="button" class="btn mini peligro" data-action="borrar-meta" data-id="${meta.id}">Eliminar meta</button>` : ''}
  `, d => {
    const datos = { nombre: d.nombre.trim(), objetivo: num(d.objetivo), inicial: num(d.inicial), fechaMeta: d.fechaMeta };
    if (meta) Object.assign(meta, datos); else S.metas.push({ id: uid(), ...datos });
    toast('🐷 Meta guardada');
  });
}

function formAporte(meta, retiro) {
  const disponible = acumuladoMeta(meta);
  dialogo(retiro ? `Retirar de ${meta.nombre}` : `Aportar a ${meta.nombre}`, `
    ${campo('Monto', `name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" ${retiro ? `max="${disponible.toFixed(2)}"` : ''} required`, retiro ? `Disponible: ${fmt(disponible)}` : '')}
    ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
    ${retiro ? campo('Motivo', 'name="nota" maxlength="80" placeholder="Ej. reparación del auto"') : '<input type="hidden" name="nota" value="">'}
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    S.movs.push({ id: uid(), tipo: 'ahorro', monto: retiro ? -monto : monto, cat: meta.nombre, metaId: meta.id, fecha: d.fecha, nota: d.nota || (retiro ? 'Retiro' : 'Aportación') });
    toast(retiro ? 'Retiro registrado' : '🐷 ¡Bien! Aportación registrada');
  }, retiro ? 'Retirar' : 'Aportar');
}

function formDeuda(deuda) {
  const d = deuda ? { ...deuda, saldo: saldoDeuda(deuda) } : { nombre: '', tipo: 'tc', saldo: '', tasa: '', minimo: '', limite: '', diaCorte: '', diaPago: '' };
  dialogo(deuda ? 'Editar deuda' : 'Nueva deuda', `
    ${campo('Nombre', `name="nombre" required maxlength="40" value="${esc(d.nombre)}" placeholder="Ej. Tarjeta BBVA, Liverpool, Coppel…"`)}
    <label class="campo">Tipo<select name="tipo">${Object.entries(TIPOS_DEUDA).map(([k, v]) => `<option value="${k}" ${k === d.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="grid2">
      ${campo('Saldo actual', `name="saldo" type="number" inputmode="decimal" min="0" step="0.01" required value="${d.saldo}"`)}
      ${campo('Tasa anual %', `name="tasa" type="number" inputmode="decimal" min="0" max="300" step="0.01" required value="${d.tasa}"`, 'Viene en tu estado de cuenta')}
      ${campo('Pago mínimo', `name="minimo" type="number" inputmode="decimal" min="0" step="0.01" required value="${d.minimo}"`)}
      ${campo('Límite de crédito', `name="limite" type="number" inputmode="decimal" min="0" step="0.01" value="${d.limite}"`, 'Opcional')}
      ${campo('Día de corte', `name="diaCorte" type="number" min="1" max="31" value="${d.diaCorte}"`)}
      ${campo('Día límite de pago', `name="diaPago" type="number" min="1" max="31" value="${d.diaPago}"`)}
    </div>
    <p class="hint">Tip: usa la "tasa de interés ordinaria anual", no el CAT. El CAT incluye comisiones y sirve para comparar productos.</p>
  `, f => {
    const datos = { nombre: f.nombre.trim(), tipo: f.tipo, tasa: num(f.tasa), minimo: num(f.minimo), limite: num(f.limite), diaCorte: parseInt(f.diaCorte) || null, diaPago: parseInt(f.diaPago) || null };
    const saldo = num(f.saldo);
    if (deuda) {
      Object.assign(deuda, datos);
      const neto = deuda.hist.reduce((a, h) => a + (h.tipo === 'pago' ? -h.monto : h.monto), 0);
      deuda.saldoInicial = saldo - neto;
    } else S.deudas.push({ id: uid(), ...datos, saldoInicial: saldo, hist: [] });
    toast('💳 Deuda guardada');
  });
}

function formPago(d) {
  const s = saldoDeuda(d);
  dialogo(`Pago a ${d.nombre}`, `
    ${campo('Monto pagado', `name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${Math.min(d.minimo, s).toFixed(2)}"`, `Saldo: ${fmt(s)} · Mínimo: ${fmt(d.minimo)}`)}
    <div class="acciones" style="margin:-4px 0 12px">
      <button type="button" class="chip" data-fill="${Math.min(d.minimo, s).toFixed(2)}">Mínimo</button>
      <button type="button" class="chip" data-fill="${s.toFixed(2)}">Liquidar todo</button>
    </div>
    ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
    <label class="check"><input type="checkbox" name="comoGasto" checked> Registrarlo también como gasto de la quincena</label>
  `, f => {
    const monto = num(f.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const h = { id: uid(), fecha: f.fecha, tipo: 'pago', monto };
    d.hist.push(h);
    if (f.comoGasto) S.movs.push({ id: uid(), tipo: 'gasto', monto, cat: 'Pago de deuda', fecha: f.fecha, nota: d.nombre, deudaId: d.id, histId: h.id });
    toast(saldoDeuda(d) <= 0.5 ? `🎉 ¡Liquidaste ${d.nombre}!` : '✅ Pago registrado');
  }, 'Registrar pago');
  $$('#dlg-body [data-fill]').forEach(b => b.onclick = () => { $('#dlg-body input[name=monto]').value = b.dataset.fill; });
}

function formCargo(d) {
  dialogo(`Cargo a ${d.nombre}`, `
    <label class="campo">Tipo<select name="tipo"><option value="cargo">Compra / cargo nuevo</option><option value="interes">Intereses o comisiones del estado de cuenta</option></select></label>
    ${campo('Monto', 'name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required')}
    ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
    <p class="hint">Consejo: mientras estés liquidando esta deuda, evita nuevas compras con ella.</p>
  `, f => {
    const monto = num(f.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    d.hist.push({ id: uid(), fecha: f.fecha, tipo: f.tipo, monto });
    toast('Cargo registrado');
  });
}

function confirmar(titulo, texto, onOk, textoOk = 'Eliminar') {
  dialogo(titulo, `<p>${texto}</p>`, () => { onOk(); }, textoOk);
}

/* ---------- Respaldos ---------- */
async function pintarRespaldos() {
  const ul = $('#lista-respaldos');
  if (!ul) return;
  const lista = (await DB.respaldos()).sort((a, b) => b.fecha.localeCompare(a.fecha));
  ul.innerHTML = lista.length ? lista.map(r => {
    const f = new Date(r.fecha);
    return `<li><span>${r.auto ? '🔄' : '📌'}</span>
      <div class="info"><b>${fechaCorta(r.fecha.slice(0, 10))} · ${f.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</b>
      <span class="muted small">${r.auto ? 'Automático' : esc(r.nota || 'Manual')} · ${r.datos.movs.length} movs, ${r.datos.deudas.length} deudas</span></div>
      <button class="btn mini sec" data-action="restaurar" data-id="${r.id}">Restaurar</button>
      ${r.auto ? '' : `<button class="link-btn" data-action="borrar-respaldo" data-id="${r.id}" aria-label="Eliminar">🗑️</button>`}</li>`;
  }).join('') : '<li class="muted small">Aún no hay puntos de restauración.</li>';
}

async function puntoRestauracion(nota) {
  await DB.guardarRespaldo({ id: uid(), fecha: new Date().toISOString(), auto: false, nota, datos: structuredClone(S) });
  // Conserva solo los 10 manuales más recientes
  const man = (await DB.respaldos()).filter(r => !r.auto).sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const r of man.slice(10)) await DB.borrarRespaldo(r.id);
}

async function exportar() {
  const nombre = `mis-finanzas-respaldo-${hoyISO()}.json`;
  S.ajustes.ultimoExport = new Date().toISOString();
  const blob = new Blob([JSON.stringify({ app: 'mis-finanzas', exportado: S.ajustes.ultimoExport, datos: S }, null, 1)], { type: 'application/json' });
  try {
    // Donde se soporte, permite elegir la carpeta del dispositivo
    if (window.showSaveFilePicker) {
      const h = await showSaveFilePicker({ suggestedName: nombre, types: [{ description: 'Respaldo JSON', accept: { 'application/json': ['.json'] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    guardar(); render();
    toast('💾 Respaldo guardado en tu dispositivo');
  } catch (e) {
    if (e.name !== 'AbortError') toast('No se pudo exportar: ' + e.message);
    S.ajustes.ultimoExport = null;
  }
}

function validarDatos(d) {
  if (d && !Array.isArray(d.fijos)) d.fijos = [];
  return d && Array.isArray(d.movs) && Array.isArray(d.metas) && Array.isArray(d.deudas) && typeof d.ajustes === 'object';
}
async function aplicarDatos(d, msg) {
  await puntoRestauracion('Antes de restaurar');
  S = { ...estadoVacio(), ...structuredClone(d), ajustes: { ...estadoVacio().ajustes, ...d.ajustes } };
  await DB.escribir(S);
  render(); pintarRespaldos();
  toast(msg);
}

/* ---------- Eventos ---------- */
const buscarId = (arr, id) => arr.find(x => x.id === id);
const ACCIONES = {
  'nuevo-mov': () => formMov(),
  'editar-mov': el => formMov(buscarId(S.movs, el.dataset.id)),
  'borrar-mov': el => {
    const m = buscarId(S.movs, el.dataset.id);
    confirmar('Eliminar movimiento', `¿Eliminar <b>${esc(m.cat)}</b> por ${fmt(Math.abs(m.monto))}?${m.histId ? '<br><span class="small muted">También se quitará el pago del historial de la deuda.</span>' : ''}`, () => {
      if (m.deudaId) { const d = buscarId(S.deudas, m.deudaId); if (d) d.hist = d.hist.filter(h => h.id !== m.histId); }
      S.movs = S.movs.filter(x => x !== m);
    });
  },
  filtro: el => { filtroMov = el.dataset.v; render(); },
  'mes-prev': () => cambiarMes(-1),
  'mes-next': () => cambiarMes(1),
  'buscar-actualizacion': buscarActualizacion,
  'ver-novedades': () => mostrarNovedades(null),
  'actualizar-ya': () => location.reload(),
  'per-hoy': () => { per = periodoDe(hoyISO()); render(); },
  'nuevo-fijo': () => formFijo(),
  'editar-fijo': el => {
    const { clave, etiqueta, pagado } = el.dataset;
    formFijo(buscarId(S.fijos, el.dataset.id), clave ? { clave, etiqueta, pagado: pagado === '1' } : null);
  },
  'omitir-fijo': el => {
    const f = buscarId(S.fijos, el.dataset.id);
    (f.omitidos ||= []).push(el.dataset.clave);
    $('#dlg').close(); guardar(); render();
    toast(`${f.nombre}: quitado solo de esta fecha`);
  },
  'borrar-fijo': el => {
    const f = buscarId(S.fijos, el.dataset.id);
    $('#dlg').close();
    confirmar('Eliminar fijo', `¿Eliminar <b>${esc(f.nombre)}</b> de <b>todas</b> las quincenas? Los pagos que ya registraste se conservan.<br><span class="small muted">Si solo quieres quitarlo una vez, usa "Quitar solo esta vez".</span>`, () => {
      S.fijos = S.fijos.filter(x => x !== f);
      S.movs.forEach(m => { if (m.fijoId === f.id) delete m.fijoId; });
    });
  },
  'marcar-fijo': el => {
    const f = buscarId(S.fijos, el.dataset.id);
    const r = rango(el.dataset.q), fecha = el.dataset.fecha;
    const mov = S.movs.find(x => x.fijoId === f.id && (fecha ? x.ocurrencia === fecha : !x.ocurrencia && enRango(x.fecha, r)));
    if (mov) { S.movs = S.movs.filter(x => x !== mov); toast('Desmarcado'); }
    else { marcarFijo(f, el.dataset.q, fecha); toast(f.tipo === 'ingreso' ? `💰 ${f.nombre} recibido` : `✅ ${f.nombre} pagado`); }
    guardar(); render();
  },
  'marcar-todos': () => {
    let n = 0;
    for (const b of compromisos(per)) for (const { f, fecha, mov } of b.fijos) if (!mov) { marcarFijo(f, b.q, fecha); n++; }
    guardar(); render(); toast(`✅ ${n} fijos registrados`);
  },
  modo: el => { S.ajustes.modo = el.dataset.v; per = periodoDe(hoyISO()); guardar(); render(); pintarRespaldos(); },
  'nueva-meta': () => formMeta(),
  'meta-emergencia': () => {
    const g = promedioGastoMensual();
    formMeta(null, { nombre: 'Fondo de emergencia', objetivo: g ? Math.round(g * 3) : '', inicial: 0, hint: g ? `Sugerido: 3 meses de gastos (${fmt(g * 3)}). Ideal: 6 meses (${fmt(g * 6)}).` : 'Sugerido: de 3 a 6 meses de tus gastos mensuales.' });
  },
  'editar-meta': el => formMeta(buscarId(S.metas, el.dataset.id)),
  'borrar-meta': el => {
    const m = buscarId(S.metas, el.dataset.id);
    $('#dlg').close();
    confirmar('Eliminar meta', `¿Eliminar <b>${esc(m.nombre)}</b> y sus aportaciones registradas?`, () => {
      S.metas = S.metas.filter(x => x !== m); S.movs = S.movs.filter(x => x.metaId !== m.id);
    });
  },
  aportar: el => formAporte(buscarId(S.metas, el.dataset.id), false),
  retirar: el => formAporte(buscarId(S.metas, el.dataset.id), true),
  'nueva-deuda': () => formDeuda(),
  'editar-deuda': el => formDeuda(buscarId(S.deudas, el.dataset.id)),
  'pagar-deuda': el => formPago(buscarId(S.deudas, el.dataset.id)),
  'cargo-deuda': el => formCargo(buscarId(S.deudas, el.dataset.id)),
  'borrar-deuda': el => {
    const d = buscarId(S.deudas, el.dataset.id);
    confirmar('Eliminar deuda', `¿Eliminar <b>${esc(d.nombre)}</b>? Los pagos ya registrados como gasto se conservan.`, () => {
      S.deudas = S.deudas.filter(x => x !== d);
      S.movs.forEach(m => { if (m.deudaId === d.id) { delete m.deudaId; delete m.histId; } });
    });
  },
  estrategia: el => { S.ajustes.estrategia = el.dataset.v; guardar(); render(); },
  exportar,
  importar: () => $('#archivo').click(),
  'respaldo-manual': async () => { await puntoRestauracion('Manual'); pintarRespaldos(); toast('📌 Punto de restauración creado'); },
  restaurar: async el => {
    const r = (await DB.respaldos()).find(x => x.id === el.dataset.id);
    confirmar('Restaurar respaldo', `Se reemplazarán tus datos actuales por los del <b>${fechaCorta(r.fecha.slice(0, 10))}</b>. Antes se guardará un punto de restauración con lo actual.`, () => {
      setTimeout(() => aplicarDatos(r.datos, '✅ Datos restaurados'));
    }, 'Restaurar');
  },
  'borrar-respaldo': async el => { await DB.borrarRespaldo(el.dataset.id); pintarRespaldos(); },
  'toggle-iva': el => { S.ajustes.iva = el.checked; guardar(); },
  instalar: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); },
  'borrar-todo': () => confirmar('Borrar todo', 'Se eliminarán todos tus movimientos, metas y deudas. Se guardará un punto de restauración por si te arrepientes.', () => {
    setTimeout(async () => { await puntoRestauracion('Antes de borrar todo'); S = estadoVacio(); await DB.escribir(S); render(); pintarRespaldos(); toast('Datos borrados'); });
  }, 'Borrar todo'),
  'cerrar-dlg': () => $('#dlg').close(),
};

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { vista = tab.dataset.tab; render(); window.scrollTo(0, 0); if (vista === 'ajustes') pintarRespaldos(); return; }
  const el = e.target.closest('[data-action]');
  if (el && ACCIONES[el.dataset.action] && el.type !== 'checkbox') { ACCIONES[el.dataset.action](el); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.action === 'toggle-iva') ACCIONES['toggle-iva'](e.target);
  if (e.target.id === 'presupuesto') { S.ajustes.presupuestoDeuda = num(e.target.value); guardar(); render(); }
  if (e.target.id === 'archivo') {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then(txt => {
      const j = JSON.parse(txt);
      const d = j.datos || j;
      if (!validarDatos(d)) throw new Error('formato');
      confirmar('Restaurar desde archivo', `El archivo contiene ${d.movs.length} movimientos, ${d.metas.length} metas y ${d.deudas.length} deudas. Reemplazará tus datos actuales (se guardará un punto de restauración antes).`, () => {
        setTimeout(() => aplicarDatos(d, '✅ Respaldo importado'));
      }, 'Restaurar');
    }).catch(() => toast('⚠️ El archivo no es un respaldo válido'));
  }
});

function cambiarMes(delta) { per = moverPeriodo(per, delta); render(); }

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- PWA ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (vista === 'ajustes') { render(); pintarRespaldos(); } });

async function iniciar() {
  try {
    await DB.abrir();
    const guardado = await DB.leer();
    if (guardado && validarDatos(guardado)) S = { ...estadoVacio(), ...guardado, ajustes: { ...estadoVacio().ajustes, ...guardado.ajustes } };
    per = periodoDe(hoyISO());
    await respaldoAutomatico();
  } catch (e) {
    toast('⚠️ Tu navegador no permite guardar datos (¿modo incógnito?)');
  }
  // Pide al navegador que no borre los datos por falta de espacio
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  render();
  avisarSiSeActualizo();
  registrarSW();
}

/* ---------- Versiones y actualizaciones ---------- */
function htmlNovedades(desde) {
  // desde = versión que tenía antes; null = mostrar todas
  const lista = NOVEDADES.filter(n => !desde || compararVersion(n.v, desde) > 0);
  return lista.map(n => `<h3 style="margin-top:10px">v${n.v} <span class="muted small">· ${fechaCorta(n.fecha)}</span></h3>
    <ul class="small" style="margin:4px 0;padding-left:18px">${n.cambios.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`).join('');
}
const compararVersion = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

function mostrarNovedades(desde) {
  dialogo(desde ? `🎉 Actualizada a la versión ${VERSION}` : `Novedades · tienes la v${VERSION}`,
    `<div style="max-height:55vh;overflow:auto">${htmlNovedades(desde)}</div>`, () => {}, 'Entendido');
  $('[data-action=cerrar-dlg]').hidden = true;
}

// Al abrir: si la versión cambió desde la última vez, muestra qué hay de nuevo
function avisarSiSeActualizo() {
  let anterior = null;
  try { anterior = localStorage.getItem('version-vista'); localStorage.setItem('version-vista', VERSION); } catch { return; }
  // Quien ya usaba la app antes de que existiera este aviso venía de la 1.3.0
  if (!anterior && (S.movs.length || S.fijos.length || S.deudas.length)) anterior = '1.3.0';
  if (anterior && anterior !== VERSION) mostrarNovedades(anterior);
}

let swReg = null;
function registrarSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const teniaControl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    swReg = reg;
    // Revisa si hay versión nueva cada vez que vuelves a la app
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  // Se instaló una versión nueva mientras la app estaba abierta
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (teniaControl) bannerActualizacion(); });
}

function bannerActualizacion(v) {
  if ($('#banner-act')) return;
  const b = document.createElement('div');
  b.id = 'banner-act';
  b.innerHTML = `<span>🔄 Hay una versión nueva${v ? ' (v' + esc(v) + ')' : ''} lista.</span><button class="btn mini" data-action="actualizar-ya">Actualizar</button>`;
  document.body.append(b);
}

async function buscarActualizacion() {
  if (!navigator.onLine) return toast('Sin internet: conéctate para buscar actualizaciones');
  toast('Buscando actualización…');
  try {
    const txt = await (await fetch('version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const remota = (txt.match(/VERSION = '([0-9.]+)'/) || [])[1];
    if (!remota) throw new Error();
    if (compararVersion(remota, VERSION) > 0) {
      await swReg?.update().catch(() => {});
      bannerActualizacion(remota);
      toast(`Hay una versión nueva: v${remota}`);
    } else toast(`✅ Tienes la versión más reciente (v${VERSION})`);
  } catch { toast('No se pudo revisar. Intenta más tarde.'); }
}
iniciar();
