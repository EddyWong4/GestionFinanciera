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
    ['Suscripciones', 'D'], ['Regalos', 'D'], ['Otros gastos', 'D'], ['Intereses y comisiones', 'D'], ['Pago de deuda', 'A'],
  ],
};
const GRUPO = Object.fromEntries(CATS.gasto);
const CATS_GASTO = CATS.gasto.map(c => c[0]).filter(c => c !== 'Pago de deuda');
const TIPOS_CUENTA = { debito: 'Débito / nómina', efectivo: 'Efectivo', ahorro: 'Cuenta de ahorro / inversión' };
const ICON_CUENTA = { debito: '🏦', efectivo: '💵', ahorro: '🏛️' };
const TIPOS_DEUDA = { tc: 'Tarjeta de crédito', dep: 'Tienda departamental', prestamo: 'Préstamo personal / nómina', auto: 'Crédito automotriz', hipoteca: 'Crédito hipotecario', otra: 'Otra' };
// Tarjetas (revolventes) vs. préstamos con pago fijo
const esRevolvente = d => d.tipo === 'tc' || d.tipo === 'dep';
const IVA = 1.16; // En México el IVA se cobra sobre los intereses de tarjetas

/* ---------- Estado ---------- */
const estadoVacio = () => ({
  version: 1,
  // Movimientos: tipo 'ingreso' | 'gasto' (consumo) | 'ahorro' | 'pago' (a una deuda) | 'traspaso' (entre cuentas).
  // Medio: cuentaId (sale/entra de una cuenta) o tarjetaId (gasto con tarjeta de crédito: no toca tus cuentas).
  movs: [],     // {id, tipo, monto, cat, fecha, nota, cuentaId?, tarjetaId?, destinoId?, metaId?, deudaId?, histId?, msiId?, pagoId?, msiCompraId?}
  cuentas: [],  // {id, nombre, tipo:'debito'|'efectivo'|'ahorro', saldoInicial}
  metas: [],    // {id, nombre, objetivo, inicial, fechaMeta?}
  deudas: [],   // {id, nombre, tipo, saldoInicial, tasa, minimo, limite, diaCorte, diaPago, hist:[{id,fecha,tipo,monto}]}
  msi: [],      // compras a meses {id, nombre, tarjetaId?, monto, meses, tasa (0 = MSI), primerMes:'YYYY-MM', diaPago, inicial, pagos:[{id,fecha,mes,monto}]}
  fijos: [],    // {id, tipo:'gasto'|'ingreso', nombre, monto, cat, cuando:'cada'|'q1'|'q2'|'semanal', dia?, diaSemana?}
  presupuestos: {}, // { categoría: tope por quincena }
  personas: [], // préstamos entre personas {id, nombre, sentido:'meDeben'|'debo', monto, fecha, nota}
  historial: {}, // patrimonio neto al cierre de cada mes { 'YYYY-MM': monto }
  historialSalud: {}, // calificación de salud financiera por mes { 'YYYY-MM': 0–100 }
  ajustes: { iva: true, estrategia: 'avalancha', presupuestoDeuda: 0, ultimoExport: null, modo: 'quincena', ultimoMedio: null, cuentasRevisadas: false },
});

// Adapta datos de versiones anteriores al modelo de cuentas
function migrar(st) {
  if (!Array.isArray(st.cuentas)) st.cuentas = [];
  if (!st.cuentas.length) st.cuentas.push({ id: 'principal', nombre: 'Efectivo y débito', tipo: 'debito', saldoInicial: 0 });
  const def = st.cuentas[0].id;
  for (const m of st.movs) {
    // Antes el pago de una deuda se guardaba como gasto: ahora es un pago (no es consumo nuevo)
    if (m.tipo === 'gasto' && m.cat === 'Pago de deuda') m.tipo = 'pago';
    if (!m.cuentaId && !m.tarjetaId && !m.msiCompraId && m.tipo !== 'traspaso') m.cuentaId = def;
  }
  return st;
}
let S = migrar(estadoVacio());
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
  borrarRespaldos() { return this.tx('respaldos', 'readwrite', s => s.clear()); },
  // Claves sueltas (ej. el PIN): fuera del estado para que no viajen en los respaldos
  leerClave(k) { return this.tx('estado', 'readonly', s => s.get(k)); },
  escribirClave(k, v) { return this.tx('estado', 'readwrite', s => s.put(v, k)); },
  borrarClave(k) { return this.tx('estado', 'readwrite', s => s.delete(k)); },
};

