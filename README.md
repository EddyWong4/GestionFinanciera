# Mis Finanzas — Gestión Financiera (PWA)

App web progresiva para llevar tus finanzas personales **por quincena**, que funciona **sin internet** y guarda todo **solo en tu dispositivo** (sin cuentas ni base de datos en la nube).

App publicada: https://eddywong4.github.io/GestionFinanciera/

## Funciones
- **Cuentas:** efectivo, débito/nómina y ahorro con su saldo real; traspasos entre cuentas. Cada movimiento dice con qué se pagó (cuenta o tarjeta de crédito), sin contar dos veces las compras con tarjeta.
- **Movimientos:** ingresos y gastos por categoría, por quincena (1–15 y 16–fin de mes) o por mes; buscador, filtros y etiquetas.
- **Fijos:** mensuales, quincenales y semanales, como lista para marcar cada quincena, con cuánto te quedará libre.
- **Presupuesto por categoría** por quincena, con alertas al 80% y al pasarte, y sugerencia según tu historial.
- **Próximas quincenas:** proyección de 6 quincenas y aviso de las que se ven apretadas.
- **Próximos pagos:** lo que vence en los próximos 7 días.
- **Ahorro:** metas (fondo de emergencia…) y **gastos del año** (predial, tenencia, seguro, inscripciones…) con cuánto apartar por quincena.
- **Deudas:** tarjetas de crédito y departamentales, préstamos (personal, automotriz, hipotecario), compras a meses (MSI o con intereses) y préstamos entre personas. Intereses con IVA, fechas de corte/pago, uso de línea y **plan de liquidación** (avalancha o bola de nieve).
- **Reportes:** patrimonio neto y su evolución, comparativo mes contra mes, tu año por categoría y exportación a Excel (CSV).
- **Asesor:** consejos automáticos (50/30/20, fondo de emergencia, presupuesto, deudas, aguinaldo…).

## Datos, respaldos y seguridad
- Los datos se guardan en IndexedDB del dispositivo.
- Respaldo automático diario interno (últimos 14 días) y puntos de restauración manuales.
- Exportar / importar un archivo `.json`, opcionalmente **cifrado con contraseña** (AES-GCM).
- PIN para abrir la app (y huella / rostro si el teléfono lo permite).

## Uso
Es un sitio estático (HTML + CSS + JS, sin compilación). Para instalarla como app en el teléfono debe servirse por **HTTPS** (por ejemplo, GitHub Pages). En local:

```bash
npx http-server . -p 5190
```

Luego abre `http://localhost:5190` y, en Chrome, menú ⋮ → "Instalar app".

## Versiones
La versión y sus novedades están en `version.js`; al publicar un cambio se sube `VERSION` para que la app instalada se actualice y muestre qué hay de nuevo.
