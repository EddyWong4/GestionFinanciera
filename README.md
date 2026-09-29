# Mis Finanzas — Gestión Financiera (PWA)

App web progresiva para llevar tus finanzas personales **por quincena**, que funciona **sin internet** y guarda todo **solo en tu dispositivo** (sin cuentas ni base de datos en la nube).

## Funciones
- **Movimientos:** ingresos y gastos por categoría, organizados por quincena (1–15 y 16–fin de mes) o por mes.
- **Fijos de la quincena y semanales:** renta, luz, colegiaturas, sueldo, súper de cada sábado… aparecen cada quincena como lista para marcar con un toque, y muestra cuánto te quedará libre.
- **Ahorro:** metas (p. ej. fondo de emergencia) con aportaciones, retiros y cuánto apartar por quincena.
- **Deudas:** tarjetas de crédito y departamentales, con intereses (+IVA), fechas de corte/pago, uso de línea y un **plan de liquidación** (avalancha o bola de nieve) comparado contra pagar solo el mínimo.
- **Asesor:** consejos automáticos según tus números (regla 50/30/20, fondo de emergencia, pagos mínimos que no cubren intereses, etc.).

## Datos y respaldos
- Los datos se guardan en IndexedDB del navegador/dispositivo.
- Respaldo automático diario interno (últimos 14 días) y puntos de restauración manuales.
- Exportar / importar un archivo `.json` de respaldo al almacenamiento del dispositivo.

## Uso
Es un sitio estático (HTML + CSS + JS, sin compilación). Para instalarla como app en el teléfono debe servirse por **HTTPS** (por ejemplo, GitHub Pages). En local:

```bash
npx http-server . -p 5190
```

Luego abre `http://localhost:5190` y, en Chrome, menú ⋮ → "Instalar app".