const MAX_RESPALDOS = 14;
let timerGuardar;
function guardar() {
  clearTimeout(timerGuardar);
  timerGuardar = setTimeout(async () => {
    try {
      // Foto mensual del patrimonio neto (para ver su evolución en Reportes)
      S.historial[hoyISO().slice(0, 7)] = Math.round(patrimonio().neto);
      const sf = saludFinanciera();
      if (sf) S.historialSalud[hoyISO().slice(0, 7)] = sf.total;
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
// Compras con tarjeta o a meses: son gasto (consumo) pero no sacan dinero de tus cuentas hoy
const esCredito = m => !!(m.tarjetaId || m.msiCompraId);
function totales(p) {
  const t = { ingreso: 0, gasto: 0, conTarjeta: 0, pagos: 0, ahorro: 0, personal: 0, N: 0, D: 0, A: 0, porCat: {} };
  for (const x of movsPer(p)) {
    if (x.tipo === 'ingreso') t.ingreso += x.monto;
    else if (x.tipo === 'personal') t.personal += x.monto; // préstamos entre personas: no son ingreso ni gasto
    else if (x.tipo === 'ahorro') t.ahorro += x.monto;
    else if (x.tipo === 'pago') t.pagos += x.monto;
    else if (x.tipo === 'gasto') {
      t.gasto += x.monto;
      if (esCredito(x)) t.conTarjeta += x.monto;
      t[GRUPO[x.cat] || 'D'] += x.monto;
      t.porCat[x.cat] = (t.porCat[x.cat] || 0) + x.monto;
    }
  }
  // 50/30/20: el bloque "ahorro y deudas" cuenta el ahorro y lo que de verdad bajó tu deuda
  // (lo pagado menos lo que volviste a cargar a tarjetas), para no contar dos veces la misma compra
  t.A = t.ahorro + Math.max(0, t.pagos - t.conTarjeta);
  // Balance del periodo = lo que entró menos lo que salió de tus cuentas
  t.salidas = t.gasto - t.conTarjeta + t.pagos + t.ahorro + Math.max(0, -t.personal);
  t.libre = t.ingreso + Math.max(0, t.personal) - t.salidas;
  return t;
}

/* ---------- Préstamos entre personas ---------- */
const abonadoPersona = p => S.movs.filter(m => m.personaId === p.id && m.abono).reduce((a, m) => a + Math.abs(m.monto), 0);
const pendientePersona = p => Math.max(0, p.monto - abonadoPersona(p));
const totalPersonas = sentido => S.personas.filter(p => p.sentido === sentido).reduce((a, p) => a + pendientePersona(p), 0);

/* ---------- Cuentas y medio de pago ---------- */
const cuentaDefault = () => S.cuentas[0]?.id;
function flujoCuenta(id) {
  let s = 0;
  for (const m of S.movs) {
    if (m.tipo === 'traspaso') { if (m.cuentaId === id) s -= m.monto; if (m.destinoId === id) s += m.monto; continue; }
    if (m.tipo === 'personal') { if (m.cuentaId === id) s += m.monto; continue; } // con signo: + entra, − sale
    if (m.cuentaId === id) s += m.tipo === 'ingreso' ? m.monto : -m.monto; // un retiro de ahorro (negativo) regresa a la cuenta
  }
  return s;
}
const saldoCuenta = c => c.saldoInicial + flujoCuenta(c.id);
const totalCuentas = () => S.cuentas.reduce((a, c) => a + saldoCuenta(c), 0);
const tarjetasCredito = () => S.deudas.filter(d => d.tipo === 'tc' || d.tipo === 'dep');
// Valor de un <select> de medio: 'c:<cuenta>' o 't:<tarjeta>'
const medioValido = v => { if (!v) return false; const [k, id] = v.split(':'); return k === 't' ? S.deudas.some(d => d.id === id) : S.cuentas.some(c => c.id === id); };
const medioDe = m => m.tarjetaId ? 't:' + m.tarjetaId : 'c:' + (m.cuentaId || cuentaDefault());
const medioDefault = (soloCuentas = false) => {
  const u = S.ajustes.ultimoMedio;
  return medioValido(u) && !(soloCuentas && u.startsWith('t:')) ? u : 'c:' + cuentaDefault();
};
function opcionesMedio(sel, conTarjetas = true) {
  const cs = S.cuentas.map(c => `<option value="c:${c.id}" ${sel === 'c:' + c.id ? 'selected' : ''}>${ICON_CUENTA[c.tipo]} ${esc(c.nombre)}</option>`).join('');
  const ts = conTarjetas ? tarjetasCredito().map(d => `<option value="t:${d.id}" ${sel === 't:' + d.id ? 'selected' : ''}>💳 ${esc(d.nombre)} (crédito)</option>`).join('') : '';
  return ts ? `<optgroup label="Mis cuentas">${cs}</optgroup><optgroup label="Tarjetas de crédito">${ts}</optgroup>` : cs;
}
function aplicarMedio(m, v) {
  delete m.cuentaId; delete m.tarjetaId;
  const [k, id] = (medioValido(v) ? v : 'c:' + cuentaDefault()).split(':');
  if (k === 't' && m.tipo === 'gasto') m.tarjetaId = id; else m.cuentaId = k === 'c' ? id : cuentaDefault();
}
function nombreMedio(m) {
  if (m.tarjetaId) return '💳 ' + (S.deudas.find(d => d.id === m.tarjetaId)?.nombre || 'Tarjeta');
  if (m.msiCompraId) return '🛍️ A meses';
  const c = S.cuentas.find(c => c.id === m.cuentaId);
  return c ? `${ICON_CUENTA[c.tipo]} ${c.nombre}` : '';
}
// Un gasto con tarjeta sube el saldo de esa tarjeta: se refleja como cargo ligado al movimiento
function syncCargo(m) {
  for (const d of S.deudas) d.hist = d.hist.filter(h => h.movId !== m.id);
  if (m.tipo === 'gasto' && m.tarjetaId) {
    const d = S.deudas.find(d => d.id === m.tarjetaId);
    if (d) d.hist.push({ id: uid(), fecha: m.fecha, tipo: 'cargo', monto: m.monto, movId: m.id });
  }
}
// Quita un movimiento y todo lo que depende de él (cargo en tarjeta, pago de deuda o mensualidad)
function quitarMov(m) {
  for (const d of S.deudas) d.hist = d.hist.filter(h => h.movId !== m.id && !(m.histId && h.id === m.histId));
  if (m.msiId) { const c = S.msi.find(c => c.id === m.msiId); if (c) c.pagos = c.pagos.filter(p => p.id !== m.pagoId); }
  S.movs = S.movs.filter(x => x !== m);
}
const acumuladoMeta = mt => mt.inicial + S.movs.filter(x => x.metaId === mt.id).reduce((a, x) => a + x.monto, 0);
const saldoDeuda = d => Math.max(0, d.saldoInicial + d.hist.reduce((a, h) => a + (h.tipo === 'pago' ? -h.monto : h.monto), 0));
const factorIVA = () => (S.ajustes.iva ? IVA : 1);
// Los intereses de créditos hipotecarios no pagan IVA; los demás sí
const factorDeuda = d => d.tipo === 'hipoteca' ? 1 : factorIVA();
const interesMensual = d => saldoDeuda(d) * d.tasa / 100 / 12 * factorDeuda(d);
// Préstamo con pago fijo: cuántos pagos faltan y cuánto interés falta (null si el pago no alcanza)
function plazoRestante(d) {
  const s = saldoDeuda(d), r = d.tasa / 100 / 12 * factorDeuda(d), p = d.minimo;
  if (s <= 0.5) return { pagos: 0, intereses: 0 };
  if (p <= 0 || (r > 0 && p <= s * r)) return null;
  const n = r > 0 ? Math.ceil(-Math.log(1 - r * s / p) / Math.log(1 + r)) : Math.ceil(s / p);
  return { pagos: n, intereses: Math.max(0, n * p - s) };
}
const deudasActivas = () => S.deudas.filter(d => saldoDeuda(d) > 0.5);

/* ---------- Compras a meses (MSI o con intereses) ---------- */
const sumarMeses = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const mesesEntre = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1; };
// Mensualidad fija: MSI = monto / meses; con intereses = amortización (tasa mensual + IVA)
function mensualidad(c) {
  if (!c.tasa) return c.monto / c.meses;
  const i = c.tasa / 100 / 12 * factorIVA();
  return c.monto * i / (1 - Math.pow(1 + i, -c.meses));
}
const pagadasMSI = c => Math.min(c.meses, c.inicial + c.pagos.length);
const restantesMSI = c => c.meses - pagadasMSI(c);
const saldoMSI = c => restantesMSI(c) * mensualidad(c); // lo que falta por pagar
const finMSI = c => sumarMeses(c.primerMes, c.meses - 1);
const msiActivas = () => S.msi.filter(c => restantesMSI(c) > 0);
const mensualidadesMes = () => msiActivas().reduce((a, c) => a + mensualidad(c), 0);
// Mensualidad del mes ym: las primeras "inicial" se pagaron antes de registrar la compra
const msiPagadaEn = (c, ym) => mesesEntre(c.primerMes, ym) < c.inicial || c.pagos.some(p => p.mes === ym);
const siguienteMesMSI = c => { for (let k = 0; k < c.meses; k++) { const ym = sumarMeses(c.primerMes, k); if (!msiPagadaEn(c, ym)) return ym; } return null; };
const msiDeTarjeta = d => msiActivas().filter(c => c.tarjetaId === d.id);

function pagarMSI(c, ym, fecha) {
  const p = { id: uid(), fecha, mes: ym, monto: Math.round(mensualidad(c) * 100) / 100 };
  c.pagos.push(p);
  S.movs.push({ id: uid(), tipo: 'pago', monto: p.monto, cat: 'Pago de deuda', fecha, nota: `${c.nombre} (${mesesEntre(c.primerMes, ym) + 1}/${c.meses})`, msiId: c.id, pagoId: p.id, cuentaId: medioDefault(true).slice(2) });
}
function quitarPagoMSI(c, ym) {
  const p = c.pagos.find(x => x.mes === ym);
  if (!p) return;
  c.pagos = c.pagos.filter(x => x !== p);
  S.movs = S.movs.filter(m => m.pagoId !== p.id);
}

function promedioIngresoMensual() {
  const meses = [...new Set(S.movs.map(x => mesDe(x.fecha)))].sort().reverse().slice(0, 3);
  if (!meses.length) return 0;
  return meses.reduce((a, m) => a + totales(m).ingreso, 0) / meses.length;
}

function promedioGastoMensual() {
  // Promedio de gastos (consumo, sin pagos de deuda) de los últimos 3 meses con registros
  const meses = [...new Set(S.movs.map(x => mesDe(x.fecha)))].sort().reverse().slice(0, 3);
  if (!meses.length) return 0;
  return meses.reduce((a, m) => a + totales(m).gasto, 0) / meses.length;
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
    const ym = q.slice(0, 7);
    const meses = S.msi
      .filter(c => { const k = mesesEntre(c.primerMes, ym), dia = Math.min(c.diaPago || 1, ultimoDia); return k >= 0 && k < c.meses && dia >= dIni && dia <= dFin; })
      .map(c => ({ c, ym, pagado: msiPagadaEn(c, ym) }));
    return { q, r, fijos, tarjetas, meses };
  });
}
function pendientes(p) {
  let gasto = 0, ingreso = 0, tarjetas = 0;
  for (const b of compromisos(p)) {
    for (const { f, mov } of b.fijos) if (!mov) f.tipo === 'ingreso' ? ingreso += f.monto : gasto += f.monto;
    for (const { d, pagado } of b.tarjetas) if (!pagado) tarjetas += Math.min(d.minimo, saldoDeuda(d));
    for (const { c, pagado } of b.meses) if (!pagado) tarjetas += mensualidad(c);
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
  const ds = deudasActivas().map(d => ({ id: d.id, nombre: d.nombre, tipo: d.tipo, saldo: saldoDeuda(d), tasa: d.tasa, min: d.minimo, f: factorDeuda(d), interes: 0, mes: null }));
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
    for (const d of activas) { const i = d.saldo * d.tasa / 100 / 12 * d.f; d.saldo += i; d.interes += i; interes += i; }
    let disp = presupuesto;
    // Primer mes: se guarda cuánto va a cada deuda (mínimo + extra) para decir "este mes paga así"
    if (mesN === 1) for (const d of activas) { d.pago1 = 0; d.min1 = 0; }
    for (const d of activas) { const p = Math.min(d.min, d.saldo, disp); d.saldo -= p; disp -= p; if (mesN === 1) { d.pago1 += p; d.min1 = p; } }
    for (const d of activas.sort(ordenar)) { if (disp <= 0) break; const p = Math.min(disp, d.saldo); d.saldo -= p; disp -= p; if (mesN === 1) d.pago1 += p; }
    for (const d of ds) if (d.saldo <= 0.005 && d.mes == null) d.mes = mesN;
  }
  return { meses: mesN, interes, sinFin: mesN >= 600, orden: ds.sort((a, b) => (a.mes ?? 1e9) - (b.mes ?? 1e9)), sumMin };
}

// Cuánto hay que pagar al mes para quedar sin deudas en "meses" (búsqueda binaria sobre la simulación)
function presupuestoPara(meses, estrategia) {
  const act = deudasActivas();
  if (!act.length) return 0;
  let lo = act.reduce((a, d) => a + Math.min(d.minimo, saldoDeuda(d)), 0);
  let hi = lo + act.reduce((a, d) => a + saldoDeuda(d), 0) * 1.5;
  const alcanza = p => { const r = simular(p, estrategia); return !r.error && !r.sinFin && r.meses <= meses; };
  if (alcanza(lo)) return Math.ceil(lo);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (alcanza(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi / 50) * 50; // redondeado a $50 hacia arriba
}

// Escenario de pagar SOLO el mínimo fijo en cada deuda, sin rodar pagos
function simularSoloMinimos() {
  let maxMes = 0, interes = 0, sinFin = false;
  for (const d of deudasActivas()) {
    let s = saldoDeuda(d), m = 0;
    const f = factorDeuda(d);
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
    // Sin contar lo que prestaste (eso regresa): ¿salió más de lo que entró?
    const deficit = -(t.libre - Math.min(0, t.personal));
    // Si el faltante se debe a abonos a deudas, no es mala señal: pagaste deuda con dinero que ya tenías
    if (deficit > 0 && t.pagos >= deficit) add('ok', '💪', `Abonaste ${fmt(t.pagos)} a tus deudas ${palabraPeriodo()}; ${fmt(deficit)} salieron de dinero que ya tenías. Bien, siempre que conserves un colchón para emergencias.`);
    else if (deficit > 0) add('bad', '🚨', `Salió ${fmt(deficit)} más de lo que ingresó ${palabraPeriodo()}. Revisa si estás financiando el día a día con tarjeta o con tus ahorros.`);
  }
  // Presupuesto: las categorías más comprometidas primero
  const pres = estadoPresupuesto(t).filter(f => f.tope && f.uso >= 0.8);
  for (const f of pres.slice(0, 3)) {
    if (f.uso > 1) add('bad', '📊', `Te pasaste del presupuesto de <b>${esc(f.cat)}</b> por ${fmt(f.gastado - f.tope)} (${pct(f.uso)}). Compénsalo recortando otra categoría de "deseos".`);
    else add('warn', '📊', `Ya usaste el ${pct(f.uso)} del presupuesto de <b>${esc(f.cat)}</b>: te quedan ${fmt(f.tope - f.gastado)} para ${palabraPeriodo()}.`);
  }
  if (!hayPresupuesto() && S.movs.filter(m => m.tipo === 'gasto').length >= 10) add('info', '📊', 'Ya tienes suficientes gastos registrados: pon un <b>presupuesto por categoría</b> (botón en "Gastos por categoría"). La app te lo puede sugerir con tu historial.');
  // Préstamos entre personas
  for (const p of S.personas.filter(p => pendientePersona(p) > 0.5)) {
    const dias = Math.round((Date.now() - new Date(p.fecha + 'T12:00')) / 864e5);
    if (p.sentido === 'meDeben' && dias > 30) add('info', '🤝', `<b>${esc(p.nombre)}</b> te debe ${fmt(pendientePersona(p))} desde hace ${dias} días. Acuerda una fecha de pago; no cuentes con ese dinero para tus gastos.`);
    if (p.sentido === 'debo') add('info', '🤝', `Debes ${fmt(pendientePersona(p))} a <b>${esc(p.nombre)}</b>. Aunque no cobre intereses, ponle fecha y abona cada quincena: cuida tu palabra y la relación.`);
  }
  // Gastos del año que ya se acercan sin estar cubiertos
  for (const m of previsiones()) {
    const qs = quincenasHasta(m.fechaMeta), falta = faltaPrevision(m);
    if (falta > 0 && qs <= 4) add(qs <= 2 ? 'bad' : 'warn', '📅', `<b>${esc(m.nombre)}</b> se paga en ${nombrePeriodo(m.fechaMeta)} y te faltan ${fmt(falta)}: aparta ${fmt(falta / qs)} por quincena.`);
  }
  // Aguinaldo: plan de uso en noviembre/diciembre o cuando se registra
  const mesHoy = +hoyISO().slice(5, 7);
  const aguinaldo = movsPer(per).filter(m => m.tipo === 'ingreso' && m.cat === 'Aguinaldo / bonos').reduce((a, m) => a + m.monto, 0);
  if (aguinaldo > 0 || mesHoy >= 11) {
    const enero = previsiones().filter(m => quincenasHasta(m.fechaMeta) <= 6).reduce((a, m) => a + faltaPrevision(m), 0);
    const cara = deudasActivas().sort((a, b) => b.tasa - a.tasa)[0];
    const pasos = [
      enero > 0 ? `cubrir lo que falta de tus gastos de inicio de año (${fmt(enero)})` : 'apartar para la cuesta de enero (predial, inscripciones, tenencia)',
      cara ? `abonar a <b>${esc(cara.nombre)}</b> (${cara.tasa}% anual, tu deuda más cara)` : 'completar tu fondo de emergencia',
      'y solo lo que sobre, para gustos de fin de año',
    ];
    add('info', '🎁', `${aguinaldo > 0 ? `Recibiste ${fmt(aguinaldo)} de aguinaldo/bonos.` : 'Se acerca el aguinaldo.'} Un buen orden para usarlo: ${pasos.join(', ')}.`);
  }
  const apretada = S.fijos.some(f => f.tipo === 'ingreso') && proyeccion().slice(1).find(f => f.saldo < 0);
  if (apretada) add('bad', '🔮', `Según tu proyección, en la <b>${nombrePeriodo(apretada.q)}</b> te faltarían ${fmt(-apretada.saldo)}. Revisa "Próximas quincenas" y prepárate con tiempo.`);
  for (const c of S.cuentas) if (saldoCuenta(c) < -0.5) add('bad', '🏦', `Tu cuenta <b>${esc(c.nombre)}</b> está en ${fmt(saldoCuenta(c))}. Revisa si falta registrar un ingreso o ajusta su saldo real (✏️ en "Mis cuentas").`);
  if (t.gasto > 0 && t.conTarjeta / t.gasto > 0.5) add('warn', '💳', `Pagaste con tarjeta el ${pct(t.conTarjeta / t.gasto)} de tus gastos de ${palabraPeriodo()} (${fmt(t.conTarjeta)}). Asegúrate de apartar ese dinero para pagar la tarjeta completa y no generar intereses.`);
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
  // Los pagos son mensuales: se comparan contra el ingreso mensual (no el de la quincena)
  const ingMes = promedioIngresoMensual() || (esMes() ? ing : ing * 2);
  const mensMSI = mensualidadesMes();
  if (ingMes > 0 && (totalDeuda > 0 || mensMSI > 0)) {
    const pagoMin = activas.reduce((a, d) => a + d.minimo, 0) + mensMSI;
    const r = pagoMin / ingMes;
    if (r > 0.3) add('bad', '⚖️', `Tus pagos mínimos y mensualidades (${fmt(pagoMin)}/mes) equivalen al ${pct(r)} de tu ingreso. Arriba del 30% es zona de riesgo: no adquieras nuevas deudas.`);
  }
  if (mensMSI > 0) {
    if (ingMes > 0 && mensMSI / ingMes > 0.15) add('warn', '🛍️', `Tus compras a meses te comprometen ${fmt(mensMSI)} al mes (${pct(mensMSI / ingMes)} de tu ingreso). Arriba del 10–15% ya pesa: evita nuevas compras a meses hasta terminar alguna.`);
    if (msiActivas().some(c => c.tarjetaId)) add('info', '🛍️', 'Las mensualidades a meses forman parte del <b>pago para no generar intereses</b> de tu tarjeta. Si un mes pagas menos de ese total, el banco puede cobrarte intereses sobre el saldo.');
    for (const c of msiActivas().filter(c => c.tasa > 0)) {
      const total = mensualidad(c) * c.meses;
      add('info', '💡', `<b>${esc(c.nombre)}</b> a meses con intereses: pagarás ${fmt(total)} por una compra de ${fmt(c.monto)} (${fmt(total - c.monto)} de intereses). Si puedes, adelanta pagos.`);
    }
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
const TITULOS = { resumen: 'Resumen', movs: 'Movimientos', ahorro: 'Ahorro', deudas: 'Deudas', reportes: 'Reportes', ajustes: 'Ajustes' };
function render() {
  $('#titulo').textContent = TITULOS[vista];
  $('#per-lbl').textContent = nombrePeriodo(per);
  $('#per-lbl').classList.toggle('actual', per === periodoDe(hoyISO()));
  $('.mes-nav').style.visibility = (vista === 'resumen' || vista === 'movs') ? 'visible' : 'hidden';
  $('.fab').style.display = vista === 'ajustes' || vista === 'reportes' ? 'none' : '';
  $$('.tabbar button').forEach(b => b.classList.toggle('activo', b.dataset.tab === vista));
  $('#vista').innerHTML = VISTAS[vista]();
  actualizarGlobo();
}

/* ---------- Presupuesto por categoría ---------- */
// Los topes se capturan por quincena; en vista mensual se duplican
const topeCat = cat => (S.presupuestos[cat] || 0) * (esMes() ? 2 : 1);
const hayPresupuesto = () => Object.values(S.presupuestos).some(v => v > 0);
function estadoPresupuesto(t) {
  const cats = new Set([...Object.keys(S.presupuestos).filter(c => S.presupuestos[c] > 0), ...Object.keys(t.porCat)]);
  return [...cats].map(cat => {
    const gastado = t.porCat[cat] || 0, tope = topeCat(cat);
    return { cat, gastado, tope, uso: tope ? gastado / tope : null };
  }).sort((a, b) => (b.uso ?? -1) - (a.uso ?? -1) || b.gastado - a.gastado);
}
// Sugerencia: promedio por quincena de los últimos 3 meses, redondeado a $50
function sugerirPresupuesto() {
  const desde = new Date(); desde.setMonth(desde.getMonth() - 3);
  const lim = desde.toISOString().slice(0, 10), suma = {};
  for (const m of S.movs) if (m.tipo === 'gasto' && m.fecha >= lim) suma[m.cat] = (suma[m.cat] || 0) + m.monto;
  return Object.fromEntries(Object.entries(suma).map(([c, v]) => [c, Math.ceil(v / 6 / 50) * 50]));
}
function htmlPresupuesto(t) {
  const filas = estadoPresupuesto(t);
  const titulo = esMes() ? 'Presupuesto del mes' : 'Presupuesto de la quincena';
  if (!hayPresupuesto()) {
    const max = Math.max(1, ...filas.map(f => f.gastado));
    return `<section class="card">
      <div class="row"><h2 style="margin:0">📊 Gastos por categoría</h2><button class="btn mini" data-action="presupuesto">Poner presupuesto</button></div>
      ${filas.length ? filas.map(f => `<div class="bar-row"><div class="row"><span>${esc(f.cat)}</span><b>${fmt(f.gastado)}</b></div>
        <div class="bar"><span style="width:${f.gastado / max * 100}%;background:var(--gasto)"></span></div></div>`).join('') : '<p class="muted small">Sin gastos registrados en este periodo.</p>'}
      <p class="small muted" style="margin-bottom:0">Ponle un tope a cada categoría por quincena y la app te avisa cuando vayas en 80% o te pases.</p>
    </section>`;
  }
  const totTope = filas.reduce((a, f) => a + f.tope, 0);
  const totGasto = filas.filter(f => f.tope).reduce((a, f) => a + f.gastado, 0);
  const color = u => u == null ? 'var(--muted)' : u > 1 ? 'var(--deuda)' : u >= 0.8 ? 'var(--warn)' : 'var(--ingreso)';
  return `<section class="card">
    <div class="row"><h2 style="margin:0">📊 ${titulo}</h2><button class="btn mini sec" data-action="presupuesto">Editar</button></div>
    ${filas.map(f => `<div class="bar-row">
      <div class="row"><span>${esc(f.cat)}</span><span><b>${fmt(f.gastado)}</b>${f.tope ? ` <span class="meta">de ${fmt(f.tope)}</span>` : ' <span class="meta">sin tope</span>'}</span></div>
      <div class="bar"><span style="width:${f.tope ? Math.min(100, f.uso * 100) : 100}%;background:${color(f.uso)};${f.tope ? '' : 'opacity:.35'}"></span></div>
      ${f.tope ? `<div class="meta" style="color:${f.uso > 1 ? 'var(--deuda)' : 'inherit'}">${f.uso > 1 ? `Te pasaste por ${fmt(f.gastado - f.tope)}` : `Te quedan ${fmt(f.tope - f.gastado)}`}</div>` : ''}
    </div>`).join('')}
    <div class="resumen-fijos"><div class="row"><b>Total con presupuesto</b><b>${fmt(totGasto)} de ${fmt(totTope)}</b></div></div>
  </section>`;
}
function formPresupuesto() {
  const sug = sugerirPresupuesto();
  const hayHist = Object.keys(sug).length > 0;
  dialogo('Presupuesto por quincena', `
    <p class="small muted" style="margin-top:-6px">Cuánto quieres gastar como máximo en cada categoría <b>por quincena</b>. Deja en blanco las que no quieras controlar.</p>
    ${hayHist ? '<button type="button" class="btn mini sec" id="btn-sugerir" style="margin-bottom:10px">✨ Sugerir según mis gastos de los últimos 3 meses</button>' : ''}
    <div class="grid2">${CATS_GASTO.map((c, i) => campo(esc(c), `name="p${i}" type="number" inputmode="decimal" min="0" step="50" value="${S.presupuestos[c] || ''}" placeholder="—"`)).join('')}</div>
    <p class="hint" id="pres-total"></p>
  `, d => {
    S.presupuestos = {};
    CATS_GASTO.forEach((c, i) => { const v = num(d['p' + i]); if (v > 0) S.presupuestos[c] = v; });
    toast('📊 Presupuesto guardado');
  });
  const body = $('#dlg-body');
  const total = () => {
    const tot = CATS_GASTO.reduce((a, _, i) => a + num(body.querySelector(`[name=p${i}]`).value), 0);
    const ingQ = promedioIngresoMensual() / 2;
    $('#pres-total').innerHTML = `Total por quincena: <b>${fmt(tot)}</b>${ingQ ? ` · tu ingreso promedio por quincena: ${fmt(ingQ)} (${pct(tot / ingQ)})` : ''}`;
  };
  body.oninput = total;
  $('#btn-sugerir')?.addEventListener('click', () => {
    CATS_GASTO.forEach((c, i) => { if (sug[c]) body.querySelector(`[name=p${i}]`).value = sug[c]; });
    total();
  });
  total();
}

/* ---------- Salud financiera (0–100) ---------- */
// Interpolación por tramos: tramo(x, [[x0, puntos0], [x1, puntos1], ...])
const tramo = (x, pts) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts.at(-1)[1];
};
const red50 = n => Math.ceil(n / 50) * 50;
// Promedios mensuales: meses completos recientes (si aún no hay, el mes actual) y el ingreso fijo como respaldo
function baseMensual() {
  const act = hoyISO().slice(0, 7);
  let ms = [...new Set(S.movs.map(m => mesDe(m.fecha)))].filter(m => m < act).sort().slice(-3);
  if (!ms.length) ms = [act];
  const tt = ms.map(m => totales(m)), prom = k => tt.reduce((a, t) => a + t[k], 0) / ms.length;
  const porCat = {};
  for (const t of tt) for (const [c, v] of Object.entries(t.porCat)) porCat[c] = (porCat[c] || 0) + v / ms.length;
  const fijoIng = S.fijos.filter(f => f.tipo === 'ingreso').reduce((a, f) => a + f.monto * (f.cuando === 'cada' ? 2 : f.cuando === 'semanal' ? 52 / 12 : 1), 0);
  return { ingreso: Math.max(prom('ingreso'), fijoIng), gasto: prom('gasto'), ahorro: prom('ahorro'), porCat };
}

function saludFinanciera() {
  const b = baseMensual(), ing = b.ingreso;
  if (ing <= 0) return null;
  const gasto = b.gasto, q = n => fmt(n / 2);
  const pil = [];

  // 1. Ahorro
  const tasa = b.ahorro / ing;
  pil.push({ n: 'Ahorro', c: 'Ahorro', ic: '🐷', peso: 20, s: tramo(tasa, [[0, 0], [0.1, 60], [0.2, 100]]),
    dato: `Ahorras ${pct(tasa)} de tu ingreso (meta: 20%)`,
    accion: () => `Aparta <b>${q(red50(Math.max(0, 0.2 * ing - b.ahorro)))}</b> por quincena el mismo día que cobras, antes de gastar ("págate primero").` });

  // 2. Fondo de emergencia
  const em = S.metas.find(m => /emergencia/i.test(m.nombre));
  const fondo = (em ? acumuladoMeta(em) : 0) + S.cuentas.filter(c => c.tipo === 'ahorro').reduce((a, c) => a + Math.max(0, saldoCuenta(c)), 0);
  const mesesFondo = gasto > 0 ? fondo / gasto : (fondo > 0 ? 6 : 0);
  pil.push({ n: 'Fondo de emergencia', c: 'Emergencias', ic: '🛟', peso: 20, s: tramo(mesesFondo, [[0, 0], [1, 35], [3, 75], [6, 100]]),
    dato: `Cubre ${mesesFondo.toFixed(1)} meses de gastos (meta: 3 a 6)`,
    accion: () => {
      const falta = Math.max(0, 3 * gasto - fondo), cuota = Math.max(500, red50(ing * 0.05));
      return `${em ? '' : 'Crea tu <b>Fondo de emergencia</b> en Ahorro. '}Te faltan <b>${fmt(falta)}</b> para 3 meses de gastos: con <b>${fmt(cuota)}</b> por quincena lo juntas en ${Math.max(1, Math.ceil(falta / (cuota * 2)))} meses.`;
    } });

  // 3. Carga de deudas (pagos mensuales obligatorios / ingreso)
  const act = deudasActivas();
  const pagosMes = act.reduce((a, d) => a + Math.min(d.minimo, saldoDeuda(d)), 0) + mensualidadesMes();
  const carga = pagosMes / ing;
  const chica = [...act].sort((x, y) => saldoDeuda(x) - saldoDeuda(y))[0];
  pil.push({ n: 'Carga de deudas', c: 'Pagos', ic: '⚖️', peso: 20, s: tramo(carga, [[0, 100], [0.15, 100], [0.3, 55], [0.5, 0]]),
    dato: `Tus pagos de deuda son ${pct(carga)} de tu ingreso (sano: hasta 15%)`,
    accion: () => `No saques nuevas compras a meses${chica ? ` y liquida primero <b>${esc(chica.nombre)}</b> (debes ${fmt(saldoDeuda(chica))}): eso libera ${fmt(Math.min(chica.minimo, saldoDeuda(chica)))} al mes` : ''}.` });

  // 4. Gasto contra ingreso
  const rel = gasto / ing;
  const deseo = Object.entries(b.porCat).filter(([c]) => GRUPO[c] === 'D').sort((x, y) => y[1] - x[1])[0];
  const recorte = red50(Math.max(0, gasto - 0.7 * ing));
  pil.push({ n: 'Gasto contra ingreso', c: 'Gasto', ic: '🧾', peso: 15, s: tramo(rel, [[0, 100], [0.7, 100], [0.9, 55], [1, 25], [1.2, 0]]),
    dato: `Gastas ${pct(rel)} de lo que ganas (sano: hasta 70%)`,
    accion: () => `Recorta <b>${fmt(recorte)}</b> al mes (${q(recorte)} por quincena)${deseo ? `; empieza por <b>${esc(deseo[0])}</b>, donde se van ${fmt(deseo[1])} al mes` : ''}. Ponle tope en "Presupuesto".` });

  // 5. Deuda cara (tasa ≥ 30%) en meses de ingreso
  const cara = act.filter(d => d.tasa >= 30), saldoCara = cara.reduce((a, d) => a + saldoDeuda(d), 0);
  let sCara = tramo(saldoCara / ing, [[0, 100], [1, 65], [2, 35], [4, 0]]);
  const crece = act.some(d => interesMensual(d) > 0 && d.minimo <= interesMensual(d));
  if (crece) sCara = Math.min(sCara, 15);
  pil.push({ n: 'Deuda cara', c: 'Deuda cara', ic: '🔥', peso: 15, s: sCara,
    dato: saldoCara ? `${fmt(saldoCara)} en deudas con tasa alta${crece ? ' · alguna crece aunque pagues el mínimo' : ''}` : 'Sin deudas de tasa alta',
    accion: () => { const p = presupuestoPara(12, S.ajustes.estrategia); const primera = [...cara].sort((x, y) => y.tasa - x.tasa)[0]; return `Sigue el <b>Plan para liquidar</b>: con <b>${fmt(p)}</b> al mes (${q(p)} por quincena) quedas sin deudas en 1 año${primera ? `. Lo extra, primero a <b>${esc(primera.nombre)}</b>` : ''}.`; } });

  // 6. Uso de crédito (tarjetas con límite)
  const conLim = tarjetasCredito().filter(d => d.limite > 0);
  const usoDe = d => (saldoDeuda(d) + msiDeTarjeta(d).reduce((a, c) => a + saldoMSI(c), 0)) / d.limite;
  const uso = conLim.length ? conLim.reduce((a, d) => a + usoDe(d) * d.limite, 0) / conLim.reduce((a, d) => a + d.limite, 0) : 0;
  const peor = [...conLim].sort((x, y) => usoDe(y) - usoDe(x))[0];
  pil.push({ n: 'Uso de crédito', c: 'Crédito', ic: '💳', peso: 10, s: tramo(uso, [[0, 100], [0.1, 100], [0.3, 75], [0.6, 35], [0.9, 0]]),
    dato: conLim.length ? `Usas ${pct(uso)} de tu línea de crédito (ideal: menos de 30%)` : 'Sin tarjetas con límite registrado',
    accion: () => peor ? `Baja <b>${esc(peor.nombre)}</b> a menos de ${fmt(peor.limite * 0.3)} (abona ${fmt(Math.max(0, usoDe(peor) * peor.limite - peor.limite * 0.3))}) y no la uses mientras. Mejora tu historial en Buró.` : '' });

  const total = Math.round(pil.reduce((a, p) => a + p.peso * p.s / 100, 0));
  const acciones = pil.filter(p => p.s < 90).map(p => ({ ...p, gana: Math.round(p.peso * (100 - p.s) / 100), txt: p.accion() }))
    .filter(a => a.gana > 0 && a.txt).sort((a, b) => b.gana - a.gana);
  return { total, pil, acciones };
}
// Niveles con emoji: la carita grande y el semáforo de cada indicador
const NIVELES = [[80, '😁', 'Excelente', 'var(--ingreso)'], [60, '🙂', 'Buena', 'var(--accent)'], [40, '😐', 'Regular', 'var(--warn)'], [20, '😟', 'En riesgo', 'var(--gasto)'], [0, '😱', 'Crítica', 'var(--deuda)']];
const nivelSalud = n => NIVELES.find(([min]) => n >= min);
const semaforo = s => s >= 80 ? '🟢' : s >= 60 ? '🟡' : s >= 35 ? '🟠' : '🔴';

function htmlSalud() {
  const sf = saludFinanciera();
  if (!sf) return `<section class="card"><h2>🩺 Salud financiera</h2><p class="small muted" style="margin:0">Registra tus ingresos (o da de alta tu sueldo como fijo) para calcular tu salud financiera y recibir consejos para mejorarla.</p></section>`;
  const [, cara, nivel, color] = nivelSalud(sf.total);
  const ant = S.historialSalud[sumarMeses(hoyISO().slice(0, 7), -1)];
  const delta = ant == null ? '' : sf.total === ant ? '➖ Igual que el mes pasado' : `${sf.total > ant ? '📈 Subiste' : '📉 Bajaste'} ${Math.abs(sf.total - ant)} puntos vs. el mes pasado`;
  const top = sf.acciones[0];
  return `<section class="card">
    <h2>🩺 Salud financiera</h2>
    <div class="salud-top">
      <div class="salud-cara">${cara}</div>
      <div><div class="salud-num" style="color:${color}">${sf.total}<span>/100</span></div><b style="color:${color}">${nivel}</b>${delta ? `<div class="small muted">${delta}</div>` : ''}</div>
    </div>
    <div class="salud-escala">${[...NIVELES].reverse().map(([min, e, n]) => `<span class="${nivelSalud(sf.total)[0] === min ? 'on' : ''}" aria-label="${n}">${e}</span>`).join('')}</div>
    <div class="salud-pilares">${sf.pil.map(p => `<span>${semaforo(p.s)} ${p.ic} ${p.c}</span>`).join('')}</div>
    ${top ? `<div class="tip info"><span class="ic">👉</span><div><b>Lo que más te ayuda ahora (+${top.gana} pts):</b> ${top.txt}</div></div>` : '<div class="tip ok"><span class="ic">🏆</span><div>Tus finanzas están en gran forma. Mantén el ritmo e invierte lo que te sobre.</div></div>'}
    <details class="det-plan"><summary>Ver detalle y cómo mejorar</summary>
      ${sf.pil.map(p => `<div class="bar-row">
        <div class="row"><span>${semaforo(p.s)} ${p.ic} ${p.n}</span><span><b>${Math.round(p.peso * p.s / 100)}</b> <span class="meta">/ ${p.peso}</span></span></div>
        <div class="bar"><span style="width:${p.s}%;background:${nivelSalud(p.s)[3]}"></span></div>
        <div class="meta">${p.dato}</div></div>`).join('')}
      <p class="small muted">🟢 bien · 🟡 aceptable · 🟠 hay que mejorar · 🔴 urgente</p>
      ${sf.acciones.length ? `<p class="dia">✅ Plan para subir tu calificación</p><ol class="acciones-salud">${sf.acciones.map(a => `<li>${a.ic} <b>${a.n} (+${a.gana} pts):</b> ${a.txt}</li>`).join('')}</ol>` : ''}
      <p class="small muted">Se calcula con tus promedios mensuales (últimos meses completos), tus cuentas, metas y deudas. Es una guía, no tu calificación de Buró.</p>
    </details>
  </section>`;
}

/* ---------- Proyección de las próximas quincenas ---------- */
// Flujo esperado de una quincena: lo que falta por entrar y salir de tus cuentas
function flujoQuincena(q, esActual) {
  const b = compromisos(q)[0];
  let entra = 0, fijos = 0, deudas = 0;
  const fijosPorCat = {};
  for (const { f, mov } of b.fijos) {
    if (mov) continue; // ya registrado: ya está en el saldo de tus cuentas
    if (f.tipo === 'ingreso') { entra += f.monto; continue; }
    fijosPorCat[f.cat] = (fijosPorCat[f.cat] || 0) + f.monto;
    if (!(f.medio || '').startsWith('t:')) fijos += f.monto; // con tarjeta: se paga después, con la tarjeta
  }
  for (const { d, pagado } of b.tarjetas) if (!pagado) deudas += Math.min(d.minimo, saldoDeuda(d));
  for (const { c, pagado } of b.meses) if (!pagado) deudas += mensualidad(c);
  // Gasto del día a día: lo que queda del presupuesto, o tu promedio si no tienes presupuesto
  const t = esActual ? totales(q) : null;
  let variable = 0;
  if (hayPresupuesto()) {
    for (const [cat, tope] of Object.entries(S.presupuestos)) variable += Math.max(0, tope - (t?.porCat[cat] || 0) - (fijosPorCat[cat] || 0));
  } else {
    const fijosQ = Object.values(fijosPorCat).reduce((a, v) => a + v, 0);
    variable = Math.max(0, promedioGastoMensual() / 2 - (t ? t.gasto : 0) - fijosQ);
  }
  // Lo que toca apartar para los gastos del año (en la quincena actual, descontando lo ya apartado)
  let aparta = 0;
  for (const m of previsiones()) {
    if (q.slice(0, 7) >= m.fechaMeta) continue;
    aparta += esActual ? Math.max(0, cuotaPrevision(m) - apartadoEnQActual(m)) : cuotaPrevision(m);
  }
  return { q, entra, fijos, deudas, variable, aparta, sale: fijos + deudas + variable + aparta };
}
function proyeccion(n = 6) {
  const hoy = hoyISO();
  let q = `${hoy.slice(0, 7)}-${+hoy.slice(8, 10) <= 15 ? 1 : 2}`, saldo = totalCuentas();
  const filas = [];
  for (let i = 0; i < n; i++, q = moverPeriodo(q, 1)) {
    const f = flujoQuincena(q, i === 0);
    saldo += f.entra - f.sale;
    filas.push({ ...f, saldo });
  }
  return filas;
}
function htmlProyeccion() {
  const filas = proyeccion();
  const sinIngresos = !S.fijos.some(f => f.tipo === 'ingreso');
  const apretada = filas.find(f => f.saldo < 0);
  return `<section class="card">
    <h2>🔮 Próximas quincenas</h2>
    <p class="small muted" style="margin-top:-6px">Parte de lo que tienes hoy en tus cuentas (${fmt(totalCuentas())}) y suma tus ingresos fijos; resta fijos, pagos de tarjetas, mensualidades, ${hayPresupuesto() ? 'tu presupuesto' : 'tu gasto promedio'}${previsiones().length ? ' y lo que toca apartar para gastos del año' : ''}.</p>
    ${sinIngresos ? '<div class="tip info"><span class="ic">💡</span><div>Da de alta tu <b>sueldo como ingreso fijo</b> (📌 + Fijo) para que la proyección sea real.</div></div>' : ''}
    ${apretada ? `<div class="tip bad"><span class="ic">⚠️</span><div>En la <b>${nombrePeriodo(apretada.q)}</b> te faltarían <b>${fmt(-apretada.saldo)}</b>. Prepárate desde ahora: aparta dinero o recorta gastos antes de esa fecha.</div></div>` : ''}
    <table class="plan proy">
      <thead><tr><th>Quincena</th><th class="n">Entra</th><th class="n">Sale</th><th class="n">Te queda</th></tr></thead>
      <tbody>${filas.map((f, i) => `<tr>
        <td><b>${nombrePeriodo(f.q, true)}</b>${i === 0 ? ' <span class="muted small">hoy</span>' : ''}</td>
        <td class="n c-ingreso">${fmt(f.entra)}</td>
        <td class="n c-gasto">${fmt(f.sale)}</td>
        <td class="n"><b style="color:${f.saldo < 0 ? 'var(--deuda)' : 'inherit'}">${fmt(f.saldo)}</b></td>
      </tr><tr class="det"><td colspan="4">Fijos ${fmt(f.fijos)} · deudas ${fmt(f.deudas)} · día a día ${fmt(f.variable)}${f.aparta ? ` · apartar ${fmt(f.aparta)}` : ''}</td></tr>`).join('')}</tbody>
    </table>
    <p class="small muted" style="margin-bottom:0">Para tarjetas usa el pago mínimo. Si pagas más (recomendado), te quedará menos, pero bajará más rápido tu deuda.</p>
  </section>`;
}

/* ---------- Gastos del año (previsión): tenencia, seguro, predial, inscripciones… ---------- */
// Son metas con anual:true; fechaMeta = mes en que toca pagar (se recorre un año al pagarlo)
const previsiones = () => S.metas.filter(m => m.anual);
const qActual = () => { const h = hoyISO(); return `${h.slice(0, 7)}-${+h.slice(8, 10) <= 15 ? 1 : 2}`; };
// Quincenas que faltan (incluida la actual) antes de que empiece el mes ym
function quincenasHasta(ym) {
  let n = 0, q = qActual();
  while (q.slice(0, 7) < ym && n < 60) { n++; q = moverPeriodo(q, 1); }
  return Math.max(1, n);
}
const faltaPrevision = m => Math.max(0, m.objetivo - acumuladoMeta(m));
// Lo apartado en la quincena actual cuenta como la cuota de esta quincena (no se reparte de nuevo)
const apartadoEnQActual = m => { const r = rango(qActual()); return S.movs.filter(x => x.metaId === m.id && x.monto > 0 && enRango(x.fecha, r)).reduce((a, x) => a + x.monto, 0); };
const cuotaPrevision = m => faltaPrevision(m) > 0 ? (faltaPrevision(m) + apartadoEnQActual(m)) / quincenasHasta(m.fechaMeta) : 0;
const proximoMes = mes => { const h = hoyISO(), y = +h.slice(0, 4), actual = +h.slice(5, 7); return `${mes >= actual ? y : y + 1}-${String(mes).padStart(2, '0')}`; };
const SUGERIDAS = [['Predial', 1], ['Tenencia / refrendo', 3], ['Seguro del auto', 6], ['Inscripciones y útiles', 8], ['Regalos de diciembre', 12], ['Vacaciones', 7]];

function htmlPrevisiones() {
  const lista = previsiones().sort((a, b) => a.fechaMeta.localeCompare(b.fechaMeta));
  const cuotaTotal = lista.reduce((a, m) => a + cuotaPrevision(m), 0);
  const tarjetas = lista.map(m => {
    const acc = acumuladoMeta(m), p = m.objetivo ? Math.min(1, acc / m.objetivo) : 0;
    const qs = quincenasHasta(m.fechaMeta), listo = acc >= m.objetivo;
    return `<div class="msi">
      <div class="row"><b>${esc(m.nombre)}</b><b>${fmt(m.objetivo)}</b></div>
      <div class="small muted">Se paga en ${nombrePeriodo(m.fechaMeta)} · faltan ${qs} quincena${qs === 1 ? '' : 's'}</div>
      <div class="bar" style="margin:6px 0"><span style="width:${p * 100}%;background:var(--ahorro)"></span></div>
      <div class="row small"><span>Apartado: <b class="c-ahorro">${fmt(acc)}</b></span>${listo ? '<span class="c-ingreso">✅ Completo</span>' : `<span>Aparta <b>${fmt(cuotaPrevision(m))}</b> por quincena</span>`}</div>
      <div class="acciones">
        ${listo ? '' : `<button class="btn mini" data-action="aportar" data-id="${m.id}">+ Apartar</button>`}
        <button class="btn mini sec" data-action="pagar-prevision" data-id="${m.id}">Ya lo pagué</button>
        <button class="btn mini sec" data-action="editar-meta" data-id="${m.id}">Editar</button>
      </div>
    </div>`;
  }).join('');
  const faltantes = SUGERIDAS.filter(([n]) => !lista.some(m => m.nombre === n));
  return `<h2 class="seccion">📅 Gastos del año</h2>
  <section class="card">
    <div class="row"><span class="small muted">Gastos que no son de cada mes: divídelos entre las quincenas que faltan y que no te tomen por sorpresa.</span>
      <button class="btn mini" data-action="nueva-prevision">+ Agregar</button></div>
    ${tarjetas}
    ${lista.length ? `<div class="resumen-fijos"><div class="row"><b>Apartar por quincena</b><b class="c-ahorro">${fmt(cuotaTotal)}</b></div></div>` : ''}
    ${faltantes.length ? `<p class="dia">Ideas</p><div class="chips" style="margin:6px 0 0">${faltantes.map(([n, mes]) => `<button class="chip" data-action="nueva-prevision" data-nombre="${n}" data-mes="${mes}">+ ${n}</button>`).join('')}</div>` : ''}
  </section>`;
}

function formPrevision(meta, sug = {}) {
  const mesDef = +sug.mes || (+hoyISO().slice(5, 7) % 12) + 1; // sugerido, o el mes que entra
  const m = meta || { nombre: sug.nombre || '', objetivo: '', inicial: 0, fechaMeta: proximoMes(mesDef), cat: 'Otros gastos' };
  const mes = +m.fechaMeta.slice(5, 7);
  dialogo(meta ? 'Editar gasto del año' : 'Nuevo gasto del año', `
    ${campo('¿Qué es?', `name="nombre" required maxlength="40" value="${esc(m.nombre)}" placeholder="Ej. Tenencia, seguro del auto, predial…"`)}
    <div class="grid2">
      ${campo('¿Cuánto cuesta?', `name="objetivo" type="number" inputmode="decimal" min="1" step="0.01" required value="${m.objetivo}"`)}
      <label class="campo">¿En qué mes se paga?<select name="mes">${MESES.map((n, i) => `<option value="${i + 1}" ${i + 1 === mes ? 'selected' : ''}>${n[0].toUpperCase() + n.slice(1)}</option>`).join('')}</select></label>
    </div>
    <label class="campo">Categoría del gasto<select name="cat">${opciones(CATS_GASTO, m.cat || 'Otros gastos')}</select></label>
    ${meta ? '' : campo('Ya tengo apartado', 'name="inicial" type="number" inputmode="decimal" min="0" step="0.01" value="0"')}
    <p class="hint">Se repite cada año: al marcarlo como pagado pasa al año siguiente.</p>
    ${meta ? `<button type="button" class="btn mini peligro" data-action="borrar-meta" data-id="${meta.id}">Eliminar</button>` : ''}
  `, d => {
    const datos = { nombre: d.nombre.trim(), objetivo: num(d.objetivo), fechaMeta: proximoMes(+d.mes), cat: d.cat, anual: true };
    if (datos.objetivo <= 0) return toast('Indica cuánto cuesta'), false;
    if (meta) Object.assign(meta, datos); else S.metas.push({ id: uid(), ...datos, inicial: num(d.inicial) });
    toast('📅 Gasto del año guardado');
  });
}

// Pagar un gasto del año: sale del apartado (regresa a la cuenta) y se registra el gasto
function formPagarPrevision(m) {
  const acc = acumuladoMeta(m);
  dialogo(`Pagar ${m.nombre}`, `
    ${campo('Monto pagado', `name="monto" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${m.objetivo}"`, `Tenías apartado ${fmt(acc)}`)}
    <label class="campo">¿Con qué pagaste?<select name="medio">${opcionesMedio(medioDefault(true))}</select></label>
    ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const usado = Math.min(acc, monto);
    const cuenta = d.medio.startsWith('c:') ? d.medio.slice(2) : cuentaDefault();
    if (usado > 0) S.movs.push({ id: uid(), tipo: 'ahorro', monto: -usado, cat: m.nombre, metaId: m.id, fecha: d.fecha, nota: 'Uso del apartado', cuentaId: cuenta });
    const g = { id: uid(), tipo: 'gasto', monto, cat: m.cat || 'Otros gastos', fecha: d.fecha, nota: m.nombre };
    aplicarMedio(g, d.medio); S.movs.push(g); syncCargo(g);
    m.fechaMeta = sumarMeses(m.fechaMeta, 12);
    toast(`✅ ${m.nombre} pagado. Próximo: ${nombrePeriodo(m.fechaMeta)}`);
  }, 'Registrar pago');
}

/* ---------- Próximos pagos (recordatorios dentro de la app) ---------- */
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fechaDelMes(ym, dia) { return `${ym}-${String(Math.min(dia, diasDelMes(ym))).padStart(2, '0')}`; }
// Etiqueta de urgencia para pagos pendientes: "· vence mañana" (en rojo si faltan 2 días o menos)
function venceTexto(fecha, corto = false) {
  const n = Math.round((new Date(fecha + 'T12:00') - new Date(hoyISO() + 'T12:00')) / 864e5);
  if (n < 0 || n > 3) return '';
  const txt = n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`;
  return corto ? ` · ${txt}` : ` · <b style="color:${n <= 2 ? 'var(--deuda)' : 'var(--warn)'}">vence ${txt}</b>`;
}
// excluirActual: omite lo que ya está en "Fijos de la quincena" para no mostrarlo dos veces
function proximosPagos(dias = 7, excluirActual = false) {
  const hoy = hoyISO(), lim = isoLocal(new Date(Date.now() + dias * 864e5));
  const ymHoy = hoy.slice(0, 7), ymSig = sumarMeses(ymHoy, 1);
  const out = [];
  // Lo que cae en el periodo que se está viendo ya aparece en "Fijos de la quincena"
  const rVista = rango(per), yaVisible = f => excluirActual && enRango(hoy, rVista) && enRango(f, rVista);
  const add = (fecha, nombre, monto, extra = {}) => { if (fecha >= hoy && fecha <= lim && (extra.anual || !yaVisible(fecha))) out.push({ fecha, nombre, monto, ...extra }); };
  // Tarjetas y préstamos: pagado si hay un pago en los 25 días previos al vencimiento
  for (const d of deudasActivas().filter(d => d.diaPago)) for (const ym of [ymHoy, ymSig]) {
    const f = fechaDelMes(ym, d.diaPago), desde = isoLocal(new Date(new Date(f + 'T12:00') - 25 * 864e5));
    if (!d.hist.some(h => h.tipo === 'pago' && h.fecha >= desde && h.fecha <= f)) add(f, `💳 ${d.nombre}`, Math.min(d.minimo, saldoDeuda(d)), { accion: 'pagar-deuda', id: d.id });
  }
  // Mensualidades a meses
  for (const c of msiActivas()) for (const ym of [ymHoy, ymSig]) {
    const k = mesesEntre(c.primerMes, ym);
    if (k >= 0 && k < c.meses && !msiPagadaEn(c, ym)) add(fechaDelMes(ym, c.diaPago || 1), `🛍️ ${c.nombre} (${k + 1}/${c.meses})`, mensualidad(c), { accion: 'marcar-msi', id: c.id, mes: ym, q: `${ym}-${(c.diaPago || 1) <= 15 ? 1 : 2}` });
  }
  // Gastos fijos mensuales que aún no marcas (los semanales son rutina: se marcan en "Fijos", no son vencimientos)
  for (const q of [qActual(), moverPeriodo(qActual(), 1)]) for (const { f, mov } of compromisos(q)[0].fijos) {
    if (mov || f.tipo !== 'gasto' || !['mensual', 'q1', 'q2'].includes(f.cuando)) continue;
    add(fechaDelMes(q.slice(0, 7), diaMensual(f)), `📌 ${f.nombre}`, f.monto);
  }
  // Gastos del año que se pagan en estos días y no están cubiertos
  for (const m of previsiones()) if (faltaPrevision(m) > 0) add(`${m.fechaMeta}-01`, `📅 ${m.nombre}`, m.objetivo, { falta: faltaPrevision(m), anual: true });
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
function htmlProximosPagos() {
  const lista = proximosPagos(7, true);
  if (!lista.length) return '';
  const hoy = new Date(hoyISO() + 'T12:00');
  const cuando = f => { const n = Math.round((new Date(f + 'T12:00') - hoy) / 864e5); return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : `En ${n} días`; };
  const total = lista.reduce((a, x) => a + x.monto, 0);
  return `<section class="card">
    <h2>⏰ Próximos pagos <span class="muted small">(7 días)</span></h2>
    <p class="small muted" style="margin-top:-6px">Lo de ${esMes() ? 'este mes' : 'esta quincena'} está en "Fijos" con su aviso de vencimiento; aquí va lo que sigue.</p>
    <ul class="lista">${lista.map(x => {
      const n = Math.round((new Date(x.fecha + 'T12:00') - hoy) / 864e5);
      return `<li><div class="info"><b>${esc(x.nombre)}</b><span class="small" style="color:${n <= 2 ? 'var(--deuda)' : 'var(--muted)'}">${cuando(x.fecha)} · ${fechaCorta(x.fecha).slice(0, -5)}${x.falta ? ` · te faltan ${fmt(x.falta)}` : ''}</span></div>
        <span class="monto">${fmt(x.monto)}</span>
        ${x.accion ? `<button class="btn mini" data-action="${x.accion}" data-id="${x.id}" ${x.mes ? `data-mes="${x.mes}" data-q="${x.q}"` : ''}>Pagar</button>` : ''}</li>`;
    }).join('')}</ul>
    <div class="resumen-fijos"><div class="row"><b>Total próximos 7 días</b><b>${fmt(total)}</b></div></div>
  </section>`;
}
// Globo con el número de pagos próximos en el ícono de la app (si el teléfono lo permite)
function actualizarGlobo() {
  try {
    const n = proximosPagos(3).length;
    if (n) navigator.setAppBadge?.(n)?.catch?.(() => {}); else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* sin soporte */ }
}

function htmlCuentas() {
  const total = totalCuentas();
  return `<section class="card">
    <div class="row"><h2 style="margin:0">💰 Mis cuentas</h2>
      <div class="acciones" style="margin:0">
        ${S.cuentas.length > 1 ? '<button class="btn mini sec" data-action="traspaso">↔ Traspaso</button>' : ''}
        <button class="btn mini sec" data-action="nueva-cuenta">+ Cuenta</button>
      </div></div>
    <ul class="lista">${S.cuentas.map(c => {
      const s = saldoCuenta(c);
      return `<li><span style="font-size:1.3rem">${ICON_CUENTA[c.tipo]}</span>
        <div class="info"><b>${esc(c.nombre)}</b><span class="muted small">${TIPOS_CUENTA[c.tipo]}</span></div>
        <span class="monto ${s < 0 ? 'c-deuda' : ''}">${fmt(s)}</span>
        <button class="link-btn" data-action="editar-cuenta" data-id="${c.id}" aria-label="Editar o ajustar saldo">✏️</button></li>`;
    }).join('')}</ul>
    ${S.cuentas.length > 1 ? `<div class="resumen-fijos"><div class="row"><b>Total en cuentas</b><b>${fmt(total)}</b></div></div>` : ''}
    ${S.ajustes.cuentasRevisadas ? '' : `<div class="tip info"><span class="ic">🏦</span><div>Toca ✏️ y pon el <b>saldo real</b> que tienes hoy en tu banco o cartera. Desde ahí la app lleva la cuenta sola: cada ingreso, gasto y pago mueve el saldo. Si tienes varias (nómina, efectivo, ahorro), agrégalas con "+ Cuenta".</div></div>`}
  </section>`;
}

function htmlCompromisos(pend, proyectado) {
  const bloques = compromisos(per);
  const hayAlgo = bloques.some(b => b.fijos.length || b.tarjetas.length || b.meses.length);
  const titulo = esMes() ? 'Fijos del mes' : 'Fijos de la quincena';
  if (!hayAlgo) return `<section class="card">
    <div class="row"><h2 style="margin:0">📌 ${titulo}</h2><button class="btn mini" data-action="nuevo-fijo">+ Agregar fijo</button></div>
    <p class="small muted" style="margin-bottom:0">Da de alta lo que pagas o cobras cada quincena (renta, luz, colegiatura, sueldo…). Cada quincena aparecerá como lista para marcarlo con un toque.</p>
  </section>`;

  let nPend = 0;
  const cuerpo = bloques.map(b => {
    const ym = b.q.slice(0, 7);
    // Un renglón por fijo: los semanales juntan sus fechas de la quincena como botones
    const grupos = [];
    for (const o of b.fijos) { const g = grupos.find(x => x.f === o.f); if (g) g.ocs.push(o); else grupos.push({ f: o.f, ocs: [o] }); }
    const items = grupos.map(({ f, ocs }) => {
      const ing = f.tipo === 'ingreso';
      const pend = ocs.filter(o => !o.mov).length;
      nPend += pend;
      if (f.cuando === 'semanal') {
        const total = ocs.reduce((a, o) => a + (o.mov ? o.mov.monto : f.monto), 0);
        return `<li class="${pend ? '' : 'hecho'}">
          <span class="ic-sem">🔁</span>
          <div class="info"><b>${esc(f.nombre)}</b><span class="muted small">${ing ? 'Ingreso' : esc(f.cat)} · cada ${DIAS[f.diaSemana]} · ${ocs.length === 1 ? '1 vez' : `${ocs.length} veces`} esta quincena</span>
            <span class="dias-sem">${ocs.map(o => `<button class="dia-sem ${o.mov ? 'on' : ''}" data-action="marcar-fijo" data-id="${f.id}" data-q="${b.q}" data-fecha="${o.fecha}" aria-label="${o.mov ? 'Desmarcar' : 'Marcar'} ${DIAS[f.diaSemana]} ${+o.fecha.slice(8, 10)}">${o.mov ? '✓ ' : ''}${DIAS[f.diaSemana].slice(0, 3)} ${+o.fecha.slice(8, 10)}${o.mov ? '' : venceTexto(o.fecha, true)}</button>`).join('')}</span></div>
          <span class="monto ${ing ? 'c-ingreso' : 'c-gasto'}">${ing ? '+' : '−'} ${fmt(total)}${ocs.length > 1 ? `<span class="muted small por">${ocs.length} × ${fmt(f.monto)}</span>` : ''}</span>
          <button class="link-btn" data-action="editar-fijo" data-id="${f.id}" data-q="${b.q}" aria-label="Editar fijo">✏️</button>
        </li>`;
      }
      const { clave, mov } = ocs[0];
      const vence = f.cuando === 'cada' ? '' : venceTexto(fechaDelMes(ym, diaMensual(f)));
      return `<li class="${mov ? 'hecho' : ''}">
        <button class="check-btn ${mov ? 'on' : ''}" data-action="marcar-fijo" data-id="${f.id}" data-q="${b.q}" data-fecha="" aria-label="${mov ? 'Desmarcar' : 'Marcar como ' + (ing ? 'recibido' : 'pagado')}">${mov ? '✓' : ''}</button>
        <div class="info"><b>${esc(f.nombre)}</b><span class="muted small">${ing ? 'Ingreso' : esc(f.cat)}${cuandoTexto(f) ? ' · ' + cuandoTexto(f) : ''}${mov ? ` · ${ing ? 'recibido' : 'pagado'} ${fechaCorta(mov.fecha)}` : vence}</span></div>
        <span class="monto ${ing ? 'c-ingreso' : 'c-gasto'}">${ing ? '+' : '−'} ${fmt(mov ? mov.monto : f.monto)}</span>
        <button class="link-btn" data-action="editar-fijo" data-id="${f.id}" data-clave="${clave}" data-etiqueta="${nombrePeriodo(clave, true)}" data-pagado="${mov ? 1 : 0}" aria-label="Editar fijo">✏️</button>
      </li>`;
    }).concat(b.tarjetas.map(({ d, pagado }) => `<li class="${pagado ? 'hecho' : ''}">
        <button class="check-btn ${pagado ? 'on' : ''}" data-action="pagar-deuda" data-id="${d.id}" aria-label="Registrar pago de ${esc(d.nombre)}" ${pagado ? 'disabled' : ''}>${pagado ? '✓' : ''}</button>
        <div class="info"><b>💳 ${esc(d.nombre)}</b><span class="muted small">Pago mínimo · vence día ${d.diaPago}${pagado ? '' : venceTexto(fechaDelMes(ym, d.diaPago))}</span></div>
        <span class="monto c-deuda">− ${fmt(Math.min(d.minimo, saldoDeuda(d)))}</span>
      </li>`)).concat(b.meses.map(({ c, ym, pagado }) => {
        const previa = mesesEntre(c.primerMes, ym) < c.inicial;
        return `<li class="${pagado ? 'hecho' : ''}">
        <button class="check-btn ${pagado ? 'on' : ''}" data-action="marcar-msi" data-id="${c.id}" data-mes="${ym}" data-q="${b.q}" aria-label="${pagado ? 'Desmarcar' : 'Marcar mensualidad pagada'}" ${previa ? 'disabled' : ''}>${pagado ? '✓' : ''}</button>
        <div class="info"><b>🛍️ ${esc(c.nombre)}</b><span class="muted small">${c.tasa ? 'A meses' : 'MSI'} · mensualidad ${mesesEntre(c.primerMes, ym) + 1} de ${c.meses} · día ${c.diaPago}${pagado ? '' : venceTexto(fechaDelMes(ym, c.diaPago || 1))}</span></div>
        <span class="monto c-deuda">− ${fmt(mensualidad(c))}</span>
      </li>`;
      })).join('');
    return (esMes() ? `<p class="dia">${nombrePeriodo(b.q)}</p>` : '') + `<ul class="lista">${items || '<li class="muted small">Nada programado.</li>'}</ul>`;
  }).join('');

  return `<section class="card">
    <div class="row"><h2 style="margin:0">📌 ${titulo}</h2><button class="btn mini sec" data-action="nuevo-fijo">+ Fijo</button></div>
    ${cuerpo}
    <div class="resumen-fijos">
      ${pend.ingreso ? `<div class="row small"><span>Por recibir</span><b class="c-ingreso">${fmt(pend.ingreso)}</b></div>` : ''}
      <div class="row small"><span>Por pagar (fijos, tarjetas y meses)</span><b class="c-gasto">${fmt(pend.gasto + pend.tarjetas)}</b></div>
      <div class="row"><span><b>Te quedará libre</b></span><b style="font-size:1.1rem;color:${proyectado < 0 ? 'var(--deuda)' : 'var(--ingreso)'}">${fmt(proyectado)}</b></div>
    </div>
    ${nPend > 1 ? `<button class="btn mini sec" data-action="marcar-todos" style="width:100%;margin-top:10px">Marcar todos los fijos pendientes</button>` : ''}
  </section>`;
}

/* ---------- Movimientos: búsqueda, filtros y etiquetas ---------- */
let busqueda = '', filtroCat = '', filtroTag = '';
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const etiquetasUsadas = () => [...new Set(S.movs.flatMap(m => m.tags || []))].sort((a, b) => a.localeCompare(b, 'es'));
const leerEtiquetas = txt => [...new Set(String(txt || '').split(/[,#]/).map(t => t.trim().toLowerCase()).filter(Boolean))];

function htmlListaMovs() {
  // Con texto de búsqueda se busca en todos los movimientos; si no, solo en el periodo
  const q = sinAcentos(busqueda.trim());
  let lista = q || filtroTag ? [...S.movs] : movsPer(per);
  if (filtroMov !== 'todos') lista = lista.filter(x => x.tipo === filtroMov);
  if (filtroCat) lista = lista.filter(x => x.cat === filtroCat);
  if (filtroTag) lista = lista.filter(x => (x.tags || []).includes(filtroTag));
  if (q) lista = lista.filter(x => sinAcentos([x.cat, x.nota, nombreMedio(x), (x.tags || []).join(' '), x.monto, fmt(x.monto)].join(' ')).includes(q));
  lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
  const global = q || filtroTag;

  if (!lista.length) return global || filtroCat
    ? `<div class="card vacio"><div class="big">🔍</div><p>Sin resultados${global ? '' : ` en la ${nombrePeriodo(per)}`}.</p></div>`
    : `<div class="card vacio"><div class="big">🧾</div><p>No hay movimientos en la ${nombrePeriodo(per)}.</p><button class="btn" data-action="nuevo-mov">Registrar el primero</button></div>`;

  // Totales de lo filtrado: útil para "¿cuánto gasté en #viaje?"
  const tot = lista.reduce((a, x) => { if (x.tipo === 'gasto') a.g += x.monto; else if (x.tipo === 'ingreso') a.i += x.monto; return a; }, { g: 0, i: 0 });
  let html = `<p class="small muted" style="margin:0 4px 8px">${lista.length} movimiento${lista.length === 1 ? '' : 's'}${global ? ' (en todas las fechas)' : ''}${tot.g ? ` · gastos ${fmt(tot.g)}` : ''}${tot.i ? ` · ingresos ${fmt(tot.i)}` : ''}</p>
    <div class="card" style="padding-top:4px">`;
  let dia = '';
  for (const x of lista) {
    if (x.fecha !== dia) { if (dia) html += '</ul>'; dia = x.fecha; html += `<p class="dia">${fechaCorta(dia)}</p><ul class="lista">`; }
    const traspaso = x.tipo === 'traspaso';
    const personal = x.tipo === 'personal';
    const signo = x.tipo === 'ingreso' ? '+' : x.tipo === 'ahorro' ? (x.monto < 0 ? '↩' : '→') : traspaso ? '↔' : personal ? (x.monto > 0 ? '+' : '−') : '−';
    const color = x.tipo === 'ingreso' ? 'c-ingreso' : x.tipo === 'ahorro' ? 'c-ahorro' : x.tipo === 'pago' ? 'c-deuda' : traspaso || personal ? '' : 'c-gasto';
    const ic = x.tipo === 'ingreso' ? '💰' : x.tipo === 'ahorro' ? '🐷' : x.tipo === 'pago' ? '💳' : traspaso ? '🔁' : personal ? '🤝' : x.fijoId ? '📌' : '🛒';
    const detalle = traspaso
      ? `${esc(nombreMedio(x))} → ${esc(nombreMedio({ cuentaId: x.destinoId }))}`
      : [esc(x.nota), esc(nombreMedio(x))].filter(Boolean).join(' · ');
    const editable = (x.tipo === 'ingreso' || x.tipo === 'gasto') && !x.metaId && !x.deudaId && !x.msiId && !x.msiCompraId;
    const tags = (x.tags || []).map(t => `<button class="tag" data-action="filtro-tag" data-v="${esc(t)}">#${esc(t)}</button>`).join('');
    html += `<li>
      <span style="font-size:1.3rem">${ic}</span>
      <div class="info"><b>${esc(x.cat)}</b><span class="muted small">${detalle || '&nbsp;'}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</div>
      <span class="monto ${color}">${signo} ${fmt(Math.abs(x.monto))}</span>
      ${editable ? `<button class="link-btn" data-action="editar-mov" data-id="${x.id}" aria-label="Editar">✏️</button>` : ''}
      <button class="link-btn" data-action="borrar-mov" data-id="${x.id}" aria-label="Eliminar">🗑️</button>
    </li>`;
  }
  return html + '</ul></div>';
}
const refrescarLista = () => { const l = $('#lista-movs'); if (l) l.innerHTML = htmlListaMovs(); };

const VISTAS = {
  reportes: () => htmlReportes(),
  resumen() {
    const t = totales(per);
    const pend = pendientes(per);
    const proyectado = t.libre + pend.ingreso - pend.gasto - pend.tarjetas;
    const ing = t.ingreso || 1;
    const totalDeuda = deudasActivas().reduce((a, d) => a + saldoDeuda(d), 0) + msiActivas().reduce((a, c) => a + saldoMSI(c), 0) + totalPersonas('debo');

    // Tendencia de los últimos 6 periodos
    const ult = Array.from({ length: 6 }, (_, i) => moverPeriodo(per, i - 5));
    const tots = ult.map(totales);
    const maxT = Math.max(1, ...tots.flatMap(x => [x.ingreso, x.salidas]));

    const regla = [
      ['Necesidades', t.N, 0.5, 'var(--gasto)'],
      ['Deseos', t.D, 0.3, 'var(--warn)'],
      ['Ahorro y pago de deudas', t.A, 0.2, 'var(--ahorro)'],
    ];

    return `
      <div class="kpis">
        <div class="kpi"><div class="lbl">Ingresos</div><div class="val c-ingreso">${fmt(t.ingreso)}</div></div>
        <div class="kpi"><div class="lbl">Gastos</div><div class="val c-gasto">${fmt(t.gasto)}</div>${t.conTarjeta ? `<div class="sub">${fmt(t.conTarjeta)} a crédito (tarjeta o meses)</div>` : ''}</div>
        <div class="kpi"><div class="lbl">Ahorro y pagos</div><div class="val c-ahorro">${fmt(t.ahorro + t.pagos)}</div>${t.pagos ? `<div class="sub">${fmt(t.pagos)} a deudas</div>` : ''}</div>
        <div class="kpi"><div class="lbl">Balance ${esMes() ? 'del mes' : 'de la quincena'}</div><div class="val" style="color:${t.libre < 0 ? 'var(--deuda)' : 'inherit'}">${t.libre > 0 ? '+' : ''}${fmt(t.libre)}</div><div class="sub">lo que entró − lo que salió.<br>Tienes <b>${fmt(totalCuentas())}</b> en tus cuentas</div></div>
      </div>

      ${htmlSalud()}

      ${htmlProximosPagos()}

      ${htmlCuentas()}

      ${htmlCompromisos(pend, proyectado)}

      ${htmlPresupuesto(t)}

      ${htmlProyeccion()}

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
              <span style="height:${x.ingreso / maxT * 100}%;background:var(--ingreso)"></span>
              <span style="height:${x.salidas / maxT * 100}%;background:var(--gasto)"></span>
            </div>
            <div class="lbl">${nombrePeriodo(ult[i], true)}</div>
          </div>`).join('')}
        </div>
        <div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos</span><span><i style="background:var(--gasto)"></i>Salidas de tus cuentas</span></div>
      </section>


      <p class="small muted" style="text-align:center;margin:4px 0 0" data-tab="ajustes">Mis Finanzas v${VERSION}</p>
      ${totalDeuda > 0 ? `<section class="card row" data-tab="deudas" style="cursor:pointer">
        <div><h2 style="margin:0">Deuda total</h2><span class="muted small">${deudasActivas().length} cuenta(s)${msiActivas().length ? ` y ${msiActivas().length} compra(s) a meses` : ''} · ver plan</span></div>
        <div class="deuda-saldo">${fmt(totalDeuda)}</div>
      </section>` : ''}
    `;
  },

  movs() {
    const chips = [['todos', 'Todos'], ['ingreso', 'Ingresos'], ['gasto', 'Gastos'], ['pago', 'Pagos'], ['ahorro', 'Ahorro']]
      .map(([k, n]) => `<button class="chip ${filtroMov === k ? 'on' : ''}" data-action="filtro" data-v="${k}">${n}</button>`).join('');
    const cats = [...new Set(S.movs.map(m => m.cat))].sort((a, b) => a.localeCompare(b, 'es'));
    const tags = etiquetasUsadas();
    return `
      <div class="buscador">
        <input type="search" id="buscar" placeholder="🔍 Buscar en todos tus movimientos…" value="${esc(busqueda)}" autocomplete="off">
        <div class="grid2" style="margin-top:8px">
          <select id="filtro-cat" aria-label="Categoría"><option value="">Todas las categorías</option>${cats.map(c => `<option ${c === filtroCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="filtro-tag" aria-label="Etiqueta"><option value="">Todas las etiquetas</option>${tags.map(t => `<option value="${esc(t)}" ${t === filtroTag ? 'selected' : ''}>#${esc(t)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="chips">${chips}</div>
      <div id="lista-movs">${htmlListaMovs()}</div>`;
  },

  ahorro() {
    const total = S.metas.reduce((a, m) => a + acumuladoMeta(m), 0);
    const gastoProm = promedioGastoMensual();
    let html = `<div class="kpis" style="grid-template-columns:1fr 1fr">
      <div class="kpi"><div class="lbl">Total ahorrado</div><div class="val c-ahorro">${fmt(total)}</div></div>
      <div class="kpi"><div class="lbl">Gasto mensual prom.</div><div class="val">${fmt(gastoProm)}</div></div>
    </div>`;
    html += htmlPrevisiones();
    const metas = S.metas.filter(m => !m.anual);
    html += '<h2 class="seccion">🐷 Metas de ahorro</h2>';
    if (!metas.length) {
      return html + `<div class="card vacio"><div class="big">🐷</div><p>Aún no tienes metas de ahorro.<br>Te recomiendo empezar por un fondo de emergencia.</p>
        <div class="acciones" style="justify-content:center">
          <button class="btn" data-action="meta-emergencia">Crear fondo de emergencia</button>
          <button class="btn sec" data-action="nueva-meta">Otra meta</button>
        </div></div>`;
    }
    for (const m of metas) {
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
    const liquidadas = S.deudas.filter(d => saldoDeuda(d) <= 0.5 && !msiDeTarjeta(d).length);
    const total = activas.reduce((a, d) => a + saldoDeuda(d), 0);
    const sumMin = activas.reduce((a, d) => a + d.minimo, 0);
    const intMes = activas.reduce((a, d) => a + interesMensual(d), 0);
    const totalMSI = msiActivas().reduce((a, c) => a + saldoMSI(c), 0);
    const mensMSI = mensualidadesMes();
    // Una tarjeta en ceros pero con compras a meses sigue activa
    const visibles = S.deudas.filter(d => saldoDeuda(d) > 0.5 || msiDeTarjeta(d).length);

    if (!S.deudas.length && !S.msi.length && !S.personas.length) return `<div class="card vacio"><div class="big">💳</div>
      <p>Registra tus tarjetas, préstamos y compras a meses (MSI).<br>Te armo un plan para liquidarlas y te digo cuánto ahorras en intereses.</p>
      <div class="acciones" style="justify-content:center">
        <button class="btn" data-action="nueva-deuda">Agregar tarjeta o préstamo</button>
        <button class="btn sec" data-action="nuevo-msi">Agregar compra a meses</button>
        <button class="btn sec" data-action="nueva-persona">Préstamo entre personas</button>
      </div></div>`;

    const debo = totalPersonas('debo');
    let html = `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="lbl">Deuda total</div><div class="val c-deuda">${fmt(total + totalMSI + debo)}</div></div>
      <div class="kpi"><div class="lbl">A pagar / mes</div><div class="val">${fmt(sumMin + mensMSI)}</div></div>
      <div class="kpi"><div class="lbl">Intereses / mes</div><div class="val c-deuda">${fmt(intMes)}</div></div>
    </div>`;
    if (mensMSI > 0 && activas.length) html += `<p class="small muted" style="margin:-6px 0 12px">A pagar al mes = mínimos de tarjetas (${fmt(sumMin)}) + mensualidades a meses (${fmt(mensMSI)}).</p>`;

    if (activas.length) html += planHTML(activas, sumMin, mensMSI);

    for (const d of visibles) html += tarjetaDeuda(d);
    html += `<button class="btn sec" data-action="nueva-deuda" style="width:100%;margin-bottom:14px">+ Agregar tarjeta o préstamo</button>`;
    html += seccionMSI();
    html += seccionPersonas();
    if (liquidadas.length) html += `<section class="card"><h2>🎉 Liquidadas</h2><ul class="lista">${liquidadas.map(d =>
      `<li><div class="info"><b>${esc(d.nombre)}</b><span class="muted small">${TIPOS_DEUDA[d.tipo]}</span></div>
       <button class="link-btn" data-action="borrar-deuda" data-id="${d.id}" aria-label="Eliminar">🗑️</button></li>`).join('')}</ul></section>`;
    return html;
  },

  ajustes() {
    return `
      <section class="card">
        <h2>🔒 Seguridad</h2>
        ${PIN ? `<p class="small" style="margin-top:-4px">✅ La app pide tu PIN al abrirse y cuando la dejas más de 1 minuto.${PIN.bio ? ' También puedes entrar con huella / rostro.' : ''}</p>`
          : '<p class="small muted" style="margin-top:-4px">Pon un PIN para que nadie más vea tus finanzas si toma tu teléfono.</p>'}
        <div class="acciones">
          ${PIN ? `<button class="btn mini" data-action="cambiar-pin">Cambiar PIN</button>
            ${bioDisponible ? `<button class="btn mini sec" data-action="huella">${PIN.bio ? 'Quitar huella / rostro' : '👆 Activar huella / rostro'}</button>` : ''}
            <button class="btn mini sec" data-action="quitar-pin">Quitar PIN</button>`
          : '<button class="btn" data-action="poner-pin">Poner PIN</button>'}
        </div>
        <p class="hint">El PIN protege la pantalla de la app. Para más seguridad, usa también el bloqueo de tu teléfono y exporta tus respaldos con contraseña.</p>
      </section>

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

/* ---------- Reportes ---------- */
function patrimonio() {
  const activos = [
    ['Cuentas', totalCuentas()],
    ['Ahorro apartado', S.metas.reduce((a, m) => a + acumuladoMeta(m), 0)],
    ['Te deben', totalPersonas('meDeben')],
  ];
  const pasivos = [
    ['Tarjetas y préstamos', S.deudas.reduce((a, d) => a + saldoDeuda(d), 0)],
    ['Compras a meses', msiActivas().reduce((a, c) => a + saldoMSI(c), 0)],
    ['Debes a personas', totalPersonas('debo')],
  ];
  const A = activos.reduce((a, x) => a + x[1], 0), P = pasivos.reduce((a, x) => a + x[1], 0);
  return { activos, pasivos, A, P, neto: A - P };
}
const flecha = (act, ant, masEsBueno) => {
  if (!ant) return '<span class="muted">—</span>';
  const d = (act - ant) / Math.abs(ant), bueno = masEsBueno ? d >= 0 : d <= 0;
  return `<span style="color:${Math.abs(d) < 0.005 ? 'var(--muted)' : bueno ? 'var(--ingreso)' : 'var(--deuda)'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))}</span>`;
};

function htmlReportes() {
  const pat = patrimonio();
  const hist = Object.entries({ ...S.historial, [hoyISO().slice(0, 7)]: Math.round(pat.neto) }).sort().slice(-12);
  const maxH = Math.max(1, ...hist.map(([, v]) => Math.abs(v)));
  const lineas = l => l.filter(x => x[1]).map(([n, v]) => `<div class="lin"><span>${n}</span><b>${fmt(v)}</b></div>`).join('') || '<div class="small muted">—</div>';

  // Este mes vs. el anterior (siempre por mes calendario)
  const mAct = hoyISO().slice(0, 7), mAnt = sumarMeses(mAct, -1);
  const a = totales(mAct), b = totales(mAnt);
  const filasComp = [['Ingresos', 'ingreso', true], ['Gastos', 'gasto', false], ['Ahorro y pagos', null, true], ['Balance', 'libre', true]]
    .map(([n, k, bueno]) => { const va = k ? a[k] : a.ahorro + a.pagos, vb = k ? b[k] : b.ahorro + b.pagos;
      return `<tr><td>${n}</td><td class="n">${fmt(vb)}</td><td class="n"><b>${fmt(va)}</b></td><td class="n">${flecha(va, vb, bueno)}</td></tr>`; }).join('');
  const cats = [...new Set([...Object.keys(a.porCat), ...Object.keys(b.porCat)])]
    .map(c => [c, a.porCat[c] || 0, b.porCat[c] || 0]).sort((x, y) => y[1] - x[1]).slice(0, 8);

  // El año, mes por mes
  const y = mAct.slice(0, 4);
  const meses = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const tm = meses.map(m => totales(m));
  const maxM = Math.max(1, ...tm.flatMap(t => [t.ingreso, t.gasto]));
  const anual = tm.reduce((s, t) => { s.ing += t.ingreso; s.gas += t.gasto; for (const [c, v] of Object.entries(t.porCat)) s.cat[c] = (s.cat[c] || 0) + v; return s; }, { ing: 0, gas: 0, cat: {} });
  const topCat = Object.entries(anual.cat).sort((x, y) => y[1] - x[1]).slice(0, 6);

  return `
    <section class="card">
      <h2>💎 Patrimonio neto</h2>
      <div class="patrimonio" style="color:${pat.neto < 0 ? 'var(--deuda)' : 'var(--ingreso)'}">${fmt(pat.neto)}</div>
      <p class="small muted" style="margin-top:0">Lo que tienes menos lo que debes. Es la cifra que mejor dice si vas mejorando: que suba cada mes.</p>
      <div class="comparativo">
        <div><span class="small muted">Lo que tienes</span><b class="c-ingreso">${fmt(pat.A)}</b>${lineas(pat.activos)}</div>
        <div><span class="small muted">Lo que debes</span><b class="c-deuda">${fmt(pat.P)}</b>${lineas(pat.pasivos)}</div>
      </div>
      ${hist.length > 1 ? `<div class="tendencia">${hist.map(([m, v]) => `<div class="col"><div class="pair"><span style="width:60%;max-width:26px;height:${Math.abs(v) / maxH * 100}%;background:${v < 0 ? 'var(--deuda)' : 'var(--ahorro)'}"></span></div><div class="lbl">${nombreMes(m)}</div></div>`).join('')}</div>`
        : '<p class="small muted" style="margin-bottom:0">La app guarda una foto de tu patrimonio cada mes; aquí verás cómo cambia.</p>'}
    </section>

    <section class="card">
      <h2>📆 ${nombrePeriodo(mAct)} vs. ${nombrePeriodo(mAnt)}</h2>
      <table class="plan"><thead><tr><th></th><th class="n">Anterior</th><th class="n">Este mes</th><th class="n">Cambio</th></tr></thead><tbody>${filasComp}</tbody></table>
      ${cats.length ? `<p class="dia">Gastos por categoría</p><table class="plan"><tbody>${cats.map(([c, va, vb]) => `<tr><td>${esc(c)}</td><td class="n muted">${fmt(vb)}</td><td class="n"><b>${fmt(va)}</b></td><td class="n">${flecha(va, vb, false)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="small muted" style="margin-bottom:0">Compara meses completos; el mes actual va sumando conforme avanza.</p>
    </section>

    <section class="card">
      <h2>📅 Tu ${y}</h2>
      <div class="tendencia">${tm.map((t, i) => `<div class="col"><div class="pair">
        <span style="height:${t.ingreso / maxM * 100}%;background:var(--ingreso)"></span>
        <span style="height:${t.gasto / maxM * 100}%;background:var(--gasto)"></span>
      </div><div class="lbl">${MESES[i][0].toUpperCase()}</div></div>`).join('')}</div>
      <div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos ${fmt(anual.ing)}</span><span><i style="background:var(--gasto)"></i>Gastos ${fmt(anual.gas)}</span></div>
      ${topCat.length ? `<p class="dia">En qué se fue tu dinero</p>${topCat.map(([c, v]) => `<div class="bar-row"><div class="row"><span>${esc(c)}</span><span><b>${fmt(v)}</b> <span class="meta">${pct(v / anual.gas)}</span></span></div><div class="bar"><span style="width:${v / topCat[0][1] * 100}%;background:var(--gasto)"></span></div></div>`).join('')}` : ''}
    </section>

    <section class="card">
      <h2>📤 Exportar a Excel</h2>
      <p class="small muted" style="margin-top:-4px">Descarga tus movimientos en un archivo CSV que abre en Excel o Google Sheets. Se guarda en tu dispositivo.</p>
      <div class="acciones">
        <button class="btn" data-action="exportar-csv" data-v="${y}">Movimientos de ${y}</button>
        <button class="btn sec" data-action="exportar-csv" data-v="todo">Todos los movimientos</button>
      </div>
    </section>`;
}

const TIPO_MOV = { ingreso: 'Ingreso', gasto: 'Gasto', ahorro: 'Ahorro', pago: 'Pago de deuda', traspaso: 'Traspaso', personal: 'Préstamo entre personas' };
async function exportarCSV(anio) {
  const lista = S.movs.filter(m => anio === 'todo' || m.fecha.startsWith(anio)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!lista.length) return toast('No hay movimientos para exportar');
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = [['Fecha', 'Tipo', 'Categoría', 'Monto', 'Cuenta / tarjeta', 'Nota'].map(q).join(',')];
  for (const m of lista) {
    // Salidas en negativo para poder sumar la columna en Excel
    const signo = m.tipo === 'ingreso' ? 1 : m.tipo === 'personal' ? Math.sign(m.monto) : m.tipo === 'traspaso' ? 0 : -1;
    const monto = m.tipo === 'traspaso' ? m.monto : signo * Math.abs(m.monto);
    const medio = m.tipo === 'traspaso' ? `${nombreMedio(m)} → ${nombreMedio({ cuentaId: m.destinoId })}` : nombreMedio(m);
    filas.push([m.fecha, TIPO_MOV[m.tipo] || m.tipo, m.cat, monto.toFixed(2), medio.replace(/^\S+\s/, ''), m.nota].map(q).join(','));
  }
  const nombre = `mis-finanzas-movimientos-${anio}.csv`;
  const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM: Excel respeta acentos
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`📤 ${lista.length} movimientos exportados`);
}

// Meta del plan: en cuántos meses quieres salir de deudas (0 = "yo digo cuánto pago")
const metaPlan = () => S.ajustes.planMeses ?? (S.ajustes.presupuestoDeuda ? 0 : 12);

function planHTML(activas, sumMin, mensMSI = 0) {
  const est = S.ajustes.estrategia, meta = metaPlan();
  const presupuesto = meta ? presupuestoPara(meta, est) : Math.max(S.ajustes.presupuestoDeuda || 0, Math.ceil(sumMin));
  const r = simular(presupuesto, est);
  const sm = simularSoloMinimos();
  const opciones = [[6, '6 meses'], [12, '1 año'], [18, '18 meses'], [24, '2 años'], [0, 'Yo digo cuánto']];

  let cuerpo;
  if (r.error || r.sinFin) {
    cuerpo = `<div class="tip bad"><span class="ic">⛔</span><div>Con ${fmt(presupuesto)} al mes ${r.error ? 'no alcanzas a cubrir los pagos mínimos' : 'la deuda nunca se termina de pagar'}. Elige una meta de tiempo arriba y te digo cuánto necesitas.</div></div>`;
  } else {
    const ahorroInt = sm.interes - r.interes;
    const reparto = r.orden.filter(d => d.pago1 > 0.5).sort((a, b) => b.pago1 - b.min1 - (a.pago1 - a.min1));
    cuerpo = `
      <div class="plan-meta">
        <div class="small">Para quedar sin deudas en <b>${fechaFin(r.meses)}</b> (${duracion(r.meses)}) paga:</div>
        <div class="plan-monto">${fmt(presupuesto)} <span>al mes</span></div>
        <div class="plan-quincena">o <b>${fmt(presupuesto / 2)}</b> cada quincena</div>
      </div>

      <p class="dia">Así repártelo este mes</p>
      <ul class="lista">${reparto.map((d, i) => {
        const extra = d.pago1 - d.min1;
        return `<li>
          <span class="num-plan ${extra > 0.5 ? 'prio' : ''}">${extra > 0.5 ? '⭐' : i + 1}</span>
          <div class="info"><b>${esc(d.nombre)}</b><span class="muted small">${extra > 0.5 ? `mínimo ${fmt(d.min1)} + <b style="color:var(--accent)">extra ${fmt(extra)}</b> · aquí va todo lo extra` : 'solo el mínimo'}</span></div>
          <span class="monto">${fmt(d.pago1)}<span class="muted small por">${fmt(d.pago1 / 2)} c/quincena</span></span>
        </li>`;
      }).join('')}</ul>

      ${ahorroInt > 1 ? `<div class="tip ok"><span class="ic">💸</span><div>Si solo pagaras los mínimos tardarías <b>${sm.sinFin ? 'para siempre' : duracion(sm.meses)}</b>. Con este plan te ahorras <b>${sm.sinFin ? 'una deuda sin fin' : fmt(ahorroInt) + ' en intereses'}</b>.</div></div>` : ''}

      <details class="det-plan"><summary>Ver cuándo terminas cada deuda</summary>
        <table class="plan"><tbody>${r.orden.map((d, i) => `<tr><td>${i + 1}. ${esc(d.nombre)} <span class="muted small">${d.tasa}%</span></td><td class="n">${d.mes ? 'en ' + fechaFin(d.mes) : '—'}</td><td class="n muted small">${fmt(d.interes)} int.</td></tr>`).join('')}</tbody></table>
        <p class="small muted">Cuando liquides una deuda, lo que le pagabas pásalo a la siguiente de la lista: el total al mes no cambia.</p>
      </details>`;
  }

  return `<section class="card">
    <h2>🎯 Plan para liquidar</h2>
    <p class="small muted" style="margin-top:-6px">¿En cuánto tiempo quieres salir de deudas?</p>
    <div class="chips">${opciones.map(([v, n]) => `<button class="chip ${meta === v ? 'on' : ''}" data-action="plan-meses" data-v="${v}">${n}</button>`).join('')}</div>
    ${meta ? '' : `<label class="campo">¿Cuánto puedes pagar al mes en total?
      <input type="number" inputmode="decimal" min="0" step="100" id="presupuesto" value="${presupuesto}">
      <span class="hint">Mínimo necesario: ${fmt(sumMin)} al mes (${fmt(sumMin / 2)} por quincena).</span></label>`}
    ${cuerpo}
    <details class="det-plan"><summary>Método: ${est === 'avalancha' ? '🏔️ Avalancha' : '⛄ Bola de nieve'} (cambiar)</summary>
      <div class="chips" style="margin-top:8px">
        <button class="chip ${est === 'avalancha' ? 'on' : ''}" data-action="estrategia" data-v="avalancha">🏔️ Avalancha</button>
        <button class="chip ${est === 'bola' ? 'on' : ''}" data-action="estrategia" data-v="bola">⛄ Bola de nieve</button>
      </div>
      <p class="small muted"><b>Avalancha</b> (recomendado): lo extra va a la deuda con la tasa más alta; es la que menos intereses paga.<br><b>Bola de nieve</b>: lo extra va a la deuda más chica; liquidas cuentas rápido y motiva.</p>
    </details>
    ${mensMSI > 0 ? `<p class="small muted">Aparte pagas ${fmt(mensMSI)}/mes de compras a meses (${fmt(mensMSI / 2)} por quincena). Ya tienen plazo fijo: sepáralo además de este plan.</p>` : ''}
  </section>`;
}

function seccionPersonas() {
  const activos = S.personas.filter(p => pendientePersona(p) > 0.5);
  const saldados = S.personas.filter(p => pendientePersona(p) <= 0.5);
  const grupo = (sentido, titulo) => {
    const l = activos.filter(p => p.sentido === sentido);
    if (!l.length) return '';
    return `<p class="dia">${titulo} · ${fmt(totalPersonas(sentido))}</p><ul class="lista">${l.map(p => `<li>
      <span style="font-size:1.3rem">${sentido === 'meDeben' ? '🫴' : '🤲'}</span>
      <div class="info"><b>${esc(p.nombre)}</b><span class="muted small">desde ${fechaCorta(p.fecha)}${p.nota ? ' · ' + esc(p.nota) : ''}${abonadoPersona(p) ? ` · abonado ${fmt(abonadoPersona(p))} de ${fmt(p.monto)}` : ''}</span></div>
      <span class="monto ${sentido === 'meDeben' ? 'c-ingreso' : 'c-deuda'}">${fmt(pendientePersona(p))}</span>
      <button class="btn mini sec" data-action="abono-persona" data-id="${p.id}">${sentido === 'meDeben' ? 'Me pagó' : 'Pagué'}</button>
    </li>`).join('')}</ul>`;
  };
  return `<section class="card">
    <div class="row"><h2 style="margin:0">🤝 Entre personas</h2><button class="btn mini" data-action="nueva-persona">+ Préstamo</button></div>
    ${activos.length ? grupo('meDeben', 'Me deben') + grupo('debo', 'Debo')
      : '<p class="small muted" style="margin-bottom:0">Lleva el control de lo que prestas y de lo que te prestan familiares o amigos. No es ingreso ni gasto: es dinero que va y regresa.</p>'}
    ${saldados.length ? `<p class="dia">Saldados ✅</p><ul class="lista">${saldados.map(p => `<li><div class="info"><b>${esc(p.nombre)}</b><span class="muted small">${p.sentido === 'meDeben' ? 'Te pagó' : 'Pagaste'} ${fmt(p.monto)}</span></div><button class="link-btn" data-action="borrar-persona" data-id="${p.id}" aria-label="Eliminar">🗑️</button></li>`).join('')}</ul>` : ''}
  </section>`;
}

function formPersona() {
  dialogo('Préstamo entre personas', `
    <div class="segmento">
      <input type="radio" name="sentido" id="p-1" value="meDeben" checked><label for="p-1" class="ing">Yo presté</label>
      <input type="radio" name="sentido" id="p-2" value="debo"><label for="p-2" class="gas">Me prestaron</label>
    </div>
    ${campo('¿Quién?', 'name="nombre" required maxlength="40" placeholder="Ej. Juan, mi hermana…"')}
    <div class="grid2">
      ${campo('Monto', 'name="monto" type="number" inputmode="decimal" min="0.01" step="0.01" required')}
      ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
    </div>
    ${campo('Nota (opcional)', 'name="nota" maxlength="80" placeholder="Ej. para la renta, me paga en diciembre"')}
    <label class="check"><input type="checkbox" name="mover" checked> El dinero salió / entró de mi cuenta hoy</label>
    <label class="campo">Cuenta<select name="medio">${opcionesMedio(medioDefault(true), false)}</select>
      <span class="hint">Desmarca la casilla si es un préstamo de antes y solo quieres llevar el control.</span></label>
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const p = { id: uid(), nombre: d.nombre.trim(), sentido: d.sentido, monto, fecha: d.fecha, nota: d.nota.trim() };
    S.personas.push(p);
    if (d.mover) S.movs.push({ id: uid(), tipo: 'personal', monto: d.sentido === 'meDeben' ? -monto : monto, cat: d.sentido === 'meDeben' ? `Préstamo a ${p.nombre}` : `Préstamo de ${p.nombre}`, fecha: d.fecha, nota: p.nota, personaId: p.id, cuentaId: d.medio.slice(2) });
    toast('🤝 Préstamo registrado');
  });
}

function formAbonoPersona(p) {
  const pend = pendientePersona(p), meDeben = p.sentido === 'meDeben';
  dialogo(meDeben ? `${p.nombre} te pagó` : `Pago a ${p.nombre}`, `
    ${campo('Monto', `name="monto" type="number" inputmode="decimal" min="0.01" step="0.01" max="${pend.toFixed(2)}" required value="${pend.toFixed(2)}"`, `Pendiente: ${fmt(pend)}`)}
    <div class="grid2">
      ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
      <label class="campo">${meDeben ? '¿A qué cuenta entró?' : '¿De qué cuenta salió?'}<select name="medio">${opcionesMedio(medioDefault(true), false)}</select></label>
    </div>
  `, d => {
    const monto = Math.min(num(d.monto), pend);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    S.movs.push({ id: uid(), tipo: 'personal', monto: meDeben ? monto : -monto, cat: meDeben ? `Abono de ${p.nombre}` : `Abono a ${p.nombre}`, fecha: d.fecha, nota: '', personaId: p.id, abono: true, cuentaId: d.medio.slice(2) });
    toast(pendientePersona(p) <= 0.5 ? '✅ ¡Saldado!' : 'Abono registrado');
  }, 'Registrar');
}

function seccionMSI() {
  const activas = msiActivas();
  const terminadas = S.msi.filter(c => restantesMSI(c) <= 0);
  const mens = mensualidadesMes();
  const nombreTarjeta = id => S.deudas.find(d => d.id === id)?.nombre;
  const items = activas.map(c => {
    const pag = pagadasMSI(c), m = mensualidad(c), total = m * c.meses;
    return `<div class="msi">
      <div class="row"><b>${esc(c.nombre)} <span class="badge ${c.tasa ? 'dep' : 'sem'}">${c.tasa ? c.tasa + '% anual' : 'MSI'}</span></b><b class="c-deuda">${fmt(m)}<span class="muted small">/mes</span></b></div>
      <div class="small muted">${nombreTarjeta(c.tarjetaId) ? '💳 ' + esc(nombreTarjeta(c.tarjetaId)) + ' · ' : ''}Pagadas ${pag} de ${c.meses} · termina en ${nombrePeriodo(finMSI(c))} · día ${c.diaPago}</div>
      <div class="bar" style="margin:6px 0"><span style="width:${pag / c.meses * 100}%;background:var(--accent)"></span></div>
      <div class="row small"><span>Te falta: <b>${fmt(saldoMSI(c))}</b> (${restantesMSI(c)} mensualidad${restantesMSI(c) === 1 ? '' : 'es'})</span>${c.tasa ? `<span class="c-deuda">Intereses: ${fmt(total - c.monto)}</span>` : ''}</div>
      <div class="acciones">
        <button class="btn mini" data-action="pagar-msi" data-id="${c.id}">Registrar mensualidad</button>
        <button class="btn mini sec" data-action="editar-msi" data-id="${c.id}">Editar</button>
        <button class="btn mini sec" data-action="borrar-msi" data-id="${c.id}">Eliminar</button>
      </div>
    </div>`;
  }).join('');
  return `<section class="card">
    <div class="row"><h2 style="margin:0">🛍️ Compras a meses</h2><button class="btn mini" data-action="nuevo-msi">+ Compra</button></div>
    ${activas.length ? items + `<div class="resumen-fijos"><div class="row"><span>Mensualidades al mes</span><b>${fmt(mens)}</b></div><div class="row small muted"><span>Por quincena, aprox.</span><span>${fmt(mens / 2)}</span></div></div>`
      : '<p class="small muted" style="margin-bottom:0">Registra tus compras a meses sin intereses (MSI) o con intereses: te digo cuánto pagas al mes, cuántas mensualidades te faltan y cuándo terminas.</p>'}
    ${terminadas.length ? `<p class="dia">Terminadas 🎉</p><ul class="lista">${terminadas.map(c => `<li><div class="info"><b>${esc(c.nombre)}</b><span class="muted small">${c.meses} mensualidades · ${fmt(c.monto)}</span></div><button class="link-btn" data-action="borrar-msi" data-id="${c.id}" aria-label="Eliminar">🗑️</button></li>`).join('')}</ul>` : ''}
  </section>`;
}

function tarjetaDeuda(d) {
  const s = saldoDeuda(d);
  const i = interesMensual(d);
  const pago = proximaFecha(d.diaPago);
  const corte = proximaFecha(d.diaCorte);
  const ligadas = msiDeTarjeta(d);
  const sMSI = ligadas.reduce((a, c) => a + saldoMSI(c), 0), mMSI = ligadas.reduce((a, c) => a + mensualidad(c), 0);
  const uso = d.limite > 0 ? (s + sMSI) / d.limite : null;
  const cls = d.tipo === 'dep' ? 'dep' : d.tipo === 'tc' ? 'tc' : '';
  const plazo = esRevolvente(d) ? null : plazoRestante(d);
  const ultimos = [...d.hist].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 3);
  return `<section class="card">
    <div class="deuda-top">
      <div><h3>${esc(d.nombre)}</h3><span class="badge ${cls}">${TIPOS_DEUDA[d.tipo]}</span></div>
      <div style="text-align:right"><div class="deuda-saldo">${fmt(s)}</div><span class="small muted">saldo actual</span></div>
    </div>
    ${uso != null ? `<div class="bar" style="margin-top:10px"><span style="width:${Math.min(100, uso * 100)}%;background:${uso > 0.3 ? 'var(--deuda)' : 'var(--accent)'}"></span></div>
      <div class="small muted" style="margin-top:3px">Uso de línea: ${pct(uso)} de ${fmt(d.limite)}${sMSI ? ' (incluye compras a meses)' : ''}</div>` : ''}
    ${ligadas.length ? `<div class="tip info"><span class="ic">🛍️</span><div>${ligadas.length} compra${ligadas.length > 1 ? 's' : ''} a meses en esta tarjeta: <b>${fmt(mMSI)}/mes</b> (te faltan ${fmt(sMSI)}). Súmalo a tu pago de cada mes.</div></div>` : ''}
    <div class="datos">
      <div>Tasa anual<b>${d.tasa}%</b></div>
      <div>${esRevolvente(d) ? 'Pago mínimo' : 'Pago mensual'}<b>${fmt(d.minimo)}</b></div>
      <div>Interés / mes<b class="${i > 0 && d.minimo <= i ? 'c-deuda' : ''}">${fmt(i)}</b></div>
      ${!esRevolvente(d) && plazo ? `<div>Pagos restantes<b>${plazo.pagos}</b></div><div>Terminas en<b>${fechaFin(plazo.pagos)}</b></div><div>Intereses por pagar<b class="c-deuda">${fmt(plazo.intereses)}</b></div>` : ''}
      ${corte && esRevolvente(d) ? `<div>Corte<b>${corte.fecha.getDate()} ${MESES[corte.fecha.getMonth()]}</b></div>` : ''}
      ${pago ? `<div>Pagar antes de<b style="${pago.dias <= 5 ? 'color:var(--deuda)' : ''}">${pago.fecha.getDate()} ${MESES[pago.fecha.getMonth()]}</b></div><div>Faltan<b>${pago.dias} día${pago.dias === 1 ? '' : 's'}</b></div>` : ''}
    </div>
    ${i > 0 && d.minimo <= i ? `<div class="tip bad"><span class="ic">⛔</span><div>${esRevolvente(d) ? 'El mínimo' : 'El pago'} no cubre los intereses: esta deuda crece cada mes.</div></div>` : ''}
    ${!esRevolvente(d) && plazo && plazo.pagos > 6 ? `<div class="tip info"><span class="ic">💡</span><div>Abonar a capital acorta el plazo y te ahorra intereses. Pide a tu banco que el abono sea para <b>reducir el plazo</b>, no la mensualidad.</div></div>` : ''}
    ${ultimos.length ? `<ul class="lista small" style="margin-top:8px">${ultimos.map(h => `<li><span>${h.tipo === 'pago' ? '✅' : '🛍️'}</span><div class="info">${h.tipo === 'pago' ? 'Pago' : h.tipo === 'interes' ? 'Intereses / comisiones' : 'Cargo'} · <span class="muted">${fechaCorta(h.fecha)}</span></div><span class="monto ${h.tipo === 'pago' ? 'c-ingreso' : 'c-deuda'}">${h.tipo === 'pago' ? '−' : '+'}${fmt(h.monto)}</span></li>`).join('')}</ul>` : ''}
    <div class="acciones">
      <button class="btn mini" data-action="pagar-deuda" data-id="${d.id}">Registrar pago</button>
      ${esRevolvente(d) ? `<button class="btn mini sec" data-action="cargo-deuda" data-id="${d.id}">+ Cargo / intereses</button>` : ''}
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
  $('#dlg-body').oninput = $('#dlg-body').onchange = null; // limpia listeners de un formulario anterior
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
  const catsDe = t => t === 'ingreso' ? CATS.ingreso : CATS_GASTO;
  const medio = mov ? medioDe(mov) : medioDefault(m.tipo === 'ingreso');
  const lblMedio = t => t === 'ingreso' ? '¿A qué cuenta entró?' : '¿Con qué pagaste?';
  dialogo(mov ? 'Editar movimiento' : 'Nuevo movimiento', `
    <div class="segmento">
      <input type="radio" name="tipo" id="t-g" value="gasto" ${m.tipo === 'gasto' ? 'checked' : ''}><label for="t-g" class="gas">Gasto</label>
      <input type="radio" name="tipo" id="t-i" value="ingreso" ${m.tipo === 'ingreso' ? 'checked' : ''}><label for="t-i" class="ing">Ingreso</label>
    </div>
    ${campo('Monto', `name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${m.monto}" placeholder="0.00"`)}
    <label class="campo">Categoría<select name="cat" id="sel-cat">${opciones(catsDe(m.tipo), m.cat)}</select></label>
    <label class="campo"><span id="lbl-medio">${lblMedio(m.tipo)}</span><select name="medio" id="sel-medio">${opcionesMedio(medio, m.tipo === 'gasto')}</select>
      <span class="hint" id="hint-medio" ${medio.startsWith('t:') ? '' : 'hidden'}>Con tarjeta de crédito: cuenta como gasto y sube el saldo de la tarjeta, pero no descuenta de tus cuentas hasta que pagues la tarjeta.</span></label>
    ${campo('Fecha', `name="fecha" type="date" required value="${m.fecha}"`)}
    ${campo('Nota (opcional)', `name="nota" maxlength="80" value="${esc(m.nota)}" placeholder="Ej. comida con Ana"`)}
    ${campo('Etiquetas (opcional)', `name="tags" maxlength="80" list="tags-usadas" value="${esc((m.tags || []).join(', '))}" placeholder="Ej. viaje, trabajo, bebé"`, 'Sepáralas con comas. Sirven para buscar y saber cuánto gastaste en algo.')}
    <datalist id="tags-usadas">${etiquetasUsadas().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <p class="hint">¿Ahorro, pago de tarjeta o traspaso entre cuentas? Regístralos desde Ahorro, Deudas o "Mis cuentas".</p>
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const datos = { tipo: d.tipo, monto, cat: d.cat, fecha: d.fecha, nota: d.nota.trim(), tags: leerEtiquetas(d.tags) };
    let x = mov;
    if (x) Object.assign(x, datos); else { x = { id: uid(), ...datos }; S.movs.push(x); }
    aplicarMedio(x, d.medio);
    syncCargo(x);
    if (d.tipo === 'gasto') S.ajustes.ultimoMedio = d.medio;
    per = periodoDe(d.fecha);
    toast(mov ? 'Movimiento actualizado' : (d.tipo === 'ingreso' ? '💰 Ingreso registrado' : x.tarjetaId ? '💳 Gasto con tarjeta registrado' : '🧾 Gasto registrado'));
  });
  const selMedio = $('#sel-medio');
  $$('#dlg-body input[name=tipo]').forEach(r => r.onchange = () => {
    $('#sel-cat').innerHTML = opciones(catsDe(r.value));
    $('#lbl-medio').textContent = lblMedio(r.value);
    selMedio.innerHTML = opcionesMedio(r.value === 'ingreso' ? medioDefault(true) : selMedio.value, r.value === 'gasto');
    $('#hint-medio').hidden = !selMedio.value.startsWith('t:');
  });
  selMedio.onchange = () => { $('#hint-medio').hidden = !selMedio.value.startsWith('t:'); };
}

function formCuenta(cuenta) {
  const c = cuenta || { nombre: '', tipo: 'debito', saldoInicial: 0 };
  const saldo = cuenta ? saldoCuenta(cuenta) : '';
  const usada = cuenta && S.movs.some(m => m.cuentaId === cuenta.id || m.destinoId === cuenta.id);
  dialogo(cuenta ? 'Editar cuenta' : 'Nueva cuenta', `
    ${campo('Nombre', `name="nombre" required maxlength="30" value="${esc(c.nombre)}" placeholder="Ej. Nómina BBVA, Efectivo, Nu, Mercado Pago…"`)}
    <label class="campo">Tipo<select name="tipo">${Object.entries(TIPOS_CUENTA).map(([k, v]) => `<option value="${k}" ${k === c.tipo ? 'selected' : ''}>${ICON_CUENTA[k]} ${v}</option>`).join('')}</select></label>
    ${campo(cuenta ? 'Saldo real hoy' : 'Saldo actual', `name="saldo" type="number" inputmode="decimal" step="0.01" required value="${saldo === '' ? '' : saldo.toFixed(2)}"`,
      cuenta ? 'Si no coincide con tu banco, escribe el saldo real y la app se ajusta.' : 'Lo que tienes hoy en esta cuenta.')}
    ${cuenta && S.cuentas.length > 1 ? `<button type="button" class="btn mini peligro" data-action="borrar-cuenta" data-id="${cuenta.id}" ${usada ? 'disabled' : ''}>Eliminar cuenta</button>
      ${usada ? '<p class="hint">No se puede eliminar porque tiene movimientos.</p>' : ''}` : ''}
  `, d => {
    const nuevo = num(d.saldo);
    const datos = { nombre: d.nombre.trim(), tipo: d.tipo };
    if (cuenta) { Object.assign(cuenta, datos); cuenta.saldoInicial = nuevo - flujoCuenta(cuenta.id); }
    else S.cuentas.push({ id: uid(), ...datos, saldoInicial: nuevo });
    S.ajustes.cuentasRevisadas = true;
    toast(cuenta ? '🏦 Saldo ajustado' : '🏦 Cuenta agregada');
  });
}

function formTraspaso() {
  const [a, b] = S.cuentas;
  dialogo('Traspaso entre cuentas', `
    <div class="grid2">
      <label class="campo">De<select name="origen">${opcionesMedio('c:' + a.id, false)}</select></label>
      <label class="campo">A<select name="destino">${opcionesMedio('c:' + (b?.id || a.id), false)}</select></label>
    </div>
    ${campo('Monto', 'name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required')}
    <div class="grid2">
      ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
      ${campo('Nota (opcional)', 'name="nota" maxlength="80" placeholder="Ej. retiro en cajero"')}
    </div>
    <p class="hint">Un traspaso no es gasto ni ingreso: solo mueve dinero entre tus cuentas (ej. sacar efectivo del cajero).</p>
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    if (d.origen === d.destino) return toast('Elige dos cuentas distintas'), false;
    S.movs.push({ id: uid(), tipo: 'traspaso', monto, cat: 'Traspaso', fecha: d.fecha, nota: d.nota.trim(), cuentaId: d.origen.slice(2), destinoId: d.destino.slice(2) });
    toast('🔁 Traspaso registrado');
  }, 'Registrar');
}

// occ: la fecha concreta desde la que se abrió (para "Quitar solo esta vez")
function formFijo(fijo, occ) {
  const f = fijo ? { ...fijo } : { tipo: 'gasto', nombre: '', monto: '', cat: 'Vivienda', cuando: 'mensual', dia: '', diaSemana: 6 };
  if (f.cuando === 'q1' || f.cuando === 'q2') { f.dia = diaMensual(f); f.cuando = 'mensual'; } // formato anterior
  const semanal = f.cuando === 'semanal', mensual = f.cuando === 'mensual';
  // Fechas que se pueden quitar solo una vez (los semanales traen varias en la quincena)
  const omitibles = !fijo || !occ ? [] : occ.lista || (occ.pagado ? [] : [occ]);
  const catsGasto = CATS_GASTO;
  const medio = medioValido(f.medio) ? f.medio : medioDefault(f.tipo === 'ingreso');
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
    <label class="campo"><span id="lbl-medio-f">${f.tipo === 'ingreso' ? '¿A qué cuenta entra?' : '¿Con qué se paga?'}</span><select name="medio" id="sel-medio-f">${opcionesMedio(medio, f.tipo === 'gasto')}</select></label>
    ${fijo ? `<div class="acciones">
      ${omitibles.map(o => `<button type="button" class="btn mini sec" data-action="omitir-fijo" data-id="${fijo.id}" data-clave="${o.clave}">Quitar solo ${omitibles.length > 1 ? 'el ' : 'esta vez: '}${o.etiqueta}</button>`).join('')}
      <button type="button" class="btn mini peligro" data-action="borrar-fijo" data-id="${fijo.id}">Eliminar para siempre</button>
    </div>` : ''}
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const cuando = d.cuando;
    const dia = cuando === 'mensual' ? parseInt(d.dia) || null : null;
    if (cuando === 'mensual' && !dia) return toast('Indica el día del mes'), false;
    const datos = { tipo: d.tipo, nombre: d.nombre.trim(), monto, cat: d.tipo === 'ingreso' ? 'Sueldo' : d.cat, cuando, dia, diaSemana: cuando === 'semanal' ? +d.diaSemana : null, medio: d.medio };
    if (fijo) Object.assign(fijo, datos); else S.fijos.push({ id: uid(), ...datos, omitidos: [] });
    toast('📌 Fijo guardado');
  });
  $$('#dlg-body input[name=tipo]').forEach(r => r.onchange = () => {
    const ing = r.value === 'ingreso', sel = $('#sel-medio-f');
    $('#campo-cat').hidden = ing;
    $('#lbl-medio-f').textContent = ing ? '¿A qué cuenta entra?' : '¿Con qué se paga?';
    sel.innerHTML = opcionesMedio(ing ? medioDefault(true) : sel.value, !ing);
  });
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
  aplicarMedio(mov, f.medio || medioDefault(f.tipo === 'ingreso'));
  S.movs.push(mov);
  syncCargo(mov);
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
    <label class="campo">${retiro ? '¿A qué cuenta regresa el dinero?' : '¿De qué cuenta sale?'}<select name="medio">${opcionesMedio(medioDefault(true), false)}</select></label>
    ${retiro ? campo('Motivo', 'name="nota" maxlength="80" placeholder="Ej. reparación del auto"') : '<input type="hidden" name="nota" value="">'}
  `, d => {
    const monto = num(d.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    S.movs.push({ id: uid(), tipo: 'ahorro', monto: retiro ? -monto : monto, cat: meta.nombre, metaId: meta.id, fecha: d.fecha, nota: d.nota || (retiro ? 'Retiro' : 'Aportación'), cuentaId: d.medio.slice(2) });
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
      <label class="campo"><span id="lbl-minimo">Pago mínimo</span><input name="minimo" type="number" inputmode="decimal" min="0" step="0.01" required value="${d.minimo}"></label>
      <div class="solo-tarjeta">${campo('Límite de crédito', `name="limite" type="number" inputmode="decimal" min="0" step="0.01" value="${d.limite}"`, 'Opcional')}</div>
      <div class="solo-tarjeta">${campo('Día de corte', `name="diaCorte" type="number" min="1" max="31" value="${d.diaCorte}"`)}</div>
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
  // Préstamos: pago mensual fijo, sin límite ni fecha de corte
  const tipo = $('#dlg-body select[name=tipo]');
  const ajustar = () => {
    const tarjeta = tipo.value === 'tc' || tipo.value === 'dep';
    $('#lbl-minimo').textContent = tarjeta ? 'Pago mínimo' : 'Pago mensual fijo';
    $$('#dlg-body .solo-tarjeta').forEach(el => { el.hidden = !tarjeta; });
  };
  tipo.onchange = ajustar;
  ajustar();
}

function formMSI(compra) {
  const x = compra || { nombre: '', tarjetaId: '', monto: '', meses: 12, tasa: 0, primerMes: sumarMeses(hoyISO().slice(0, 7), 1), diaPago: '', inicial: 0 };
  const conInt = x.tasa > 0;
  dialogo(compra ? 'Editar compra a meses' : 'Nueva compra a meses', `
    ${campo('¿Qué compraste?', `name="nombre" required maxlength="40" value="${esc(x.nombre)}" placeholder="Ej. Pantalla, celular, refrigerador…"`)}
    <label class="campo">¿Con qué tarjeta?<select name="tarjetaId"><option value="">Sin tarjeta / crédito directo de tienda</option>${S.deudas.map(d => `<option value="${d.id}" ${d.id === x.tarjetaId ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}</select></label>
    <div class="segmento">
      <input type="radio" name="conInt" id="m-0" value="0" ${conInt ? '' : 'checked'}><label for="m-0" class="ing">Sin intereses (MSI)</label>
      <input type="radio" name="conInt" id="m-1" value="1" ${conInt ? 'checked' : ''}><label for="m-1" class="gas">Con intereses</label>
    </div>
    <div class="grid2">
      ${campo('Monto de la compra', `name="monto" type="number" inputmode="decimal" step="0.01" min="1" required value="${x.monto}"`)}
      ${campo('Número de meses', `name="meses" type="number" min="1" max="72" required list="plazos" value="${x.meses}"`)}
    </div>
    <datalist id="plazos"><option value="3"><option value="6"><option value="9"><option value="12"><option value="18"><option value="24"><option value="36"></datalist>
    <div id="campo-tasa" ${conInt ? '' : 'hidden'}>${campo('Tasa de interés anual %', `name="tasa" type="number" inputmode="decimal" step="0.01" min="0" max="300" value="${x.tasa || ''}"`, 'Viene en tu contrato o estado de cuenta')}</div>
    <div class="grid2">
      ${campo('Primera mensualidad', `name="primerMes" type="month" required value="${x.primerMes}"`)}
      ${campo('Día de pago', `name="diaPago" type="number" min="1" max="31" value="${x.diaPago || ''}"`, 'El de tu tarjeta')}
    </div>
    ${campo('Mensualidades ya pagadas', `name="inicial" type="number" min="0" max="72" value="${x.inicial}"`, 'Si la compra es de antes, cuántas llevas pagadas')}
    ${compra ? '' : `<label class="check"><input type="checkbox" name="comoGasto" checked> Contar la compra como gasto de hoy (no descuenta de tus cuentas)</label>
    <label class="campo">Categoría del gasto<select name="catGasto">${opciones(CATS_GASTO, 'Otros gastos')}</select>
      <span class="hint">Desmárcalo si la compra es de un mes anterior y ya la tenías registrada.</span></label>`}
    <div class="tip info" id="msi-prev"><span class="ic">🧮</span><div></div></div>
  `, d => {
    const monto = num(d.monto), meses = parseInt(d.meses) || 0, tasa = d.conInt === '1' ? num(d.tasa) : 0;
    if (monto <= 0 || meses < 1) return toast('Revisa el monto y los meses'), false;
    if (d.conInt === '1' && tasa <= 0) return toast('Indica la tasa de interés'), false;
    const tarjeta = S.deudas.find(t => t.id === d.tarjetaId);
    const datos = { nombre: d.nombre.trim(), tarjetaId: d.tarjetaId || null, monto, meses, tasa, primerMes: d.primerMes,
      diaPago: parseInt(d.diaPago) || tarjeta?.diaPago || 1, inicial: Math.min(parseInt(d.inicial) || 0, meses) };
    if (compra) Object.assign(compra, datos);
    else {
      const nueva = { id: uid(), ...datos, pagos: [] };
      S.msi.push(nueva);
      // El consumo ocurre al comprar; las mensualidades son pagos de esa deuda
      if (d.comoGasto) S.movs.push({ id: uid(), tipo: 'gasto', monto, cat: d.catGasto, fecha: hoyISO(), nota: `${datos.nombre} (a ${meses} meses)`, msiCompraId: nueva.id });
    }
    toast('🛍️ Compra a meses guardada');
  });
  // Vista previa en vivo de la mensualidad
  const body = $('#dlg-body');
  const val = n => body.querySelector(`[name=${n}]`);
  const previa = () => {
    const conI = body.querySelector('[name=conInt]:checked').value === '1';
    const c = { monto: num(val('monto').value), meses: parseInt(val('meses').value) || 0, tasa: conI ? num(val('tasa').value) : 0, primerMes: val('primerMes').value };
    const out = $('#msi-prev div');
    if (!c.monto || !c.meses || !c.primerMes) { out.textContent = 'Llena monto, meses y primera mensualidad para ver el cálculo.'; return; }
    const m = mensualidad(c), total = m * c.meses;
    out.innerHTML = `Mensualidad: <b>${fmt(m)}</b> (≈ ${fmt(m / 2)} por quincena). Terminas en <b>${nombrePeriodo(sumarMeses(c.primerMes, c.meses - 1))}</b>.`
      + (c.tasa ? `<br>Pagarás ${fmt(total)} en total: <b class="c-deuda">${fmt(total - c.monto)} de intereses</b>.` : '');
  };
  body.oninput = previa;
  body.onchange = e => {
    if (e.target.name === 'conInt') $('#campo-tasa').hidden = e.target.value !== '1';
    if (e.target.name === 'tarjetaId' && !val('diaPago').value) { const t = S.deudas.find(t => t.id === e.target.value); if (t?.diaPago) val('diaPago').value = t.diaPago; }
    previa();
  };
  previa();
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
    <label class="campo">¿De qué cuenta pagaste?<select name="medio">${opcionesMedio(medioDefault(true), false)}</select></label>
    <p class="hint">Pagar la tarjeta no es un gasto nuevo (el gasto fue cuando compraste): baja tu cuenta y baja la deuda.</p>
  `, f => {
    const monto = num(f.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const h = { id: uid(), fecha: f.fecha, tipo: 'pago', monto };
    d.hist.push(h);
    S.movs.push({ id: uid(), tipo: 'pago', monto, cat: 'Pago de deuda', fecha: f.fecha, nota: d.nombre, deudaId: d.id, histId: h.id, cuentaId: f.medio.slice(2) });
    toast(saldoDeuda(d) <= 0.5 ? `🎉 ¡Liquidaste ${d.nombre}!` : '✅ Pago registrado');
  }, 'Registrar pago');
  $$('#dlg-body [data-fill]').forEach(b => b.onclick = () => { $('#dlg-body input[name=monto]').value = b.dataset.fill; });
}

function formCargo(d) {
  dialogo(`Cargo a ${d.nombre}`, `
    <label class="campo">Tipo<select name="tipo"><option value="cargo">Compra con esta tarjeta</option><option value="interes">Intereses o comisiones del estado de cuenta</option></select></label>
    ${campo('Monto', 'name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required')}
    <label class="campo" id="campo-cat-cargo">Categoría<select name="cat">${opciones(CATS_GASTO.filter(c => c !== 'Intereses y comisiones'), 'Otros gastos')}</select></label>
    <div class="grid2">
      ${campo('Fecha', `name="fecha" type="date" required value="${hoyISO()}"`)}
      ${campo('Nota (opcional)', 'name="nota" maxlength="80"')}
    </div>
    <p class="hint">Se registra como gasto pagado con esta tarjeta: sube su saldo y no descuenta de tus cuentas. Consejo: mientras la estés liquidando, evita nuevas compras con ella.</p>
  `, f => {
    const monto = num(f.monto);
    if (monto <= 0) return toast('Ingresa un monto válido'), false;
    const m = { id: uid(), tipo: 'gasto', monto, cat: f.tipo === 'interes' ? 'Intereses y comisiones' : f.cat, fecha: f.fecha, nota: f.nota.trim() || d.nombre, tarjetaId: d.id };
    S.movs.push(m);
    syncCargo(m);
    toast('Cargo registrado');
  });
  const tipo = $('#dlg-body select[name=tipo]');
  tipo.onchange = () => { $('#campo-cat-cargo').hidden = tipo.value === 'interes'; };
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

async function exportar(pass) {
  const nombre = `mis-finanzas-respaldo-${hoyISO()}${pass ? '-protegido' : ''}.json`;
  S.ajustes.ultimoExport = new Date().toISOString();
  const contenido = JSON.stringify({ app: 'mis-finanzas', exportado: S.ajustes.ultimoExport, datos: S }, null, 1);
  const final = pass ? JSON.stringify({ app: 'mis-finanzas', cifrado: true, exportado: S.ajustes.ultimoExport, ...(await cifrar(contenido, pass)) }) : contenido;
  const blob = new Blob([final], { type: 'application/json' });
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
  if (d && !Array.isArray(d.msi)) d.msi = [];
  if (d && (typeof d.presupuestos !== 'object' || !d.presupuestos)) d.presupuestos = {};
  if (d && !Array.isArray(d.personas)) d.personas = [];
  if (d && (typeof d.historial !== 'object' || !d.historial)) d.historial = {};
  if (d && (typeof d.historialSalud !== 'object' || !d.historialSalud)) d.historialSalud = {};
  return d && Array.isArray(d.movs) && Array.isArray(d.metas) && Array.isArray(d.deudas) && typeof d.ajustes === 'object';
}
async function aplicarDatos(d, msg) {
  await puntoRestauracion('Antes de restaurar');
  S = migrar({ ...estadoVacio(), ...structuredClone(d), ajustes: { ...estadoVacio().ajustes, ...d.ajustes } });
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
    const extra = m.histId || m.pagoId ? 'También se quitará el pago del historial de la deuda.' : m.tarjetaId ? 'También se quitará el cargo de la tarjeta.' : '';
    confirmar('Eliminar movimiento', `¿Eliminar <b>${esc(m.cat)}</b> por ${fmt(Math.abs(m.monto))}?${extra ? `<br><span class="small muted">${extra}</span>` : ''}`, () => quitarMov(m));
  },
  presupuesto: () => formPresupuesto(),
  'exportar-csv': el => exportarCSV(el.dataset.v),
  'nueva-persona': () => formPersona(),
  'abono-persona': el => formAbonoPersona(buscarId(S.personas, el.dataset.id)),
  'borrar-persona': el => {
    const p = buscarId(S.personas, el.dataset.id);
    confirmar('Eliminar', `¿Quitar a <b>${esc(p.nombre)}</b> de la lista? Los movimientos de dinero se conservan.`, () => { S.personas = S.personas.filter(x => x !== p); });
  },
  'nueva-cuenta': () => formCuenta(),
  'editar-cuenta': el => formCuenta(buscarId(S.cuentas, el.dataset.id)),
  'borrar-cuenta': el => {
    const c = buscarId(S.cuentas, el.dataset.id);
    $('#dlg').close();
    confirmar('Eliminar cuenta', `¿Eliminar la cuenta <b>${esc(c.nombre)}</b>?`, () => {
      S.cuentas = S.cuentas.filter(x => x !== c);
      S.fijos.forEach(f => { if (f.medio === 'c:' + c.id) delete f.medio; });
    });
  },
  traspaso: () => formTraspaso(),
  filtro: el => { filtroMov = el.dataset.v; render(); },
  'filtro-tag': el => { filtroTag = el.dataset.v; vista = 'movs'; render(); window.scrollTo(0, 0); },
  'mes-prev': () => cambiarMes(-1),
  'mes-next': () => cambiarMes(1),
  'buscar-actualizacion': buscarActualizacion,
  'ver-novedades': () => mostrarNovedades(null),
  'actualizar-ya': () => location.reload(),
  'cerrar-banner': () => $('#banner-act')?.remove(),
  'per-hoy': () => { per = periodoDe(hoyISO()); render(); },
  'nuevo-fijo': () => formFijo(),
  'editar-fijo': el => {
    const f = buscarId(S.fijos, el.dataset.id);
    const { clave, etiqueta, pagado, q } = el.dataset;
    if (f.cuando === 'semanal' && q) {
      const lista = compromisos(q)[0].fijos.filter(o => o.f === f && !o.mov)
        .map(o => ({ clave: o.clave, etiqueta: `${DIAS[f.diaSemana].slice(0, 3)} ${+o.fecha.slice(8, 10)}` }));
      return formFijo(f, { lista });
    }
    formFijo(f, clave ? { clave, etiqueta, pagado: pagado === '1' } : null);
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
    if (mov) { quitarMov(mov); toast('Desmarcado'); }
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
  'editar-meta': el => { const m = buscarId(S.metas, el.dataset.id); m.anual ? formPrevision(m) : formMeta(m); },
  'nueva-prevision': el => formPrevision(null, { nombre: el.dataset.nombre, mes: el.dataset.mes }),
  'pagar-prevision': el => formPagarPrevision(buscarId(S.metas, el.dataset.id)),
  'borrar-meta': el => {
    const m = buscarId(S.metas, el.dataset.id);
    $('#dlg').close();
    confirmar('Eliminar meta', `¿Eliminar <b>${esc(m.nombre)}</b> y sus aportaciones registradas?`, () => {
      S.metas = S.metas.filter(x => x !== m); S.movs = S.movs.filter(x => x.metaId !== m.id);
    });
  },
  aportar: el => formAporte(buscarId(S.metas, el.dataset.id), false),
  retirar: el => formAporte(buscarId(S.metas, el.dataset.id), true),
  'nuevo-msi': () => formMSI(),
  'editar-msi': el => formMSI(buscarId(S.msi, el.dataset.id)),
  'pagar-msi': el => {
    const c = buscarId(S.msi, el.dataset.id);
    const ym = siguienteMesMSI(c);
    if (!ym) return toast('Esta compra ya está pagada');
    pagarMSI(c, ym, hoyISO());
    guardar(); render();
    toast(restantesMSI(c) ? `✅ Mensualidad ${mesesEntre(c.primerMes, ym) + 1} de ${c.meses} registrada` : `🎉 ¡Terminaste de pagar ${c.nombre}!`);
  },
  'marcar-msi': el => {
    const c = buscarId(S.msi, el.dataset.id), ym = el.dataset.mes;
    if (c.pagos.some(p => p.mes === ym)) { quitarPagoMSI(c, ym); toast('Desmarcado'); }
    else {
      const f = fechaFijo({ dia: c.diaPago }, rango(el.dataset.q));
      pagarMSI(c, ym, f > hoyISO() ? hoyISO() : f); // si pagas por adelantado, la fecha es hoy
      toast(`✅ ${c.nombre}: mensualidad pagada`);
    }
    guardar(); render();
  },
  'borrar-msi': el => {
    const c = buscarId(S.msi, el.dataset.id);
    confirmar('Eliminar compra a meses', `¿Eliminar <b>${esc(c.nombre)}</b>? Los pagos ya registrados como gasto se conservan.`, () => {
      S.msi = S.msi.filter(x => x !== c);
      S.movs.forEach(m => { if (m.msiId === c.id) { delete m.msiId; delete m.pagoId; } });
    });
  },
  'nueva-deuda': () => formDeuda(),
  'editar-deuda': el => formDeuda(buscarId(S.deudas, el.dataset.id)),
  'pagar-deuda': el => formPago(buscarId(S.deudas, el.dataset.id)),
  'cargo-deuda': el => formCargo(buscarId(S.deudas, el.dataset.id)),
  'borrar-deuda': el => {
    const d = buscarId(S.deudas, el.dataset.id);
    confirmar('Eliminar deuda', `¿Eliminar <b>${esc(d.nombre)}</b>? Los pagos ya registrados como gasto se conservan.`, () => {
      S.deudas = S.deudas.filter(x => x !== d);
      S.movs.forEach(m => { if (m.deudaId === d.id) { delete m.deudaId; delete m.histId; } });
      S.msi.forEach(c => { if (c.tarjetaId === d.id) c.tarjetaId = null; });
    });
  },
  estrategia: el => { S.ajustes.estrategia = el.dataset.v; guardar(); render(); },
  'plan-meses': el => {
    const v = +el.dataset.v;
    // Al pasar a "Yo digo cuánto", parte del monto que se estaba mostrando
    if (!v && metaPlan()) S.ajustes.presupuestoDeuda = presupuestoPara(metaPlan(), S.ajustes.estrategia);
    S.ajustes.planMeses = v; guardar(); render();
  },
  exportar: () => formExportar(),
  'poner-pin': () => formPIN(false),
  'cambiar-pin': () => formPIN(true),
  'quitar-pin': () => formQuitarPIN(),
  huella: async () => {
    if (PIN.bio) { delete PIN.bio; await DB.escribirClave('pin', PIN); render(); pintarRespaldos(); return toast('Huella / rostro desactivado'); }
    try { await registrarHuella(); render(); pintarRespaldos(); toast('👆 Huella / rostro activado'); }
    catch { toast('No se pudo activar. Revisa que tu teléfono tenga huella o rostro configurado.'); }
  },
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
    setTimeout(async () => { await puntoRestauracion('Antes de borrar todo'); S = migrar(estadoVacio()); await DB.escribir(S); render(); pintarRespaldos(); toast('Datos borrados'); });
  }, 'Borrar todo'),
  'cerrar-dlg': () => $('#dlg').close(),
};

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { vista = tab.dataset.tab; render(); window.scrollTo(0, 0); if (vista === 'ajustes') pintarRespaldos(); return; }
  const el = e.target.closest('[data-action]');
  if (el && ACCIONES[el.dataset.action] && el.type !== 'checkbox') { ACCIONES[el.dataset.action](el); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'buscar') { busqueda = e.target.value; refrescarLista(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'filtro-cat') { filtroCat = e.target.value; refrescarLista(); }
  if (e.target.id === 'filtro-tag') { filtroTag = e.target.value; refrescarLista(); }
  if (e.target.dataset.action === 'toggle-iva') ACCIONES['toggle-iva'](e.target);
  if (e.target.id === 'presupuesto') { S.ajustes.presupuestoDeuda = num(e.target.value); guardar(); render(); }
  if (e.target.id === 'archivo') {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then(txt => {
      const j = JSON.parse(txt);
      if (j.cifrado) pedirClaveRespaldo(j); else procesarRespaldo(j);
    }).catch(() => toast('⚠️ El archivo no es un respaldo válido'));
  }
});

function cambiarMes(delta) { per = moverPeriodo(per, delta); render(); }

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Seguridad: PIN, huella y respaldos cifrados ---------- */
// Nota: el PIN bloquea la pantalla; los datos en el dispositivo no se cifran (seguirían legibles con acceso técnico).
let PIN = null;            // { salt, hash, bio? } — solo se guarda el hash del PIN
let bioDisponible = false; // el teléfono tiene huella / rostro
let ocultaDesde = null;
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const deb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derivar(secreto, salt, uso) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const algo = { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' };
  if (uso === 'bits') return b64(await crypto.subtle.deriveBits(algo, base, 256));
  return crypto.subtle.deriveKey(algo, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const pinCorrecto = async v => !!PIN && await derivar(v, deb64(PIN.salt), 'bits') === PIN.hash;
async function guardarPIN(v) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  PIN = { ...(PIN || {}), salt: b64(salt), hash: await derivar(v, salt, 'bits') };
  await DB.escribirClave('pin', PIN);
}

async function cifrar(texto, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derivar(pass, salt, 'key'), new TextEncoder().encode(texto));
  return { salt: b64(salt), iv: b64(iv), datos: b64(ct) };
}
async function descifrar(o, pass) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deb64(o.iv) }, await derivar(pass, deb64(o.salt), 'key'), deb64(o.datos));
  return new TextDecoder().decode(pt);
}

// Huella / rostro con el autenticador del teléfono (WebAuthn, sin servidor: solo desbloquea la pantalla)
async function registrarHuella() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Mis Finanzas' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'mis-finanzas', displayName: 'Mis Finanzas' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000,
  } });
  PIN.bio = b64(cred.rawId);
  await DB.escribirClave('pin', PIN);
}
async function verificarHuella() {
  try {
    await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: deb64(PIN.bio) }], userVerification: 'required', timeout: 60000 } });
    return true;
  } catch { return false; }
}

