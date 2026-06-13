"""
Totaliza los pagos con tarjeta (TPV) HUÉRFANOS (pedidos card sin fila en Payment).
Datos de entrada: tmp_tpv_orphans.txt -> id,orderNum,total,metodo,updatedAt

Objetivo: cifra única de "TPV histórico no conciliado hasta el 19/03/2026".
La fecha de la última columna es order.updatedAt (proxy). Por eso totalizamos
de dos formas para comparar:
  A) Por updatedAt (lo que muestra el listado)
  B) Por año del orderNum (TPV/AAAA/####) -> independiente de updatedAt
"""
from datetime import datetime
from collections import defaultdict
import os

BASE = os.path.dirname(__file__)
SRC = os.path.join(BASE, "tmp_tpv_orphans.txt")
CUTOFF = datetime(2026, 3, 19, 0, 0, 0)

rows = []
with open(SRC, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        parts = line.split(",")
        oid, ordernum, total, method, dt = parts[0], parts[1], parts[2], parts[3], parts[4]
        updated = datetime.strptime(dt.split(".")[0], "%Y-%m-%d %H:%M:%S")
        year_ordernum = ordernum.split("/")[1]  # TPV/2025/0095 -> 2025
        rows.append({
            "id": oid, "ordernum": ordernum, "total": float(total),
            "updated": updated, "year_on": year_ordernum,
        })

n = len(rows)
grand = sum(r["total"] for r in rows)

# A) por updatedAt respecto al corte 19/03/2026
before = [r for r in rows if r["updated"] < CUTOFF]
after = [r for r in rows if r["updated"] >= CUTOFF]
sum_before = sum(r["total"] for r in before)
sum_after = sum(r["total"] for r in after)

# B) por año del orderNum
by_year = defaultdict(lambda: [0, 0.0])
for r in rows:
    by_year[r["year_on"]][0] += 1
    by_year[r["year_on"]][1] += r["total"]

# Desglose por mes de updatedAt (solo los anteriores al corte)
by_month = defaultdict(lambda: [0, 0.0])
for r in before:
    key = r["updated"].strftime("%Y-%m")
    by_month[key][0] += 1
    by_month[key][1] += r["total"]

print("=" * 60)
print(f"TOTAL pedidos card huérfanos (sin Payment): {n}")
print(f"IMPORTE TOTAL (todos):                      {grand:,.2f} EUR")
print("=" * 60)
print("\nA) Corte por updatedAt = 19/03/2026")
print(f"  Antes del 19/03  : {len(before):>4} pedidos  ->  {sum_before:,.2f} EUR")
print(f"  19/03 o después  : {len(after):>4} pedidos  ->  {sum_after:,.2f} EUR")

print("\nB) Por AÑO del orderNum (independiente de updatedAt)")
for y in sorted(by_year):
    c, s = by_year[y]
    print(f"  {y}: {c:>4} pedidos  ->  {s:,.2f} EUR")

print("\nDesglose por mes (updatedAt, solo anteriores al corte)")
for k in sorted(by_month):
    c, s = by_month[k]
    print(f"  {k}: {c:>4} pedidos  ->  {s:,.2f} EUR")

print("\nPedidos con updatedAt >= 19/03/2026 (revisar: caen tras el corte):")
for r in sorted(after, key=lambda x: x["updated"]):
    print(f"  {r['updated']}  {r['ordernum']:<16} {r['total']:>8.2f}  (id {r['id']})")