function mostrarBloqueo() {
  return new Promise(resolve => {
    if ($('#bloqueo')) return;
    if ($('#dlg').open) $('#dlg').close();
    document.body.classList.add('bloqueada');
    const el = document.createElement('div');
    el.id = 'bloqueo';
    el.innerHTML = `<form class="caja" autocomplete="off">
      <div style="font-size:2.6rem">🔒</div><h2 style="margin:6px 0 2px">Mis Finanzas</h2><p class="muted small">Escribe tu PIN</p>
      <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" id="pin-in" aria-label="PIN" autocomplete="off">
      <p id="pin-err" class="small" style="color:var(--deuda);min-height:1.3em"></p>
      <button class="btn" type="submit" style="width:100%">Entrar</button>
      ${PIN.bio ? '<button class="btn sec" type="button" id="pin-bio" style="width:100%;margin-top:8px">👆 Usar huella / rostro</button>' : ''}
      <button class="link-btn small" type="button" id="pin-olvide" style="margin-top:16px">Olvidé mi PIN</button>
    </form>`;
    document.body.append(el);
    const inp = el.querySelector('#pin-in'), err = el.querySelector('#pin-err');
    let fallos = 0, esperaHasta = 0;
    const abrir = () => { el.remove(); document.body.classList.remove('bloqueada'); resolve(); };
    el.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      if (Date.now() < esperaHasta) { err.textContent = `Espera ${Math.ceil((esperaHasta - Date.now()) / 1000)} s`; return; }
      if (await pinCorrecto(inp.value)) return abrir();
      inp.value = '';
      if (++fallos >= 5) { fallos = 0; esperaHasta = Date.now() + 30000; err.textContent = 'Demasiados intentos. Espera 30 segundos.'; }
      else err.textContent = 'PIN incorrecto';
    };
    el.querySelector('#pin-bio')?.addEventListener('click', async () => { if (await verificarHuella()) abrir(); else err.textContent = 'No se pudo verificar. Usa tu PIN.'; });
    el.querySelector('#pin-olvide').onclick = async () => {
      if (!confirm('Sin el PIN no hay forma de ver tus datos.\n\n¿Borrar TODOS los datos de la app (incluidos los respaldos internos) para empezar de nuevo? Después podrás importar tu archivo de respaldo si tienes uno.')) return;
      if (!confirm('¿Seguro? Esto no se puede deshacer.')) return;
      S = migrar(estadoVacio());
      await DB.escribir(S); await DB.borrarRespaldos(); await DB.borrarClave('pin');
      PIN = null; abrir(); render(); toast('Datos borrados. Puedes restaurar tu archivo en Ajustes.');
    };
    setTimeout(() => inp.focus(), 50);
  });
}
// Oculta la app al salir y pide PIN si pasó más de 1 minuto
document.addEventListener('visibilitychange', () => {
  if (!PIN) return;
  if (document.hidden) { ocultaDesde = Date.now(); document.body.classList.add('bloqueada'); }
  else if (ocultaDesde && Date.now() - ocultaDesde > 60000) mostrarBloqueo();
  else if (!$('#bloqueo')) document.body.classList.remove('bloqueada');
});

function formPIN(cambiar) {
  dialogo(cambiar ? 'Cambiar PIN' : 'Poner PIN', `
    ${cambiar ? campo('PIN actual', 'name="actual" type="password" inputmode="numeric" maxlength="8" required autocomplete="off"') : ''}
    <div class="grid2">
      ${campo('Nuevo PIN', 'name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" required autocomplete="off"', '4 a 8 números')}
      ${campo('Repítelo', 'name="pin2" type="password" inputmode="numeric" maxlength="8" required autocomplete="off"')}
    </div>
    <p class="hint">Si olvidas el PIN, la única salida es borrar los datos de la app. Exporta un archivo de respaldo por si acaso.</p>
  `, d => {
    if (!/^\d{4,8}$/.test(d.pin)) return toast('El PIN debe tener de 4 a 8 números'), false;
    if (d.pin !== d.pin2) return toast('Los PIN no coinciden'), false;
    (async () => {
      if (cambiar && !(await pinCorrecto(d.actual))) return toast('PIN actual incorrecto');
      await guardarPIN(d.pin); render(); pintarRespaldos();
      toast(cambiar ? '🔒 PIN cambiado' : '🔒 PIN activado');
    })();
  });
}
function formQuitarPIN() {
  dialogo('Quitar PIN', campo('PIN actual', 'name="actual" type="password" inputmode="numeric" maxlength="8" required autocomplete="off"'), d => {
    (async () => {
      if (!(await pinCorrecto(d.actual))) return toast('PIN incorrecto');
      await DB.borrarClave('pin'); PIN = null; render(); pintarRespaldos(); toast('PIN quitado');
    })();
  }, 'Quitar');
}

// Exportar con contraseña opcional
function formExportar() {
  dialogo('Exportar archivo de respaldo', `
    <p class="small muted" style="margin-top:-6px">Se guarda un archivo en tu dispositivo con todos tus datos.</p>
    <div class="grid2">
      ${campo('Contraseña (opcional)', 'name="pass" type="password" autocomplete="new-password"')}
      ${campo('Repítela', 'name="pass2" type="password" autocomplete="new-password"')}
    </div>
    <p class="hint">Con contraseña, el archivo va cifrado y nadie puede leerlo sin ella. Si la olvidas, no hay forma de recuperarlo.</p>
  `, d => {
    if (d.pass !== d.pass2) return toast('Las contraseñas no coinciden'), false;
    setTimeout(() => exportar(d.pass));
  }, 'Exportar');
}
function procesarRespaldo(j) {
  const d = j.datos || j;
  if (!validarDatos(d)) return toast('⚠️ El archivo no es un respaldo válido');
  confirmar('Restaurar desde archivo', `El archivo contiene ${d.movs.length} movimientos, ${d.metas.length} metas y ${d.deudas.length} deudas. Reemplazará tus datos actuales (se guardará un punto de restauración antes).`, () => {
    setTimeout(() => aplicarDatos(d, '✅ Respaldo importado'));
  }, 'Restaurar');
}
function pedirClaveRespaldo(j) {
  dialogo('Respaldo protegido', campo('Contraseña del respaldo', 'name="pass" type="password" required autocomplete="off"'), d => {
    descifrar(j, d.pass)
      .then(t => setTimeout(() => procesarRespaldo(JSON.parse(t)), 50))
      .catch(() => toast('⚠️ Contraseña incorrecta'));
  }, 'Abrir');
}

/* ---------- PWA ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (vista === 'ajustes') { render(); pintarRespaldos(); } });

async function iniciar() {
  try {
    await DB.abrir();
    const guardado = await DB.leer();
    if (guardado && validarDatos(guardado)) S = { ...estadoVacio(), ...guardado, ajustes: { ...estadoVacio().ajustes, ...guardado.ajustes } };
    migrar(S);
    per = periodoDe(hoyISO());
    await respaldoAutomatico();
  } catch (e) {
    toast('⚠️ Tu navegador no permite guardar datos (¿modo incógnito?)');
  }
  // Pide al navegador que no borre los datos por falta de espacio
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  try { PIN = (await DB.leerClave('pin')) || null; } catch { PIN = null; }
  try { bioDisponible = !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { bioDisponible = false; }
  if (PIN) await mostrarBloqueo(); // nada de tus datos se muestra antes de desbloquear
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
  // Solo avisa si la versión instalada es más nueva que la que se está viendo
  // (con "red primero" casi siempre ya estás en la última y el aviso sobraba)
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!teniaControl) return;
    const remota = await versionPublicada();
    if (remota && compararVersion(remota, VERSION) > 0) bannerActualizacion(remota);
  });
}
async function versionPublicada() {
  try {
    const txt = await (await fetch('version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    return (txt.match(/VERSION = '([0-9.]+)'/) || [])[1] || null;
  } catch { return null; }
}

function bannerActualizacion(v) {
  if ($('#banner-act')) return;
  const b = document.createElement('div');
  b.id = 'banner-act';
  b.innerHTML = `<span>🔄 Hay una versión nueva${v ? ' (v' + esc(v) + ')' : ''} lista.</span>
    <span style="display:flex;gap:4px;align-items:center"><button class="btn mini" data-action="actualizar-ya">Actualizar</button>
    <button class="cerrar-banner" data-action="cerrar-banner" aria-label="Cerrar aviso">✕</button></span>`;
  document.body.append(b);
}

async function buscarActualizacion() {
  if (!navigator.onLine) return toast('Sin internet: conéctate para buscar actualizaciones');
  toast('Buscando actualización…');
  const remota = await versionPublicada();
  if (!remota) return toast('No se pudo revisar. Intenta más tarde.');
  if (compararVersion(remota, VERSION) > 0) {
    await swReg?.update().catch(() => {});
    bannerActualizacion(remota);
    toast(`Hay una versión nueva: v${remota}`);
  } else toast(`✅ Tienes la versión más reciente (v${VERSION})`);
}
iniciar();
