#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera `Organizacion_Posada_2026.xlsx`: herramienta de decisión, votación y
cotización para la posada 2026 (11 amigos + parejas).

Uso:
    python scripts/generar_organizacion_posada.py [ruta_de_salida.xlsx]

Por defecto escribe `Organizacion_Posada_2026.xlsx` en el directorio actual.
Requiere: openpyxl  (pip install openpyxl)

Pestañas (todas interconectadas con fórmulas):
    1. Dashboard_Resumen        parámetros, KPIs, resumen financiero, decisiones, cobranza
    2. Encuesta_y_Opciones      matriz de votación A/B/C por rubro + opción ganadora
    3. Cotizador_Alcohol        HEB vs Soriana, subtotales, gran total, rendimiento
    4. Presupuesto_Detallado    gastos por categoría, imprevistos y gran total
    5. Lista_Invitados_y_Pagos  asistencia, cuotas, anticipos y saldos
    6. Checklist_Logistica      plan cronológico con fechas límite automáticas
"""
from __future__ import annotations

import math
import sys
from collections import defaultdict
from copy import copy
from datetime import date, datetime, time

from openpyxl import Workbook
from openpyxl.cell.cell import MergedCell
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import column_index_from_string, get_column_letter, range_boundaries
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet.datavalidation import DataValidation

OUTPUT = sys.argv[1] if len(sys.argv) > 1 else "Organizacion_Posada_2026.xlsx"

# --------------------------------------------------------------------------------------
# Nombres de pestañas y celdas compartidas
# --------------------------------------------------------------------------------------
DB = "Dashboard_Resumen"
EN = "Encuesta_y_Opciones"
CA = "Cotizador_Alcohol"
PD = "Presupuesto_Detallado"
LI = "Lista_Invitados_y_Pagos"
CL = "Checklist_Logistica"

# Celdas fijas del Dashboard que usan las demás pestañas
DB_ASIST = f"{DB}!$B$8"       # Total de asistentes
DB_FECHA = f"{DB}!$B$10"      # Fecha del evento
DB_COSTO_IND = f"{DB}!$F$7"   # Costo individual

# Rango fijo de la lista de invitados (11 amigos + 3 filas libres)
LI_FIRST, LI_LAST, LI_TOTAL = 6, 19, 20
LI_NAMES = f"{LI}!$A${LI_FIRST}:$A${LI_LAST}"
LI_DRINK = f"{LI}!$I${LI_FIRST}:$I${LI_LAST}"

# --------------------------------------------------------------------------------------
# Paleta (azul marino / gris pizarra con acentos verde bosque y dorado)
# --------------------------------------------------------------------------------------
NAVY = "1B2A41"
SLATE = "3E4C5E"
SLATE_TXT = "4A5568"
BAND = "E4E9F0"
ZEBRA = "F6F8FA"
SUBTLE = "EEF1F5"
CREAM = "FFF4CC"          # celdas editables
GOLD = "C9A227"
GOLD_LIGHT = "F7EFD6"
GOLD_TXT = "E3C15A"
FOREST = "2D6A4F"
WHITE = "FFFFFF"
INK = "1F2933"
INPUT_BLUE = "0000FF"     # texto de captura / datos de referencia
LINK_GREEN = "1E7B34"     # vínculos a otra pestaña
GRID = "D5DBE3"
OK_FILL, OK_TXT = "D8F0E1", "1E5631"
WARN_FILL, WARN_TXT = "FFEBC2", "8A5A00"
BAD_FILL, BAD_TXT = "F8D7DA", "9B1C1C"
INFO_FILL, INFO_TXT = "DCE6F2", "1B2A41"
MUTED_FILL, MUTED_TXT = "ECEFF3", "5F6B7A"

MONEY = "$#,##0.00"
PCT = "0.0%"
INT = "#,##0"
DATE = "dd/mm/yyyy"
HOUR = "hh:mm"
DAYS = '0 "días"'
DEC1 = "0.0"

THIN = Side(style="thin", color=GRID)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HDR_SIDE = Side(style="thin", color="5A6B7F")
HDR_BORDER = Border(left=HDR_SIDE, right=HDR_SIDE, top=HDR_SIDE,
                    bottom=Side(style="medium", color=GOLD))

HINTS: dict = {}      # (hoja, celda) -> largo estimado del texto mostrado
HEADERS: set = set()  # celdas de encabezado (pueden partirse en 2 renglones)
NOFIT: set = set()    # celdas que no influyen en el ancho (leyenda)


# --------------------------------------------------------------------------------------
# Utilidades de estilo
# --------------------------------------------------------------------------------------
def _font(size=10, bold=False, italic=False, color=INK):
    return Font(name="Arial", size=size, bold=bold, italic=italic, color=color)


def _fill(color):
    return PatternFill(fill_type="solid", start_color=color, end_color=color)


def put(ws, ref, value=None, kind="text", fmt=None, bold=False, italic=False, size=10,
        h=None, wrap=False, est=None, color=None, bg=None, border=True, indent=0):
    """Escribe y da formato a una celda.

    kind: text | calc (fórmula) | input (editable, crema) | ref (dato de referencia, azul)
          | link (vínculo a otra pestaña, verde)
    """
    c = ws[ref]
    c.value = value
    txt_color = {"input": INPUT_BLUE, "ref": INPUT_BLUE, "link": LINK_GREEN}.get(kind, INK)
    c.font = _font(size, bold, italic, color or txt_color)
    fill_color = bg or (CREAM if kind == "input" else None)
    if fill_color:
        c.fill = _fill(fill_color)
    if fmt:
        c.number_format = fmt
    if h is None:
        numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
        h = "right" if (fmt or numeric) else "left"
    c.alignment = Alignment(horizontal=h, vertical="center", wrap_text=wrap, indent=indent)
    if border:
        c.border = BOX
    if est is not None:
        HINTS[(ws.title, c.coordinate)] = est
    return c


def merge(ws, rng, value=None, **kw):
    ws.merge_cells(rng)
    min_col, min_row, max_col, max_row = range_boundaries(rng)
    anchor = ws.cell(min_row, min_col)
    c = put(ws, anchor.coordinate, value, **kw)
    for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
        for cell in row:
            if kw.get("border", True):
                cell.border = BOX
            if c.fill is not None and c.fill.fill_type:
                cell.fill = copy(c.fill)
    return c


def section(ws, rng, text):
    merge(ws, rng, text, bold=True, size=11, color=WHITE, bg=NAVY, h="left", indent=1,
          border=False)
    min_col, min_row, max_col, _ = range_boundaries(rng)
    for col in range(min_col, max_col + 1):
        ws.cell(min_row, col).border = Border(bottom=Side(style="medium", color=GOLD))
    ws.row_dimensions[min_row].height = 22


def header_cells(ws, row, labels, start_col=1, bg=SLATE, color=WHITE):
    for i, label in enumerate(labels):
        ref = f"{get_column_letter(start_col + i)}{row}"
        c = put(ws, ref, label, bold=True, color=color, bg=bg, h="center", wrap=True)
        c.border = HDR_BORDER
        HEADERS.add((ws.title, ref))


def header_merged(ws, rng, label):
    merge(ws, rng, label, bold=True, color=WHITE, bg=SLATE, h="center", wrap=True)
    min_col, min_row, max_col, max_row = range_boundaries(rng)
    for col in range(min_col, max_col + 1):
        ws.cell(min_row, col).border = HDR_BORDER


def title(ws, last_col, text, subtitle):
    merge(ws, f"A1:{last_col}1", text, bold=True, size=18, color=WHITE, bg=NAVY, h="left",
          indent=1, border=False)
    for col in range(1, column_index_from_string(last_col) + 1):
        ws.cell(1, col).border = Border(bottom=Side(style="thick", color=GOLD))
    ws.row_dimensions[1].height = 38
    merge(ws, f"A2:{last_col}2", subtitle, italic=True, color=SLATE_TXT, bg=SUBTLE, h="left",
          wrap=True, indent=1, border=False)


def legend(ws, row, items=("input", "ref", "calc", "link")):
    put(ws, f"A{row}", "Leyenda:", bold=True, size=9, color=SLATE_TXT, border=False)
    labels = {"input": "Editable (captura aquí)", "ref": "Dato de referencia",
              "calc": "Fórmula automática", "link": "Vínculo a otra hoja"}
    for i, k in enumerate(items):
        ref = f"{get_column_letter(2 + i)}{row}"
        put(ws, ref, labels[k], kind=k, size=9, h="center", wrap=True)
        NOFIT.add((ws.title, ref))


def note(ws, rng, text):
    merge(ws, rng, text, italic=True, size=9, color=SLATE_TXT, h="left", wrap=True, border=False)


def comment(ws, ref, text, width=260, height=90):
    cm = Comment(text, "Comité Posada 2026")
    cm.width, cm.height = width, height
    ws[ref].comment = cm


def cf_text(ws, rng, mapping):
    """mapping: {texto: (relleno, color_texto)}"""
    for text, (bg, fg) in mapping.items():
        ws.conditional_formatting.add(
            rng, CellIsRule(operator="equal", formula=[f'"{text}"'], fill=_fill(bg),
                            font=Font(color=fg, bold=True)))


def cf_sign(ws, rng):
    ws.conditional_formatting.add(
        rng, CellIsRule(operator="greaterThanOrEqual", formula=["0"], fill=_fill(OK_FILL),
                        font=Font(color=OK_TXT, bold=True)))
    ws.conditional_formatting.add(
        rng, CellIsRule(operator="lessThan", formula=["0"], fill=_fill(BAD_FILL),
                        font=Font(color=BAD_TXT, bold=True)))


def dv_list(ws, rng, items=None, source=None, strict=True, prompt=None):
    formula = source if source else '"' + ",".join(items) + '"'
    dv = DataValidation(type="list", formula1=formula, allow_blank=True,
                        showErrorMessage=True, errorStyle="stop" if strict else "warning",
                        errorTitle="Valor no válido",
                        error="Elige una opción de la lista desplegable.")
    if prompt:
        dv.showInputMessage = True
        dv.promptTitle, dv.prompt = "Sugerencia", prompt
    ws.add_data_validation(dv)
    dv.add(rng)


def dv_number(ws, rng, whole=False, minimum=0, maximum=None):
    op = "between" if maximum is not None else "greaterThanOrEqual"
    dv = DataValidation(type="whole" if whole else "decimal", operator=op,
                        formula1=str(minimum),
                        formula2=str(maximum) if maximum is not None else None,
                        allow_blank=True, showErrorMessage=True, errorTitle="Valor no válido",
                        error="Captura un número mayor o igual a cero.")
    ws.add_data_validation(dv)
    dv.add(rng)


def finish_sheet(ws, freeze=None, landscape=True, zoom=100):
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = zoom
    if freeze:
        ws.freeze_panes = freeze
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True


# --------------------------------------------------------------------------------------
# Ajuste automático de columnas y renglones (openpyxl no mide texto: se estima)
# --------------------------------------------------------------------------------------
def _factor(c):
    f = c.font
    size = (f.sz or 10) if f else 10
    return size / 10.0 * (1.08 if (f and f.b) else 1.0)


def _est_len(ws, c):
    key = (ws.title, c.coordinate)
    v = c.value
    fmt = c.number_format or "General"
    if key in HINTS:
        base = HINTS[key]
    elif isinstance(v, str) and v.startswith("="):
        if "$" in fmt:
            base = 12            # hasta $999,999.99
        elif "%" in fmt:
            base = 7
        elif "días" in fmt or "de 5" in fmt:
            base = 9
        elif "yy" in fmt:
            base = 10
        elif fmt in ("0", INT, DEC1):
            base = 6
        else:
            base = 12
    elif isinstance(v, bool):
        base = 5
    elif isinstance(v, (int, float)):
        if "$" in fmt:
            base = len(f"${v:,.2f}")
        elif "%" in fmt:
            base = len(f"{v * 100:.1f}%")
        else:
            base = len(f"{v:,}")
    elif isinstance(v, (datetime, date)):
        base = 10
    elif isinstance(v, time):
        base = 5
    else:
        base = max(len(s) for s in str(v).split("\n"))
    return base * _factor(c)


def _is_numeric_cell(c):
    if isinstance(c.value, (int, float, datetime, date, time)) and not isinstance(c.value, bool):
        return True
    fmt = c.number_format or "General"
    return fmt not in ("General", "@")


def autofit(ws, caps=None, mins=None, margin=3.0):
    """Ancho = texto más largo + margen. Los textos pueden topar en `caps` (se parten en
    renglones); los números nunca se recortan, así que no aparece ###."""
    caps, mins = caps or {}, mins or {}
    multi = set()
    for mr in ws.merged_cells.ranges:
        if mr.max_col > mr.min_col:
            for r in range(mr.min_row, mr.max_row + 1):
                for ci in range(mr.min_col, mr.max_col + 1):
                    multi.add((r, ci))
    txt_w, num_w = defaultdict(float), defaultdict(float)
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c, MergedCell) or c.value is None or (c.row, c.column) in multi:
                continue
            key = (ws.title, c.coordinate)
            if key in NOFIT:
                continue
            letter = c.column_letter
            if key in HEADERS:
                text = str(c.value)
                longest = max(len(w) for w in text.split())
                txt_w[letter] = max(txt_w[letter], max(longest, math.ceil(len(text) / 2)) * 1.08 + 1)
                continue
            target = num_w if _is_numeric_cell(c) else txt_w
            target[letter] = max(target[letter], _est_len(ws, c))
    for letter in set(txt_w) | set(num_w) | set(mins):
        w = txt_w.get(letter, 0) + margin
        if letter in caps:
            w = min(w, caps[letter])
        w = max(w, num_w.get(letter, 0) + margin, mins.get(letter, 0), 8)
        ws.column_dimensions[letter].width = round(w, 1)


def fit_heights(ws):
    """Activa ajuste de texto donde haga falta y calcula la altura de cada renglón."""
    def width(letter):
        return ws.column_dimensions[letter].width or 8.43

    span, skip = {}, set()
    for mr in ws.merged_cells.ranges:
        if mr.min_row != mr.max_row:
            skip.add((mr.min_row, mr.min_col))
            continue
        span[(mr.min_row, mr.min_col)] = sum(
            width(get_column_letter(ci)) for ci in range(mr.min_col, mr.max_col + 1))
    need = {}
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c, MergedCell) or c.value is None or (c.row, c.column) in skip:
                continue
            w = span.get((c.row, c.column), width(c.column_letter))
            factor = _factor(c)
            key = (ws.title, c.coordinate)
            plain_text = isinstance(c.value, str) and not c.value.startswith("=")
            if key in HINTS:
                lens = [HINTS[key]]
            elif plain_text:
                # Texto corrido en Arial (minúsculas) es ~10% más angosto que el dígito "0"
                lens = [len(p) * 0.9 for p in c.value.split("\n")]
            else:
                lens = [_est_len(ws, c) / factor]
            usable = max(w - 2.0 - (c.alignment.indent or 0) * 1.2, 1)
            wrap = bool(c.alignment.wrap_text)
            if not wrap and not _is_numeric_cell(c) and max(lens) * factor > w - 1:
                al = c.alignment
                c.alignment = Alignment(horizontal=al.horizontal, vertical=al.vertical,
                                        wrap_text=True, indent=al.indent)
                wrap = True
            lines = sum(max(1, math.ceil(L * factor / usable)) for L in lens) if wrap else 1
            size = (c.font.sz or 10) if c.font else 10
            h = lines * 12.75 * size / 10 + (4 if (lines > 1 or size > 10) else 2)
            need[c.row] = max(need.get(c.row, 0), h)
    for r, h in need.items():
        cur = ws.row_dimensions[r].height
        if h > (cur or 15):
            ws.row_dimensions[r].height = round(h, 1)


# --------------------------------------------------------------------------------------
# Datos
# --------------------------------------------------------------------------------------
# (categoría, producto, precio HEB, precio Soriana, cantidad sugerida para ~22 personas)
PRODUCTS = [
    ("Tequila", "Tequila José Cuervo Tradicional Reposado 950 ml", 345.00, 385.00, 2),
    ("Tequila", "Tequila Don Julio 70 Cristalino 700 ml", 1050.00, 1049.00, 1),
    ("Whisky", "Whisky Johnnie Walker Black Label 750 ml", 1099.00, 934.00, 1),
    ("Whisky", "Whisky Buchanans Deluxe 12 Años 750 ml", 989.00, 949.00, 1),
    ("Ron", "Ron Bacardí Carta Blanca 980 ml", 327.00, 394.00, 1),
    ("Ron", "Ron Havana Club 7 Años Añejo 700 ml", 450.00, 585.00, 1),
    ("Cerveza", "Cerveza Tecate Light 12 Pack Lata 355 ml", 205.00, 225.00, 3),
    ("Cerveza", "Cerveza Amstel Ultra / Michelob Ultra 12 Pack Lata 355 ml", 228.00, 256.00, 2),
    ("Cerveza", "Cerveza Indio / Dos Equis Lager 12 Pack Lata 355 ml", 225.00, 235.00, 2),
    ("Mezcladores y Hielo", "Refresco Coca-Cola Original / Sin Azúcar 2.5 L", 49.50, 48.00, 6),
    ("Mezcladores y Hielo", "Agua Mineral Topo Chico / Peñafiel 600 ml (Pack o pieza equiv. 2L)", 32.00, 30.00, 6),
    ("Mezcladores y Hielo", "Jugo / Agua Quina / Squirt 2 L", 35.00, 34.00, 4),
    ("Mezcladores y Hielo", "Bolsa de Hielo 5 kg", 32.00, 35.00, 6),
    ("Mezcladores y Hielo", "Vasos desechables, limones y sal (Kit estimado)", 150.00, 150.00, 2),
]
DRINK_CATS = ["Tequila", "Whisky", "Ron", "Cerveza", "Mezcladores y Hielo"]

# Encuesta: 5 rubros × 3 opciones. Precios = estimados de referencia (MXN, 2026).
ENCUESTA = [
    {
        "cat": "Cena",
        "short": ["Taquiza de trompo / carne asada", "Banquete navideño tradicional",
                  "Catering gourmet de 3 tiempos"],
        "desc": [
            "Taquero a domicilio con trompo al pastor y bistec (o carne asada estilo norteño): "
            "tortillas hechas a mano, salsas, cebollitas, frijoles charros y guacamole.",
            "Banquete navideño: pierna o lomo adobado / pavo relleno, ensalada de manzana, "
            "espagueti cremoso, puré, pan y postre; se encarga listo para servir.",
            "Catering formal de 3 tiempos (crema o ensalada, plato fuerte y postre) con meseros, "
            "loza y mantelería, o estación gourmet de cortes, pastas o sushi en vivo.",
        ],
        "pros": [
            "Ambiente relajado y gusta a todos. Requiere espacio para el trompo/asador.",
            "Sabor clásico de posada. Necesita alguien que sirva y loza o desechables resistentes.",
            "Experiencia premium sin trabajo para el grupo. Es la más cara y en diciembre hay que apartar con tiempo.",
        ],
        "price": [230, 420, 780],
        "base": ["Persona", "Persona", "Persona"],
    },
    {
        "cat": "Bebidas / Alcohol",
        "short": ["BYOB + bolsa común", "Compra al mayoreo + barra de mezcladores",
                  "Barra libre con bartender"],
        "desc": [
            "BYOB: cada pareja lleva lo que va a tomar y se junta una bolsa común para hielo, "
            "refrescos, agua mineral, limones y vasos (monto ligado a 'Mezcladores y Hielo' del Cotizador).",
            "Compra en bloque de botellas y cerveza en HEB / Soriana + barra libre de mezcladores. "
            "El monto se liga al Gran Total de Cotizador_Alcohol.",
            "Barra libre con bartender profesional (5 h): coctelería de autor (carajillo, mezcalita, "
            "ponche con piquete), cristalería y hielo incluidos.",
        ],
        "pros": [
            "La más económica y cada quien toma lo que le gusta. Riesgo de que falte o sobre: acordar quién lleva qué.",
            "Buen balance precio / variedad y se aprovechan promociones. Alguien debe comprar, transportar y enfriar.",
            "Experiencia tipo boda y nadie se preocupa por servir. Validar marcas incluidas y costo de hora extra.",
        ],
        "price": ["CA_MIX", "CA_TOTAL", 620],
        "base": ["Evento", "Evento", "Persona"],
    },
    {
        "cat": "Música y Ambiente",
        "short": ["Bocina + playlist colaborativa", "DJ con audio e iluminación",
                  "DJ + pista LED + cabina de fotos"],
        "desc": [
            "Bocina potente (renta tipo party box) + playlist colaborativa en Spotify donde cada "
            "quien agrega sus canciones favoritas.",
            "DJ con equipo de audio profesional e iluminación básica por 5 horas: cumbias, "
            "reggaetón, pop, rock en español y clásicos navideños.",
            "DJ + pista de baile LED iluminada + cabina de fotos con props navideños (3 h) + "
            "chisperos fríos para el momento cumbre.",
        ],
        "pros": [
            "Barato y participativo. Alguien debe administrar la música; revisar el volumen permitido en el lugar.",
            "Mantiene la pista viva sin esfuerzo del grupo. Confirmar horario, conexiones eléctricas y hora extra.",
            "Producción de evento y fotos impresas de recuerdo. Requiere espacio, montaje y mayor inversión.",
        ],
        "price": [1200, 6500, 19500],
        "base": ["Evento", "Evento", "Evento"],
    },
    {
        "cat": "Dinámica Navideña",
        "short": ["Intercambio tradicional", "Elefante blanco / robo de regalos",
                  "Juegos con premios + piñata adultos"],
        "desc": [
            "Intercambio tradicional (amigo secreto) con sorteo por app y tope de regalo de $500 por persona.",
            "Elefante blanco / robo de regalos: regalo sorpresa de ~$350, turnos por número y "
            "máximo 3 robos por regalo.",
            "Juegos y concursos con premios (lotería navideña, maratón posadero, mejor suéter feo) "
            "+ piñata para adultos con sorpresas.",
        ],
        "pros": [
            "Clásico y sin complicaciones. El costo es personal: cada quien compra su regalo.",
            "Muy divertido y genera muchas risas. Definir reglas claras antes de empezar.",
            "Máxima convivencia entre parejas. Requiere un animador y comprar premios con anticipación.",
        ],
        "price": [500, 350, 5500],
        "base": ["Persona", "Persona", "Evento"],
    },
    {
        "cat": "Decoración y Temática",
        "short": ["Decoración DIY + suéter navideño", "Decoración temática rentada",
                  "Ambientación profesional"],
        "desc": [
            "Decoración hecha por el grupo: series de luces, nochebuenas, velas y centros de mesa "
            "caseros; dress code 'suéter navideño'.",
            "Decoración temática por renta: mantelería, centros de mesa y backdrop navideño con "
            "globos para fotos.",
            "Ambientación profesional: decoradora, arco navideño, letras gigantes, mesa de postres "
            "y luz cálida.",
        ],
        "pros": [
            "Económico y con toque personal. Requiere voluntarios para montar y desmontar.",
            "Se ve producido con poco esfuerzo. Coordinar entrega y recolección con el proveedor.",
            "Look de revista, ideal para fotos. Mayor costo y tiempo de montaje.",
        ],
        "price": [1500, 5000, 14000],
        "base": ["Evento", "Evento", "Evento"],
    },
]

# Presupuesto: (concepto, costo unitario | "CA_TOTAL", cantidad | "ASIST", proveedor, nota)
PD_SECTIONS = [
    ("Alimentos / Cena", [
        ("Cena principal (según opción ganadora de la Encuesta)", 420, "ASIST", "Por definir",
         "Ref. Opción B (banquete navideño ≈ $420 por persona). Cantidad ligada al total de asistentes."),
        ("Botana de bienvenida (guacamole, totopos, cacahuates, chicharrón)", 1200, 1, "Por definir",
         "Para recibir a los invitados mientras llega la cena."),
        ("Postres navideños (buñuelos, galletas, pastel)", 900, 1, "Por definir", ""),
        ("Ponche navideño caliente (fruta de temporada, piloncillo, canela)", 650, 1, "Por definir",
         "Olla para ~25 personas."),
    ]),
    ("Bebidas y Alcohol", [
        ("Alcohol, cerveza, mezcladores y hielo (Cotizador_Alcohol)", "CA_TOTAL", 1, "HEB / Soriana",
         "Se actualiza solo: edita las cantidades en la pestaña Cotizador_Alcohol."),
        ("Agua purificada (garrafón 20 L)", 65, 2, "Por definir", ""),
        ("Café de olla y chocolate caliente para cerrar la noche", 350, 1, "Por definir", ""),
    ]),
    ("Audio / DJ / Pista", [
        ("DJ con audio e iluminación básica (5 horas)", 6500, 1, "Por definir",
         "Ref. Opción B de Música y Ambiente."),
        ("Hora extra de DJ (opcional)", 1000, 0, "Por definir",
         "Cantidad en 0 hasta decidir si se necesita."),
    ]),
    ("Decoración / Desechables", [
        ("Decoración navideña (series de luces, nochebuenas, centros de mesa)", 1800, 1, "Por definir", ""),
        ("Kit desechable por persona (plato, cubiertos, servilleta)", 25, "ASIST", "Por definir",
         "Los vasos ya vienen en el kit del Cotizador_Alcohol."),
        ("Bolsas de basura, papel y artículos de limpieza", 250, 1, "Por definir", ""),
    ]),
    ("Dinámicas / Piñata", [
        ("Piñata tradicional de 7 picos", 650, 1, "Por definir", ""),
        ("Relleno de piñata (fruta, dulces, colación)", 900, 1, "Por definir", ""),
        ("Aguinaldos / bolsitas de colación", 25, "ASIST", "Por definir", ""),
        ("Premios para juegos y concursos", 400, 0, "Por definir",
         "Solo si gana la Opción C de Dinámica Navideña (sugerido: 4 a 6 premios)."),
    ]),
    ("Staff / Limpieza", [
        ("Mesero / auxiliar de servicio (6 horas)", 1000, 1, "Por definir", ""),
        ("Servicio de limpieza al terminar el evento", 1200, 1, "Por definir", ""),
        ("Propinas (taquero / cocina, DJ, mesero)", 500, 1, "Por definir", ""),
    ]),
]
PD_BLANKS = 2  # filas libres por categoría

# Rubro del presupuesto -> rubro de la encuesta (para el estimado por votación)
PD_TO_EN = {
    "Alimentos / Cena": "Cena",
    "Bebidas y Alcohol": "Bebidas / Alcohol",
    "Audio / DJ / Pista": "Música y Ambiente",
    "Decoración / Desechables": "Decoración y Temática",
    "Dinámicas / Piñata": "Dinámica Navideña",
    "Staff / Limpieza": None,
}

CHECKLIST = [
    ("4 semanas antes", -28, [
        ("Compartir este Excel con el grupo y presentar las opciones de cada rubro.", EN),
        ("Votar cena, bebidas, música, dinámica y decoración; registrar los votos.", EN),
        ("Confirmar asistencia de los 11 amigos y sus parejas.", LI),
        ("Acordar el presupuesto objetivo por pareja y la cuota a cobrar.", DB),
        ("Confirmar con el lugar: horario de acceso, hora límite de música, mesas / sillas "
         "incluidas y estacionamiento.", "—"),
        ("Pedir al menos 2 cotizaciones por cada rubro ganador (cena, DJ / audio, decoración).", PD),
        ("Cobrar anticipo (sugerido: 50% de la cuota) para apartar proveedores.", LI),
    ]),
    ("2 semanas antes", -14, [
        ("Contratar la cena: confirmar menú, número de personas, horario de servicio y anticipo.", PD),
        ("Contratar DJ / audio o asegurar la bocina; crear la playlist colaborativa.", PD),
        ("Organizar la dinámica: sorteo del intercambio, reglas del elefante blanco o juegos y premios.", EN),
        ("Comprar piñata, colación y decoración navideña.", PD),
        ("Definir cantidades finales de bebidas y quién compra (HEB vs Soriana).", CA),
        ("Revisar mobiliario: mesas, sillas, mantelería y calentadores o carpa si es al aire libre.", "—"),
    ]),
    ("1 semana antes", -7, [
        ("Cobrar el saldo pendiente de todas las cuotas.", LI),
        ("Reconfirmar el número final de asistentes con todos los proveedores.", LI),
        ("Comprar alcohol, cerveza y mezcladores (aprovechar promociones de fin de semana).", CA),
        ("Comprar desechables, bolsas de basura y artículos de limpieza.", PD),
        ("Armar y compartir el programa: llegada, cena, piñata, dinámica y baile.", "—"),
        ("Definir conductores designados o transporte seguro de regreso (taxi / app).", "—"),
    ]),
    ("Día del evento", 0, [
        ("Comprar el hielo (máximo 3 a 4 horas antes) y enfriar la cerveza.", CA),
        ("Montaje: decoración, mesas, barra de bebidas y mesa de regalos.", "—"),
        ("Recibir a los proveedores (cena, DJ) y verificar lo contratado.", PD),
        ("Prueba de audio e iluminación antes de que llegue el grupo.", "—"),
        ("Coordinar piñata y dinámica; cuidar los tiempos del programa.", EN),
        ("Liquidar pagos pendientes a proveedores y entregar propinas.", PD),
    ]),
    ("Día siguiente", 1, [
        ("Limpieza del lugar y retiro de basura.", "—"),
        ("Devolver mobiliario o equipo rentado y recuperar depósitos.", "—"),
        ("Cuadrar cuentas: gasto real vs presupuesto y saldos a favor o en contra.", PD),
        ("Compartir fotos y videos del evento con el grupo.", "—"),
        ("Recopilar comentarios para la próxima posada.", "—"),
    ]),
]

STATUS_PD = ["Cotizando", "Confirmado", "Pagado"]
STATUS_CL = ["Pendiente", "En proceso", "Hecho"]
ASISTENCIA = ["Sí", "No", "Pendiente"]
BEBIDAS = ["Tequila", "Whisky", "Ron", "Cerveza", "Vino / Otro", "Sin alcohol"]
OPCIONES = ["Opción A", "Opción B", "Opción C"]


# --------------------------------------------------------------------------------------
# 3. Cotizador_Alcohol
# --------------------------------------------------------------------------------------
def build_cotizador(ws):
    R = {}
    ws.sheet_properties.tabColor = FOREST
    title(ws, "I", "COTIZADOR DE BEBIDAS  ·  HEB VS SORIANA",
          "Captura únicamente la CANTIDAD A COMPRAR (columna F, celdas crema). Subtotales, totales e "
          "indicadores se calculan solos y el Gran Total pasa automáticamente a Presupuesto_Detallado y "
          "Dashboard_Resumen. Precios de referencia proporcionados por el organizador (HEB / Soriana México, "
          "MXN); pueden variar por sucursal y promociones: verifícalos antes de comprar.")
    legend(ws, 3)
    header_cells(ws, 5, ["Categoría", "Producto / Presentación", "Precio Ref. HEB (MXN)",
                         "Precio Ref. Soriana (MXN)", "Precio Promedio (MXN)", "Cantidad a Comprar",
                         "Subtotal Estimado (MXN)", "Dónde Conviene", "Ahorro vs. Otra Tienda (MXN)"])
    ws["F5"].fill = _fill(GOLD)
    ws["F5"].font = _font(10, True, color=NAVY)

    first = 6
    shade, prev = True, None
    rows_by_name = {}
    for i, (cat, prod, heb, sor, qty) in enumerate(PRODUCTS):
        r = first + i
        if cat != prev:
            shade, prev = not shade, cat
        bg = ZEBRA if shade else None
        rows_by_name[prod] = r
        put(ws, f"A{r}", cat, bold=True, color=SLATE_TXT, bg=bg)
        put(ws, f"B{r}", prod, bg=bg)
        put(ws, f"C{r}", heb, kind="ref", fmt=MONEY, bg=bg)
        put(ws, f"D{r}", sor, kind="ref", fmt=MONEY, bg=bg)
        put(ws, f"E{r}", f"=AVERAGE(C{r},D{r})", fmt=MONEY, bg=bg)
        put(ws, f"F{r}", qty, kind="input", fmt=INT, h="center", bold=True)
        put(ws, f"G{r}", f"=E{r}*F{r}", fmt=MONEY, bold=True, bg=bg)
        put(ws, f"H{r}", f'=IF(C{r}<D{r},"HEB",IF(D{r}<C{r},"Soriana","Igual"))', h="center",
            bg=bg, est=8)
        put(ws, f"I{r}", f"=ABS(C{r}-D{r})*F{r}", fmt=MONEY, bg=bg)
    last = first + len(PRODUCTS) - 1
    dv_number(ws, f"F{first}:F{last}", whole=True)
    comment(ws, "F5", "Única columna que necesitas capturar. Cantidades precargadas = sugerencia "
                      "base para ~22 asistentes; cámbialas libremente (0 si no se compra).")
    hielo = rows_by_name["Bolsa de Hielo 5 kg"]
    coca = rows_by_name[PRODUCTS[9][1]]
    agua = rows_by_name[PRODUCTS[10][1]]
    jugo = rows_by_name[PRODUCTS[11][1]]

    # Posiciones del pie de página
    sec1 = last + 2
    cat_first = sec1 + 2
    cat_rows = {cat: cat_first + k for k, cat in enumerate(DRINK_CATS)}
    total_row = cat_first + len(DRINK_CATS)
    sec2 = total_row + 2
    sec3 = sec2 + 6
    rend = {}
    keys = ["tragos", "latas", "botellas", "tragos_est", "packs", "latas_est", "total",
            "asist", "prom", "meta", "lectura", "hielo"]
    for k, key in enumerate(keys):
        rend[key] = sec3 + 2 + k
    TRAGOS, LATAS = f"$C${rend['tragos']}", f"$C${rend['latas']}"
    RNG_CAT = f"$A${first}:$A${last}"

    # --- Subtotales por categoría + Gran Total
    section(ws, f"A{sec1}:I{sec1}", "SUBTOTALES POR CATEGORÍA")
    hr = sec1 + 1
    header_cells(ws, hr, ["Categoría"], 1)
    header_merged(ws, f"B{hr}:E{hr}", "Rendimiento Estimado")
    header_cells(ws, hr, ["Unidades", "Subtotal (MXN)", "% del Total", "Preferencia en Lista (amigos)"], 6)
    for cat, r in cat_rows.items():
        put(ws, f"A{r}", cat, bold=True, color=NAVY)
        if cat in ("Tequila", "Whisky", "Ron"):
            txt = f'=F{r}*{TRAGOS}&" tragos aprox. en "&F{r}&" botella(s)"'
        elif cat == "Cerveza":
            txt = f'=F{r}*{LATAS}&" latas en "&F{r}&" paquete(s) de 12"'
        else:
            txt = (f'="Hielo: "&F{hielo}*5&" kg  ·  Refrescos, agua y jugos: "'
                   f'&(F{coca}+F{agua}+F{jugo})&" pzas."')
        merge(ws, f"B{r}:E{r}", txt, h="left", est=52)
        put(ws, f"F{r}", f"=SUMIF({RNG_CAT},A{r},$F${first}:$F${last})", fmt=INT, h="center")
        put(ws, f"G{r}", f"=SUMIF({RNG_CAT},A{r},$G${first}:$G${last})", fmt=MONEY, bold=True)
        put(ws, f"H{r}", f"=IFERROR(G{r}/$G${total_row},0)", fmt=PCT)
        if cat == "Mezcladores y Hielo":
            put(ws, f"I{r}", "—", h="center")
        else:
            put(ws, f"I{r}", f"=COUNTIF({LI_DRINK},A{r})", kind="link", fmt=INT, h="center")
    t = total_row
    merge(ws, f"A{t}:E{t}", "GRAN TOTAL DE BEBIDAS  →  Presupuesto_Detallado y Dashboard_Resumen",
          bold=True, size=11, color=WHITE, bg=NAVY, h="left", indent=1)
    put(ws, f"F{t}", f"=SUM(F{cat_first}:F{t - 1})", fmt=INT, bold=True, color=WHITE, bg=NAVY, h="center")
    put(ws, f"G{t}", f"=SUM(G{first}:G{last})", fmt=MONEY, bold=True, size=12, color=GOLD_TXT, bg=NAVY)
    put(ws, f"H{t}", f"=SUM(H{cat_first}:H{t - 1})", fmt=PCT, bold=True, color=WHITE, bg=NAVY)
    put(ws, f"I{t}", f"=SUM(I{cat_first}:I{t - 2})", fmt=INT, bold=True, color=WHITE, bg=NAVY, h="center")
    R["CA_TOTAL"] = f"{CA}!$G${t}"
    R["CA_MIX"] = f"{CA}!$G${cat_rows['Mezcladores y Hielo']}"

    # --- Comparativo por tienda
    section(ws, f"A{sec2}:I{sec2}", "COMPARATIVO DE COMPRA: HEB VS SORIANA (con las cantidades actuales)")
    hr = sec2 + 1
    header_merged(ws, f"A{hr}:B{hr}", "Escenario")
    header_cells(ws, hr, ["Todo en HEB", "Todo en Soriana", "Precio Promedio"], 3)
    header_merged(ws, f"F{hr}:G{hr}", "Mejor Combinación*")
    header_merged(ws, f"H{hr}:I{hr}", "Lectura")
    r1, r2, r3 = sec2 + 2, sec2 + 3, sec2 + 4
    merge(ws, f"A{r1}:B{r1}", "Costo total de la lista", bold=True, color=NAVY)
    put(ws, f"C{r1}", f"=SUMPRODUCT($C${first}:$C${last},$F${first}:$F${last})", fmt=MONEY)
    put(ws, f"D{r1}", f"=SUMPRODUCT($D${first}:$D${last},$F${first}:$F${last})", fmt=MONEY)
    put(ws, f"E{r1}", f"=G{t}", fmt=MONEY)
    merge(ws, f"F{r1}:G{r1}",
          f"=SUMPRODUCT($F${first}:$F${last}*(($C${first}:$C${last}<=$D${first}:$D${last})*$C${first}:$C${last}"
          f"+($C${first}:$C${last}>$D${first}:$D${last})*$D${first}:$D${last}))",
          fmt=MONEY, bold=True, bg=OK_FILL)
    merge(ws, f"H{r1}:I{r1}", f'="Más barata: "&IF(C{r1}<D{r1},"HEB",IF(D{r1}<C{r1},"Soriana","Igual"))',
          h="center", bold=True, est=20)
    merge(ws, f"A{r2}:B{r2}", "Ahorro vs. precio promedio", bold=True, color=NAVY)
    put(ws, f"C{r2}", f"=E{r1}-C{r1}", fmt=MONEY)
    put(ws, f"D{r2}", f"=E{r1}-D{r1}", fmt=MONEY)
    put(ws, f"E{r2}", "—", h="center")
    merge(ws, f"F{r2}:G{r2}", f"=E{r1}-F{r1}", fmt=MONEY, bold=True, bg=OK_FILL)
    merge(ws, f"H{r2}:I{r2}", "*Cada producto en la tienda más barata (columna H).", italic=True,
          size=9, color=SLATE_TXT, wrap=True)
    merge(ws, f"A{r3}:B{r3}", "Recomendación", bold=True, color=NAVY)
    merge(ws, f"C{r3}:I{r3}",
          f'=IF(C{r1}<D{r1},"Si compran todo en un solo lugar conviene HEB: ahorran $"&FIXED(D{r1}-C{r1},2)&" vs. Soriana.",'
          f'IF(D{r1}<C{r1},"Si compran todo en un solo lugar conviene Soriana: ahorran $"&FIXED(C{r1}-D{r1},2)&" vs. HEB.",'
          f'"HEB y Soriana cuestan lo mismo con estas cantidades."))'
          f'&" Dividiendo la compra según la columna H, el total sería $"&FIXED(F{r1},2)&"."',
          wrap=True, est=150, bg=GOLD_LIGHT)

    # --- Indicador de rendimiento
    section(ws, f"A{sec3}:I{sec3}", "INDICADOR DE RENDIMIENTO")
    hr = sec3 + 1
    header_merged(ws, f"A{hr}:B{hr}", "Indicador")
    header_cells(ws, hr, ["Valor"], 3)
    header_merged(ws, f"D{hr}:I{hr}", "Nota / Supuesto")
    asist_link = DB_ASIST
    rows = [
        ("tragos", "Supuesto: tragos por botella (700–980 ml)", 15, "input", INT,
         "Supuesto indicado por el organizador. Trago estándar de 45–60 ml; ajústalo si sirven dobles."),
        ("latas", "Supuesto: latas por paquete (12-pack)", 12, "input", INT,
         "Paquetes de 12 latas de 355 ml."),
        ("botellas", "Botellas de destilado a comprar",
         f"=F{cat_rows['Tequila']}+F{cat_rows['Whisky']}+F{cat_rows['Ron']}", "calc", INT,
         "Tequila + Whisky + Ron."),
        ("tragos_est", "Tragos de destilado estimados", f"=C{rend['botellas']}*{TRAGOS}", "calc", INT, ""),
        ("packs", "Paquetes de cerveza a comprar", f"=F{cat_rows['Cerveza']}", "calc", INT, ""),
        ("latas_est", "Cervezas (latas) estimadas", f"=C{rend['packs']}*{LATAS}", "calc", INT, ""),
        ("total", "TOTAL DE BEBIDAS (tragos + cervezas)",
         f"=C{rend['tragos_est']}+C{rend['latas_est']}", "calc", INT, "Sin contar refrescos ni agua."),
        ("asist", "Asistentes (Dashboard_Resumen)", f"={asist_link}", "link", INT,
         "Se toma del panel de parámetros del Dashboard."),
        ("prom", "PROMEDIO DE BEBIDAS POR ASISTENTE",
         f"=IFERROR(C{rend['total']}/C{rend['asist']},0)", "calc", DEC1,
         "Total de bebidas ÷ asistentes."),
        ("meta", "Meta sugerida de bebidas por asistente", 8, "input", DEC1,
         "≈ 1.5 bebidas por hora en una posada de 5 a 6 horas; ajústala al estilo del grupo."),
        ("lectura", "Lectura del indicador",
         f'=IF(C{rend["asist"]}=0,"Sin asistentes",IF(C{rend["prom"]}<C{rend["meta"]}*0.85,'
         f'"Corto: consideren comprar más",IF(C{rend["prom"]}>C{rend["meta"]}*1.3,'
         f'"Holgado: podría sobrar","Adecuado")))', "calc", None,
         "Corto = menos de 85% de la meta · Holgado = más de 130% de la meta."),
        ("hielo", "Hielo por asistente (kg)", f"=IFERROR(F{hielo}*5/C{rend['asist']},0)", "calc",
         '0.0 "kg"', "Recomendado: al menos 1 kg por persona (más si enfrían cerveza en hieleras)."),
    ]
    for key, label, val, kind, fmt, nt in rows:
        r = rend[key]
        strong = key in ("total", "prom")
        merge(ws, f"A{r}:B{r}", label, bold=True, color=NAVY, bg=GOLD_LIGHT if strong else None)
        put(ws, f"C{r}", val, kind=kind, fmt=fmt, h="center", bold=strong or kind == "input",
            bg=GOLD_LIGHT if strong else None, wrap=(key == "lectura"), est=29 if key == "lectura" else None)
        merge(ws, f"D{r}:I{r}", nt or None, italic=True, size=9, color=SLATE_TXT, wrap=True)
    for key in ("tragos", "latas", "meta"):
        dv_number(ws, f"C{rend[key]}")
    lect = f"C{rend['lectura']}"
    ws.conditional_formatting.add(lect, FormulaRule(formula=[f'LEFT({lect},5)="Corto"'],
                                  fill=_fill(BAD_FILL), font=Font(color=BAD_TXT, bold=True)))
    ws.conditional_formatting.add(lect, FormulaRule(formula=[f'LEFT({lect},7)="Holgado"'],
                                  fill=_fill(WARN_FILL), font=Font(color=WARN_TXT, bold=True)))
    ws.conditional_formatting.add(lect, FormulaRule(formula=[f'{lect}="Adecuado"'],
                                  fill=_fill(OK_FILL), font=Font(color=OK_TXT, bold=True)))
    hc = f"C{rend['hielo']}"
    ws.conditional_formatting.add(hc, CellIsRule(operator="lessThan", formula=["1"],
                                  fill=_fill(WARN_FILL), font=Font(color=WARN_TXT, bold=True)))
    R["CA_PROM"] = f"{CA}!$C${rend['prom']}"
    R["CA_LECTURA"] = f"{CA}!$C${rend['lectura']}"

    autofit(ws, mins={"C": 14, "D": 14, "E": 14, "F": 12, "G": 15, "H": 12, "I": 14})
    finish_sheet(ws, freeze="C6", zoom=90)
    return R


# --------------------------------------------------------------------------------------
# 5. Lista_Invitados_y_Pagos
# --------------------------------------------------------------------------------------
def build_lista(ws):
    R = {}
    ws.sheet_properties.tabColor = "5A6B7F"
    title(ws, "J", "LISTA DE INVITADOS Y PAGOS",
          "Controla asistencia y cobranza. Captura nombres, confirmación (Sí / No / Pendiente), anticipos y "
          "bebida preferida. La cuota se calcula sola: costo individual del Dashboard_Resumen × número de "
          "personas (1 o 2; 0 si no asiste). Las filas 17 a 19 están libres para invitados adicionales.")
    legend(ws, 3, items=("input", "calc", "link"))
    header_cells(ws, 5, ["Nombre Amigo", "Nombre Pareja", "Asistencia Confirmada", "Total Personas",
                         "Cuota Asignada", "Anticipo Pagado", "Saldo Pendiente", "Estatus de Pago",
                         "Bebida / Destilado Preferido", "Notas"])
    for i in range(LI_LAST - LI_FIRST + 1):
        r = LI_FIRST + i
        is_friend = i < 11
        name = f"Amigo {i + 1}" if is_friend else None
        pareja = f"Pareja {i + 1}" if is_friend else None
        asis = "Pendiente" if is_friend else None
        anticipo = 0 if is_friend else None
        drink, nt = None, None
        if i == 0:  # fila de ejemplo
            asis, anticipo, drink = "Sí", 1000, "Tequila"
            nt = "Fila de ejemplo: reemplázala con los datos reales."
        put(ws, f"A{r}", name, kind="input", bold=True)
        put(ws, f"B{r}", pareja, kind="input")
        put(ws, f"C{r}", asis, kind="input", h="center")
        put(ws, f"D{r}", f'=IF(TRIM(A{r})="",0,IF(C{r}="No",0,IF(TRIM(B{r})="",1,2)))', fmt=INT, h="center")
        put(ws, f"E{r}", f'=IF(TRIM(A{r})="","",ROUND(D{r}*{DB_COSTO_IND},2))', kind="link", fmt=MONEY)
        put(ws, f"F{r}", anticipo, kind="input", fmt=MONEY)
        put(ws, f"G{r}", f'=IF(TRIM(A{r})="","",E{r}-F{r})', fmt=MONEY, bold=True)
        put(ws, f"H{r}", f'=IF(TRIM(A{r})="","",IF(D{r}=0,"No asiste",IF(AND(E{r}>0,F{r}>=E{r}),"Pagado",'
                         f'IF(F{r}>0,"Parcial","Pendiente"))))', h="center", est=9)
        put(ws, f"I{r}", drink, kind="input", h="center")
        put(ws, f"J{r}", nt, kind="input", size=9, wrap=True)
    t = LI_TOTAL
    merge(ws, f"A{t}:C{t}", "TOTALES", bold=True, color=WHITE, bg=NAVY, h="left", indent=1)
    put(ws, f"D{t}", f"=SUM(D{LI_FIRST}:D{LI_LAST})", fmt=INT, bold=True, color=WHITE, bg=NAVY, h="center")
    for col in "EFG":
        put(ws, f"{col}{t}", f"=SUM({col}{LI_FIRST}:{col}{LI_LAST})", fmt=MONEY, bold=True,
            color=GOLD_TXT, bg=NAVY)
    for col in "HIJ":
        put(ws, f"{col}{t}", None, bg=NAVY)
    rng = lambda col: f"{col}{LI_FIRST}:{col}{LI_LAST}"

    dv_list(ws, rng("C"), ASISTENCIA)
    dv_list(ws, rng("I"), BEBIDAS)
    dv_number(ws, rng("F"))
    cf_text(ws, rng("C"), {"Sí": (OK_FILL, OK_TXT), "No": (BAD_FILL, BAD_TXT),
                           "Pendiente": (WARN_FILL, WARN_TXT)})
    cf_text(ws, rng("H"), {"Pagado": (OK_FILL, OK_TXT), "Parcial": (WARN_FILL, WARN_TXT),
                           "Pendiente": (BAD_FILL, BAD_TXT), "No asiste": (MUTED_FILL, MUTED_TXT)})
    ws.conditional_formatting.add(rng("G"), CellIsRule(operator="lessThan", formula=["0"],
                                  fill=_fill(INFO_FILL), font=Font(color=INFO_TXT, bold=True)))
    comment(ws, f"E{LI_FIRST - 1}", "Cuota = costo individual (Dashboard_Resumen) × personas. "
                                    "Un saldo negativo significa saldo a favor.")

    # Resúmenes
    s = t + 2
    section(ws, f"A{s}:D{s}", "RESUMEN DE ASISTENCIA")
    section(ws, f"F{s}:I{s}", "RESUMEN DE COBRANZA")
    left = [
        ("Amigos que confirmaron (Sí)", f'=COUNTIF({rng("C")},"Sí")', INT),
        ("Amigos pendientes de confirmar", f'=COUNTIF({rng("C")},"Pendiente")', INT),
        ("Amigos que no asistirán", f'=COUNTIF({rng("C")},"No")', INT),
        ("Personas confirmadas (con pareja)", f'=SUMIF({rng("C")},"Sí",{rng("D")})', INT),
        ("Personas proyectadas (Sí + Pendiente)", f"=D{t}", INT),
    ]
    right = [
        ("Cuota por persona (Dashboard)", f"={DB_COSTO_IND}", MONEY, "link"),
        ("Amigos con pago completo", f'=COUNTIF({rng("H")},"Pagado")', INT, "calc"),
        ("Amigos con pago parcial", f'=COUNTIF({rng("H")},"Parcial")', INT, "calc"),
        ("Amigos con pago pendiente", f'=COUNTIF({rng("H")},"Pendiente")', INT, "calc"),
        ("% recaudado del total de cuotas", f"=IFERROR(F{t}/E{t},0)", PCT, "calc"),
    ]
    for k, (label, f, fmt) in enumerate(left):
        r = s + 1 + k
        merge(ws, f"A{r}:C{r}", label, bold=True, color=NAVY, bg=BAND)
        put(ws, f"D{r}", f, fmt=fmt, h="center", bold=True)
    for k, (label, f, fmt, kind) in enumerate(right):
        r = s + 1 + k
        merge(ws, f"F{r}:H{r}", label, bold=True, color=NAVY, bg=BAND)
        put(ws, f"I{r}", f, kind=kind, fmt=fmt, h="center", bold=True)

    autofit(ws, caps={"J": 42}, mins={"A": 16, "B": 16, "C": 14, "E": 15, "F": 15, "G": 15, "I": 16})
    finish_sheet(ws, freeze="B6")
    return R


# --------------------------------------------------------------------------------------
# 4. Presupuesto_Detallado
# --------------------------------------------------------------------------------------
def build_presupuesto(ws, ca_total):
    R = {}
    ws.sheet_properties.tabColor = SLATE
    title(ws, "I", "PRESUPUESTO DETALLADO",
          "Tabla maestra de gastos. Los montos precargados son estimados de referencia (escenario intermedio, "
          "Opción B de la Encuesta) para arrancar la conversación: sustitúyelos por cotizaciones reales y "
          "actualiza el Estatus. La línea de bebidas se alimenta sola desde Cotizador_Alcohol y las cantidades "
          "en verde siguen al total de asistentes del Dashboard. Usa las filas crema vacías para agregar conceptos.")
    legend(ws, 3, items=("input", "calc", "link"))
    header_cells(ws, 5, ["Categoría", "Concepto / Ítem", "Proveedor", "Costo Unitario (MXN)", "Cantidad",
                         "Subtotal (MXN)", "Estatus", "Responsable de Cotizar", "Notas"])
    r = 6
    first_item = r
    sub_cells = {}
    status_ranges, resp_ranges, num_ranges = [], [], []
    for idx, (cat, items) in enumerate(PD_SECTIONS, start=1):
        merge(ws, f"A{r}:I{r}", f"{idx}  ·  {cat.upper()}", bold=True, color=NAVY, bg=BAND, indent=1)
        r += 1
        start = r
        for concept, cost, qty, prov, nt in items:
            put(ws, f"A{r}", cat, size=9, color=SLATE_TXT)
            put(ws, f"B{r}", concept, wrap=True)
            put(ws, f"C{r}", prov, kind="input")
            if cost == "CA_TOTAL":
                put(ws, f"D{r}", f"={ca_total}", kind="link", fmt=MONEY)
            else:
                put(ws, f"D{r}", cost, kind="input", fmt=MONEY)
            if qty == "ASIST":
                put(ws, f"E{r}", f"={DB_ASIST}", kind="link", fmt=INT, h="center")
            elif cost == "CA_TOTAL":
                put(ws, f"E{r}", qty, fmt=INT, h="center")
            else:
                put(ws, f"E{r}", qty, kind="input", fmt=INT, h="center")
            put(ws, f"F{r}", f'=IF(AND(D{r}="",E{r}=""),"",D{r}*E{r})', fmt=MONEY, bold=True)
            put(ws, f"G{r}", "Cotizando", kind="input", h="center")
            put(ws, f"H{r}", None, kind="input")
            put(ws, f"I{r}", nt or None, size=9, color=SLATE_TXT, wrap=True)
            r += 1
        for _ in range(PD_BLANKS):
            put(ws, f"A{r}", cat, size=9, color=SLATE_TXT)
            for col in "BC":
                put(ws, f"{col}{r}", None, kind="input")
            put(ws, f"D{r}", None, kind="input", fmt=MONEY)
            put(ws, f"E{r}", None, kind="input", fmt=INT, h="center")
            put(ws, f"F{r}", f'=IF(AND(D{r}="",E{r}=""),"",D{r}*E{r})', fmt=MONEY, bold=True)
            put(ws, f"G{r}", None, kind="input", h="center")
            put(ws, f"H{r}", None, kind="input")
            put(ws, f"I{r}", None, kind="input", size=9)
            r += 1
        end = r - 1
        status_ranges.append(f"G{start}:G{end}")
        resp_ranges.append(f"H{start}:H{end}")
        num_ranges.append(f"D{start}:E{end}")
        merge(ws, f"A{r}:E{r}", f"Subtotal  ·  {cat}", bold=True, color=NAVY, bg=GOLD_LIGHT, h="right")
        put(ws, f"F{r}", f"=SUM(F{start}:F{end})", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
        for col in "GHI":
            put(ws, f"{col}{r}", None, bg=GOLD_LIGHT)
        sub_cells[cat] = f"F{r}"
        r += 2
    last_item = r - 2
    R["PD_FIRST"], R["PD_LAST"] = first_item, last_item

    for rng in status_ranges:
        dv_list(ws, rng, STATUS_PD)
        cf_text(ws, rng, {"Pagado": (OK_FILL, OK_TXT), "Confirmado": (INFO_FILL, INFO_TXT),
                          "Cotizando": (WARN_FILL, WARN_TXT)})
    for rng in resp_ranges:
        dv_list(ws, rng, source=LI_NAMES, strict=False,
                prompt="Elige a un amigo de la Lista_Invitados_y_Pagos o escribe otro nombre.")
    for rng in num_ranges:
        dv_number(ws, rng)

    # --- Resumen y gran total
    section(ws, f"A{r}:I{r}", "RESUMEN POR CATEGORÍA Y GRAN TOTAL")
    r += 1
    header_merged(ws, f"A{r}:C{r}", "Rubro")
    header_cells(ws, r, ["Base de Cálculo", "% / Cantidad", "Total (MXN)", "% del Gran Total"], 4)
    header_merged(ws, f"H{r}:I{r}", "Comentario")
    r += 1
    sum_first = r
    n_cats = len(PD_SECTIONS)
    sub_row, imp_row, gt_row = sum_first + n_cats, sum_first + n_cats + 1, sum_first + n_cats + 2
    GT = f"$F${gt_row}"
    R["PD_CAT"] = {}
    for cat, _ in PD_SECTIONS:
        merge(ws, f"A{r}:C{r}", cat, bold=True, color=NAVY)
        put(ws, f"D{r}", None)
        put(ws, f"E{r}", None)
        put(ws, f"F{r}", f"={sub_cells[cat]}", fmt=MONEY)
        put(ws, f"G{r}", f"=IFERROR(F{r}/{GT},0)", fmt=PCT)
        merge(ws, f"H{r}:I{r}", None)
        R["PD_CAT"][cat] = f"{PD}!$F${r}"
        r += 1
    merge(ws, f"A{r}:C{r}", "Subtotal General", bold=True, color=NAVY, bg=GOLD_LIGHT)
    put(ws, f"D{r}", None, bg=GOLD_LIGHT)
    put(ws, f"E{r}", None, bg=GOLD_LIGHT)
    put(ws, f"F{r}", f"=SUM(F{sum_first}:F{r - 1})", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
    put(ws, f"G{r}", f"=IFERROR(F{r}/{GT},0)", fmt=PCT, bold=True, bg=GOLD_LIGHT)
    merge(ws, f"H{r}:I{r}", None, bg=GOLD_LIGHT)
    assert r == sub_row
    r += 1
    merge(ws, f"A{r}:C{r}", f'="Fondo de Imprevistos ("&ROUND(E{r}*100,1)&"%)"', bold=True, color=NAVY, est=28)
    put(ws, f"D{r}", f"=F{sub_row}", fmt=MONEY)
    put(ws, f"E{r}", 0.10, kind="input", fmt=PCT, h="center", bold=True)
    put(ws, f"F{r}", f"=D{r}*E{r}", fmt=MONEY, bold=True)
    put(ws, f"G{r}", f"=IFERROR(F{r}/{GT},0)", fmt=PCT)
    merge(ws, f"H{r}:I{r}", "Calculado sobre el subtotal general; cambia el % en la columna E.",
          italic=True, size=9, color=SLATE_TXT, wrap=True)
    dv_number(ws, f"E{r}", minimum=0, maximum=1)
    assert r == imp_row
    r += 1
    merge(ws, f"A{r}:C{r}", "GRAN TOTAL DEL EVENTO", bold=True, size=12, color=WHITE, bg=NAVY, indent=1)
    put(ws, f"D{r}", None, bg=NAVY)
    put(ws, f"E{r}", None, bg=NAVY)
    put(ws, f"F{r}", f"=F{sub_row}+F{imp_row}", fmt=MONEY, bold=True, size=12, color=GOLD_TXT, bg=NAVY)
    put(ws, f"G{r}", f"=G{sub_row}+G{imp_row}", fmt=PCT, bold=True, color=WHITE, bg=NAVY)
    merge(ws, f"H{r}:I{r}", "→ Dashboard_Resumen", italic=True, color=WHITE, bg=NAVY)
    assert r == gt_row
    R["PD_SUBTOTAL"] = f"{PD}!$F${sub_row}"
    R["PD_PCT"] = f"{PD}!$E${imp_row}"
    R["PD_IMPREV"] = f"{PD}!$F${imp_row}"
    R["PD_TOTAL"] = f"{PD}!$F${gt_row}"

    autofit(ws, caps={"A": 26, "B": 56, "I": 52},
            mins={"C": 16, "D": 15, "E": 11, "F": 15, "G": 13, "H": 18})
    finish_sheet(ws, freeze="A6", zoom=90)
    return R


# --------------------------------------------------------------------------------------
# 2. Encuesta_y_Opciones
# --------------------------------------------------------------------------------------
def build_encuesta(ws, refs):
    R = {}
    ws.sheet_properties.tabColor = GOLD
    title(ws, "G", "ENCUESTA Y OPCIONES  ·  DEFINAMOS LA VIBRA DE LA POSADA",
          "Cómo usar: 1) Presenten las 3 opciones de cada rubro al grupo.  2) Capturen en 'Votos a Favor' cuántas "
          "personas (o parejas) eligen cada opción.  3) La opción con más votos se marca sola como ganadora y se "
          "resalta en verde; si hay empate, elijan en 'Decisión Manual'.  4) Ajusten el 'Precio de Referencia' "
          "cuando tengan cotizaciones reales. Precios precargados: estimados de mercado en México (2026), solo "
          "para comparar.")
    legend(ws, 3)
    header_cells(ws, 5, ["Categoría", "Concepto", "Opción A (Económica / Relax)", "Opción B (Intermedia)",
                         "Opción C (Full Producción)", "Decisión Manual (opcional)", "Opción Ganadora"])
    concepts = ["Opción (nombre corto)", "Propuesta (detalle)", "Pros / Consideraciones",
                "Precio de Referencia (MXN)", "Se Cobra Por", "Costo Estimado por Persona",
                "Costo Estimado por Pareja", "Costo Total del Evento", "Votos a Favor"]
    n = len(concepts)
    r = 6
    blocks = {}
    for blk in ENCUESTA:
        r0 = r
        rows = {k: r0 + i for i, k in enumerate(
            ["short", "desc", "pros", "price", "base", "pp", "pareja", "total", "votes"])}
        blocks[blk["cat"]] = rows
        merge(ws, f"A{r0}:A{r0 + n - 1}", blk["cat"], bold=True, size=12, color=WHITE, bg=NAVY,
              h="center", wrap=True)
        for i, label in enumerate(concepts):
            put(ws, f"B{r0 + i}", label, bold=True, color=NAVY, bg=BAND, size=9)
        for j, col in enumerate("CDE"):
            put(ws, f"{col}{rows['short']}", blk["short"][j], bold=True, color=NAVY, wrap=True)
            put(ws, f"{col}{rows['desc']}", blk["desc"][j], wrap=True, size=9)
            put(ws, f"{col}{rows['pros']}", blk["pros"][j], italic=True, size=9, color=SLATE_TXT, wrap=True)
            price = blk["price"][j]
            if isinstance(price, str):
                put(ws, f"{col}{rows['price']}", f"={refs[price]}", kind="link", fmt=MONEY)
                put(ws, f"{col}{rows['base']}", blk["base"][j], h="center", color=SLATE_TXT)
            else:
                put(ws, f"{col}{rows['price']}", price, kind="input", fmt=MONEY)
                put(ws, f"{col}{rows['base']}", blk["base"][j], kind="input", h="center")
                dv_list(ws, f"{col}{rows['base']}", ["Persona", "Evento"])
            put(ws, f"{col}{rows['pp']}",
                f'=IF({col}{rows["base"]}="Persona",{col}{rows["price"]},IFERROR({col}{rows["price"]}/{DB_ASIST},0))',
                fmt=MONEY, bold=True)
            put(ws, f"{col}{rows['pareja']}", f"={col}{rows['pp']}*2", fmt=MONEY)
            put(ws, f"{col}{rows['total']}", f"={col}{rows['pp']}*{DB_ASIST}", fmt=MONEY)
            put(ws, f"{col}{rows['votes']}", 0, kind="input", fmt="0", h="center", bold=True)
        v = rows["votes"]
        votes = f"C{v}:E{v}"
        merge(ws, f"F{r0}:F{r0 + n - 1}", None, kind="input", h="center", bold=True, wrap=True)
        merge(ws, f"G{r0}:G{r0 + n - 1}",
              f'=IF(F{r0}<>"",F{r0},IF(SUM({votes})=0,"Pendiente",IF(COUNTIF({votes},MAX({votes}))>1,"Empate",'
              f'CHOOSE(MATCH(MAX({votes}),{votes},0),"Opción A","Opción B","Opción C"))))',
              h="center", bold=True, size=12, est=9, wrap=True)
        dv_list(ws, f"F{r0}", OPCIONES)
        dv_number(ws, votes, whole=True)
        # Resaltar la opción ganadora (sin tapar las celdas de captura)
        for col, opt in zip("CDE", OPCIONES):
            for a, b in ((rows["short"], rows["pros"]), (rows["pp"], rows["total"])):
                ws.conditional_formatting.add(
                    f"{col}{a}:{col}{b}",
                    FormulaRule(formula=[f'$G${r0}="{opt}"'], fill=_fill(OK_FILL)))
        g = f"G{r0}"
        ws.conditional_formatting.add(g, FormulaRule(formula=[f'{g}="Pendiente"'],
                                      fill=_fill(WARN_FILL), font=Font(color=WARN_TXT, bold=True)))
        ws.conditional_formatting.add(g, FormulaRule(formula=[f'{g}="Empate"'],
                                      fill=_fill(BAD_FILL), font=Font(color=BAD_TXT, bold=True)))
        ws.conditional_formatting.add(g, FormulaRule(
            formula=[f'OR({g}="Opción A",{g}="Opción B",{g}="Opción C")'],
            fill=_fill(OK_FILL), font=Font(color=OK_TXT, bold=True)))
        # Línea de cierre del bloque
        last = r0 + n - 1
        for ci in range(1, 8):
            cell = ws.cell(last, ci)
            cell.border = Border(left=THIN, right=THIN, top=THIN, bottom=Side(style="medium", color=NAVY))
        r = r0 + n

    # --- Resumen de la votación
    r += 1
    section(ws, f"A{r}:G{r}", "RESUMEN DE LA VOTACIÓN  (alimenta el Dashboard_Resumen)")
    r += 1
    header_cells(ws, r, ["Categoría", "Opción Ganadora", "Propuesta Ganadora", "Votos Emitidos",
                         "Costo Est. por Persona", "Costo Est. por Pareja", "Costo Total del Evento"])
    r += 1
    sfirst = r
    R["EN_SUM"] = {}
    for blk in ENCUESTA:
        rows = blocks[blk["cat"]]
        g, v = f"G{rows['short']}", rows["votes"]

        def pick(row_key, default):
            rr = rows[row_key]
            return (f'IF(B{r}="Opción A",C{rr},IF(B{r}="Opción B",D{rr},IF(B{r}="Opción C",E{rr},{default})))')

        put(ws, f"A{r}", blk["cat"], bold=True, color=NAVY)
        put(ws, f"B{r}", f"={g}", h="center", bold=True, est=9)
        put(ws, f"C{r}", f'={pick("short", chr(34) + "—" + chr(34))}', wrap=True, est=40)
        put(ws, f"D{r}", f"=SUM(C{v}:E{v})", fmt="0", h="center")
        put(ws, f"E{r}", f'={pick("pp", 0)}', fmt=MONEY)
        put(ws, f"F{r}", f"=E{r}*2", fmt=MONEY)
        put(ws, f"G{r}", f'={pick("total", 0)}', fmt=MONEY, bold=True)
        R["EN_SUM"][blk["cat"]] = r
        r += 1
    slast = r - 1
    merge(ws, f"A{r}:D{r}", "TOTAL ESCENARIO GANADOR (solo rubros definidos)", bold=True, color=WHITE,
          bg=NAVY, indent=1)
    put(ws, f"E{r}", f"=SUM(E{sfirst}:E{slast})", fmt=MONEY, bold=True, color=GOLD_TXT, bg=NAVY)
    put(ws, f"F{r}", f"=SUM(F{sfirst}:F{slast})", fmt=MONEY, bold=True, color=GOLD_TXT, bg=NAVY)
    put(ws, f"G{r}", f"=SUM(G{sfirst}:G{slast})", fmt=MONEY, bold=True, color=GOLD_TXT, bg=NAVY)
    rng = f"B{sfirst}:B{slast}"
    cf_text(ws, rng, {"Pendiente": (WARN_FILL, WARN_TXT), "Empate": (BAD_FILL, BAD_TXT),
                      "Opción A": (OK_FILL, OK_TXT), "Opción B": (OK_FILL, OK_TXT),
                      "Opción C": (OK_FILL, OK_TXT)})
    r += 1
    note(ws, f"A{r}:G{r}",
         "Los rubros sin votos (Pendiente) o en empate suman $0 hasta definirse. En Dinámica Navideña con "
         "intercambio o elefante blanco, el costo por persona es el regalo que compra cada quien. En Bebidas, "
         "las opciones A y B se ligan en vivo al Cotizador_Alcohol.")

    autofit(ws, caps={"A": 20, "B": 28, "C": 38, "D": 38, "E": 38},
            mins={"C": 30, "D": 30, "E": 30, "F": 16, "G": 17})
    finish_sheet(ws, freeze="C6", zoom=90)
    return R


# --------------------------------------------------------------------------------------
# 6. Checklist_Logistica
# --------------------------------------------------------------------------------------
def build_checklist(ws):
    R = {}
    ws.sheet_properties.tabColor = "B08D57"
    title(ws, "H", "CHECKLIST DE LOGÍSTICA",
          "Plan de acción cronológico. Las fechas límite se calculan solas a partir de la Fecha del Evento "
          "(Dashboard_Resumen); asigna un responsable y actualiza el Estatus. La alerta avisa si una tarea "
          "está vencida o vence en 3 días o menos.")
    legend(ws, 3, items=("input", "calc", "link"))
    header_cells(ws, 5, ["Fase", "Fecha Límite", "Tarea", "Pestaña Relacionada", "Responsable", "Estatus",
                         "Días Restantes", "Alerta"])
    r = 6
    first = r
    for phase, offset, tasks in CHECKLIST:
        sign = "+" if offset >= 0 else "-"
        merge(ws, f"A{r}:H{r}", phase.upper(), bold=True, color=NAVY, bg=BAND, indent=1)
        r += 1
        for task, tab in tasks:
            put(ws, f"A{r}", phase, size=9, color=SLATE_TXT)
            put(ws, f"B{r}", f"={DB_FECHA}{sign}{abs(offset)}" if offset else f"={DB_FECHA}",
                kind="link", fmt=DATE, h="center")
            put(ws, f"C{r}", task, wrap=True)
            put(ws, f"D{r}", tab, size=9, color=SLATE_TXT, h="center")
            put(ws, f"E{r}", None, kind="input")
            put(ws, f"F{r}", "Pendiente", kind="input", h="center")
            put(ws, f"G{r}", f'=IF(F{r}="Hecho","",B{r}-TODAY())', fmt=DAYS, h="center")
            put(ws, f"H{r}", f'=IF(F{r}="Hecho","Completada",IF(B{r}<TODAY(),"Vencida",'
                             f'IF(B{r}-TODAY()<=3,"Urgente","En tiempo")))', h="center", est=10)
            r += 1
    last = r - 1
    rng = lambda col: f"{col}{first}:{col}{last}"
    dv_list(ws, rng("F"), STATUS_CL)
    dv_list(ws, rng("E"), source=LI_NAMES, strict=False,
            prompt="Elige a un amigo de la Lista_Invitados_y_Pagos o escribe otro nombre.")
    cf_text(ws, rng("F"), {"Hecho": (OK_FILL, OK_TXT), "En proceso": (WARN_FILL, WARN_TXT),
                           "Pendiente": (MUTED_FILL, MUTED_TXT)})
    cf_text(ws, rng("H"), {"Completada": (OK_FILL, OK_TXT), "Vencida": (BAD_FILL, BAD_TXT),
                           "Urgente": (WARN_FILL, WARN_TXT), "En tiempo": (INFO_FILL, INFO_TXT)})

    r += 1
    section(ws, f"A{r}:D{r}", "PROGRESO")
    items = [
        ("total", "Total de tareas", f"=COUNTA({rng('C')})", INT),
        ("done", "Tareas hechas", f'=COUNTIF({rng("F")},"Hecho")', INT),
        ("prog", "Tareas en proceso", f'=COUNTIF({rng("F")},"En proceso")', INT),
        ("pend", "Tareas pendientes", f'=COUNTIF({rng("F")},"Pendiente")', INT),
        ("late", "Tareas vencidas", f'=COUNTIF({rng("H")},"Vencida")', INT),
        ("pct", "% de avance", None, PCT),
    ]
    pos = {}
    for k, (key, label, f, fmt) in enumerate(items):
        pos[key] = r + 1 + k
    for key, label, f, fmt in items:
        rr = pos[key]
        if key == "pct":
            f = f"=IFERROR(B{pos['done']}/B{pos['total']},0)"
        put(ws, f"A{rr}", label, bold=True, color=NAVY, bg=BAND)
        put(ws, f"B{rr}", f, fmt=fmt, h="center", bold=True)
    ws.conditional_formatting.add(f"B{pos['late']}", CellIsRule(operator="greaterThan", formula=["0"],
                                  fill=_fill(BAD_FILL), font=Font(color=BAD_TXT, bold=True)))
    R["CL_TOTAL"] = f"{CL}!$B${pos['total']}"
    R["CL_DONE"] = f"{CL}!$B${pos['done']}"
    R["CL_PCT"] = f"{CL}!$B${pos['pct']}"

    autofit(ws, caps={"C": 70}, mins={"A": 18, "B": 13, "E": 18, "F": 13, "G": 13, "H": 13})
    finish_sheet(ws, freeze="A6")
    return R


# --------------------------------------------------------------------------------------
# 1. Dashboard_Resumen
# --------------------------------------------------------------------------------------
def build_dashboard(ws, R):
    ws.sheet_properties.tabColor = NAVY
    title(ws, "G", "POSADA 2026  ·  PANEL DE CONTROL",
          "Herramienta de decisión, votación y cotización para la posada del grupo (11 amigos + parejas). "
          "Edita solo las celdas color crema; todo lo demás se calcula a partir de las otras pestañas.")
    legend(ws, 3, items=("input", "calc", "link"))

    # Filas de cada sección (definidas aquí para poder referenciarlas desde los KPIs)
    FIN_HDR = 19
    fin_rows = {cat: FIN_HDR + 1 + i for i, (cat, _) in enumerate(PD_SECTIONS)}
    FIN_SUB = FIN_HDR + 1 + len(PD_SECTIONS)        # 26
    FIN_IMP, FIN_TOT, FIN_REF, FIN_NOTE = FIN_SUB + 1, FIN_SUB + 2, FIN_SUB + 3, FIN_SUB + 4
    OBJ_SEC = FIN_NOTE + 2
    OBJ_HDR = OBJ_SEC + 1
    obj_rows = [OBJ_HDR + 1, OBJ_HDR + 2, OBJ_HDR + 3]
    DEC_SEC = obj_rows[-1] + 3
    DEC_HDR = DEC_SEC + 1
    dec_rows = {blk["cat"]: DEC_HDR + 1 + i for i, blk in enumerate(ENCUESTA)}
    DEC_STAFF = DEC_HDR + 1 + len(ENCUESTA)
    DEC_DEF, DEC_PEND, DEC_GASTO, DEC_NOTE = DEC_STAFF + 1, DEC_STAFF + 2, DEC_STAFF + 3, DEC_STAFF + 4
    COB_SEC = DEC_NOTE + 2
    COB_HDR = COB_SEC + 1
    GUIA_SEC = COB_HDR + 7

    LI_RNG = lambda col: f"{LI}!${col}${LI_FIRST}:${col}${LI_LAST}"

    # --- Parámetros generales
    section(ws, "A5:B5", "PARÁMETROS GENERALES")
    section(ws, "D5:G5", "INDICADORES CLAVE")
    params = [
        (6, "Total de Amigos", 11, "input", INT),
        (7, "Parejas Confirmadas", 11, "input", INT),
        (8, "Total de Asistentes", "=B6+B7", "calc", INT),
        (9, "Confirmados en Lista de Invitados", f'=SUMIF({LI_RNG("C")},"Sí",{LI_RNG("D")})', "link", INT),
        (10, "Fecha del Evento", datetime(2026, 12, 19), "input", DATE),
        (11, "Hora de Inicio", time(20, 0), "input", HOUR),
        (12, "Dirección / Lugar", "Escribe aquí la dirección del lugar", "input", None),
        (13, "Presupuesto Objetivo por Pareja", 3000, "input", MONEY),
        (14, "Presupuesto Objetivo Individual", "=B13/2", "calc", MONEY),
        (15, "Presupuesto Objetivo Total", "=B14*B8", "calc", MONEY),
        (16, "Fondo de Imprevistos (%)", f"={R['PD_PCT']}", "link", PCT),
    ]
    for row, label, val, kind, fmt in params:
        put(ws, f"A{row}", label, bold=True, color=NAVY, bg=BAND)
        put(ws, f"B{row}", val, kind=kind, fmt=fmt, h="center", bold=kind == "input", wrap=row == 12)
    dv_number(ws, "B6:B7", whole=True)
    dv_number(ws, "B13")
    comment(ws, "B7", "Ajusta aquí cuántas parejas asistirán. Total de Asistentes = Amigos + Parejas; "
                      "este número reparte los costos y alimenta las cuotas.")
    comment(ws, "B10", "Fecha de ejemplo: escribe la fecha real. El Checklist_Logistica calcula sus "
                       "fechas límite a partir de esta celda.")
    comment(ws, "B13", "Valor de ejemplo ($3,000 por pareja): ajústenlo al presupuesto que acuerde el grupo.")
    assert DB_ASIST.endswith("$B$8") and DB_FECHA.endswith("$B$10")

    # --- Tarjetas KPI (etiqueta / valor / pie)
    def card(col, row, label, value, fmt, caption, kind="calc", cap_est=None):
        put(ws, f"{col}{row}", label, bold=True, size=9, color=WHITE, bg=SLATE, h="center", wrap=True)
        put(ws, f"{col}{row + 1}", value, kind=kind, fmt=fmt, bold=True, size=16,
            color=NAVY if kind == "calc" else None, h="center")
        put(ws, f"{col}{row + 2}", caption, italic=True, size=9, color=SLATE_TXT, bg=ZEBRA, h="center",
            wrap=True, est=cap_est)
        ws.row_dimensions[row + 1].height = 30

    card("D", 6, "COSTO TOTAL DEL EVENTO", f"=B{FIN_TOT}", MONEY, "Incluye fondo de imprevistos")
    card("E", 6, "COSTO POR PAREJA", "=F7*2", MONEY, "Costo individual × 2")
    card("F", 6, "COSTO INDIVIDUAL", "=IFERROR(D7/B8,0)", MONEY, '="Costo total ÷ "&B8&" asistentes"',
         cap_est=24)
    card("G", 6, "DIF. VS OBJETIVO (PAREJA)", "=B13-E7", MONEY,
         '=IF(G7>=0,"Dentro del presupuesto","Excede el presupuesto")', cap_est=22)
    card("D", 10, "ASISTENTES (PLAN)", "=B8", INT, '=B9&" confirmados en la lista"', cap_est=26)
    card("E", 10, "DÍAS PARA EL EVENTO", "=B10-TODAY()", DAYS,
         '=IF(E11<0,"El evento ya pasó",IF(E11=0,"¡Hoy es la posada!","Cuenta regresiva"))', cap_est=18)
    card("F", 10, "DECISIONES DEFINIDAS", f"=B{DEC_DEF}", '0 "de 5"', "Rubros votados en la Encuesta")
    card("G", 10, "COBRANZA RECAUDADA", f"=IFERROR({LI}!$F${LI_TOTAL}/{LI}!$E${LI_TOTAL},0)", PCT,
         f'="Anticipos: $"&FIXED({LI}!$F${LI_TOTAL},2)', kind="link", cap_est=22)
    card("D", 14, "AVANCE DEL CHECKLIST", f"={R['CL_PCT']}", PCT,
         f'={R["CL_DONE"]}&" de "&{R["CL_TOTAL"]}&" tareas hechas"', kind="link", cap_est=22)
    card("E", 14, "BEBIDAS POR ASISTENTE", f"={R['CA_PROM']}", DEC1, f"={R['CA_LECTURA']}", kind="link",
         cap_est=29)
    card("F", 14, "SALDO POR COBRAR", f"={LI}!$G${LI_TOTAL}", MONEY, "Cuotas asignadas − anticipos",
         kind="link")
    card("G", 14, "AVANCE DE COTIZACIÓN", f"=G{FIN_SUB}", PCT, "Monto confirmado o pagado")
    assert DB_COSTO_IND.endswith("$F$7")
    cf_sign(ws, "G7")
    cf_text(ws, "G8", {"Dentro del presupuesto": (OK_FILL, OK_TXT), "Excede el presupuesto": (BAD_FILL, BAD_TXT)})
    ws.conditional_formatting.add("E15", FormulaRule(formula=['LEFT(E16,5)="Corto"'],
                                  font=Font(color=BAD_TXT, bold=True)))

    # --- Resumen financiero
    section(ws, f"A{FIN_HDR - 1}:G{FIN_HDR - 1}", "RESUMEN FINANCIERO  (Presupuesto_Detallado + Cotizador_Alcohol)")
    header_cells(ws, FIN_HDR, ["Rubro", "Presupuesto Detallado (MXN)", "% del Total", "Costo por Persona",
                               "Costo por Pareja", "Estimado según Votación*", "Avance de Cotización**"])
    pd_cat = f"{PD}!$A${R['PD_FIRST']}:$A${R['PD_LAST']}"
    pd_sub = f"{PD}!$F${R['PD_FIRST']}:$F${R['PD_LAST']}"
    pd_st = f"{PD}!$G${R['PD_FIRST']}:$G${R['PD_LAST']}"
    for cat, row in fin_rows.items():
        put(ws, f"A{row}", cat, bold=True, color=NAVY)
        put(ws, f"B{row}", f"={R['PD_CAT'][cat]}", kind="link", fmt=MONEY)
        put(ws, f"C{row}", f"=IFERROR(B{row}/$B${FIN_TOT},0)", fmt=PCT)
        put(ws, f"D{row}", f"=IFERROR(B{row}/$B$8,0)", fmt=MONEY)
        put(ws, f"E{row}", f"=D{row}*2", fmt=MONEY)
        en_cat = PD_TO_EN[cat]
        if en_cat:
            put(ws, f"F{row}", f"={EN}!$G${R['EN_SUM'][en_cat]}", kind="link", fmt=MONEY)
        else:
            put(ws, f"F{row}", "No aplica", h="center", italic=True, color=SLATE_TXT)
        put(ws, f"G{row}", f'=IFERROR((SUMIFS({pd_sub},{pd_cat},A{row},{pd_st},"Confirmado")'
                           f'+SUMIFS({pd_sub},{pd_cat},A{row},{pd_st},"Pagado"))/B{row},0)', fmt=PCT, h="center")
    f0, f1 = FIN_HDR + 1, FIN_SUB - 1
    put(ws, f"A{FIN_SUB}", "Subtotal General", bold=True, color=NAVY, bg=GOLD_LIGHT)
    put(ws, f"B{FIN_SUB}", f"=SUM(B{f0}:B{f1})", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
    put(ws, f"C{FIN_SUB}", f"=IFERROR(B{FIN_SUB}/$B${FIN_TOT},0)", fmt=PCT, bold=True, bg=GOLD_LIGHT)
    put(ws, f"D{FIN_SUB}", f"=IFERROR(B{FIN_SUB}/$B$8,0)", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
    put(ws, f"E{FIN_SUB}", f"=D{FIN_SUB}*2", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
    put(ws, f"F{FIN_SUB}", f"=SUM(F{f0}:F{f1})", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
    put(ws, f"G{FIN_SUB}", f'=IFERROR((SUMIFS({pd_sub},{pd_st},"Confirmado")+SUMIFS({pd_sub},{pd_st},"Pagado"))'
                           f'/B{FIN_SUB},0)', fmt=PCT, bold=True, bg=GOLD_LIGHT, h="center")
    put(ws, f"A{FIN_IMP}", f'="Fondo de Imprevistos ("&ROUND({R["PD_PCT"]}*100,1)&"%)"', bold=True,
        color=NAVY, est=28)
    put(ws, f"B{FIN_IMP}", f"={R['PD_IMPREV']}", kind="link", fmt=MONEY)
    put(ws, f"C{FIN_IMP}", f"=IFERROR(B{FIN_IMP}/$B${FIN_TOT},0)", fmt=PCT)
    put(ws, f"D{FIN_IMP}", f"=IFERROR(B{FIN_IMP}/$B$8,0)", fmt=MONEY)
    put(ws, f"E{FIN_IMP}", f"=D{FIN_IMP}*2", fmt=MONEY)
    put(ws, f"F{FIN_IMP}", f"=F{FIN_SUB}*{R['PD_PCT']}", fmt=MONEY)
    put(ws, f"G{FIN_IMP}", None)
    put(ws, f"A{FIN_TOT}", "COSTO TOTAL DEL EVENTO", bold=True, size=11, color=WHITE, bg=NAVY, indent=1)
    put(ws, f"B{FIN_TOT}", f"=B{FIN_SUB}+B{FIN_IMP}", fmt=MONEY, bold=True, size=12, color=GOLD_TXT, bg=NAVY)
    put(ws, f"C{FIN_TOT}", f"=C{FIN_SUB}+C{FIN_IMP}", fmt=PCT, bold=True, color=WHITE, bg=NAVY)
    put(ws, f"D{FIN_TOT}", f"=IFERROR(B{FIN_TOT}/$B$8,0)", fmt=MONEY, bold=True, color=WHITE, bg=NAVY)
    put(ws, f"E{FIN_TOT}", f"=D{FIN_TOT}*2", fmt=MONEY, bold=True, color=WHITE, bg=NAVY)
    put(ws, f"F{FIN_TOT}", f"=F{FIN_SUB}+F{FIN_IMP}", fmt=MONEY, bold=True, color=GOLD_TXT, bg=NAVY)
    put(ws, f"G{FIN_TOT}", None, bg=NAVY)
    put(ws, f"A{FIN_REF}", "Incluido en Bebidas: Gran Total del Cotizador_Alcohol", italic=True,
        color=SLATE_TXT, wrap=True)
    put(ws, f"B{FIN_REF}", f"={R['CA_TOTAL']}", kind="link", fmt=MONEY, italic=True)
    put(ws, f"C{FIN_REF}", f"=IFERROR(B{FIN_REF}/$B${FIN_TOT},0)", fmt=PCT, italic=True)
    note(ws, f"A{FIN_NOTE}:G{FIN_NOTE}",
         "*Estimado según la opción ganadora de cada rubro en Encuesta_y_Opciones (más imprevistos); vale $0 "
         "mientras el rubro siga pendiente. Sirve para comparar el estilo votado contra lo cotizado.  "
         "**Porcentaje del monto con estatus Confirmado o Pagado en Presupuesto_Detallado.")
    ws.conditional_formatting.add(f"G{f0}:G{FIN_SUB}", CellIsRule(operator="greaterThanOrEqual",
                                  formula=["1"], fill=_fill(OK_FILL), font=Font(color=OK_TXT, bold=True)))

    # --- Objetivo vs costo
    section(ws, f"A{OBJ_SEC}:G{OBJ_SEC}", "PRESUPUESTO OBJETIVO VS COSTO ESTIMADO")
    header_cells(ws, OBJ_HDR, ["Concepto", "Costo Estimado (Cotizaciones)", "Presupuesto Objetivo",
                               "Diferencia (Objetivo − Costo)", "Diferencia %"])
    header_merged(ws, f"F{OBJ_HDR}:G{OBJ_HDR}", "Estado")
    obj = [("Costo Total del Evento", f"=B{FIN_TOT}", "=B15"),
           ("Costo por Pareja", "=E7", "=B13"),
           ("Costo Individual", "=F7", "=B14")]
    for row, (label, cost, target) in zip(obj_rows, obj):
        put(ws, f"A{row}", label, bold=True, color=NAVY)
        put(ws, f"B{row}", cost, fmt=MONEY)
        put(ws, f"C{row}", target, fmt=MONEY)
        put(ws, f"D{row}", f"=C{row}-B{row}", fmt=MONEY, bold=True)
        put(ws, f"E{row}", f"=IFERROR(D{row}/C{row},0)", fmt=PCT, bold=True)
        merge(ws, f"F{row}:G{row}", f'=IF(D{row}>=0,"Dentro del presupuesto","Excede el presupuesto")',
              h="center", bold=True, est=22)
    o0, o1 = obj_rows[0], obj_rows[-1]
    cf_sign(ws, f"D{o0}:E{o1}")
    cf_text(ws, f"F{o0}:F{o1}", {"Dentro del presupuesto": (OK_FILL, OK_TXT),
                                 "Excede el presupuesto": (BAD_FILL, BAD_TXT)})
    note(ws, f"A{o1 + 1}:G{o1 + 1}", "Diferencia positiva (verde) = sobra presupuesto; negativa (rojo) = el costo "
                                     "estimado excede el objetivo acordado.")

    # --- Estatus de decisiones clave
    section(ws, f"A{DEC_SEC}:G{DEC_SEC}", "ESTATUS DE DECISIONES CLAVE")
    header_cells(ws, DEC_HDR, ["Rubro", "Opción Ganadora", "Propuesta Ganadora", "Votos Emitidos",
                               "Costo Est. por Persona", "Estatus de la Decisión", "Siguiente Paso"])
    for blk in ENCUESTA:
        row, s = dec_rows[blk["cat"]], R["EN_SUM"][blk["cat"]]
        put(ws, f"A{row}", blk["cat"], bold=True, color=NAVY)
        put(ws, f"B{row}", f"={EN}!$B${s}", kind="link", h="center", bold=True, est=9)
        put(ws, f"C{row}", f"={EN}!$C${s}", kind="link", wrap=True, est=40)
        put(ws, f"D{row}", f"={EN}!$D${s}", kind="link", fmt="0", h="center")
        put(ws, f"E{row}", f"={EN}!$E${s}", kind="link", fmt=MONEY)
        put(ws, f"F{row}", f'=IF(OR(B{row}="Opción A",B{row}="Opción B",B{row}="Opción C"),"Definida",'
                           f'IF(B{row}="Empate","Empate: desempatar","Pendiente de votación"))',
            h="center", bold=True, est=21, wrap=True)
        put(ws, f"G{row}", f'=IF(F{row}="Definida","Cotizar y confirmar proveedor",IF(F{row}="Empate: desempatar",'
                           f'"Elegir en Decisión Manual (Encuesta)","Votar en Encuesta_y_Opciones"))',
            wrap=True, est=36, size=9)
    st = DEC_STAFF
    staff_fin = fin_rows["Staff / Limpieza"]
    put(ws, f"A{st}", "Staff / Limpieza", bold=True, color=NAVY)
    put(ws, f"B{st}", "Sin votación", h="center", italic=True, color=SLATE_TXT)
    put(ws, f"C{st}", "Mesero y servicio de limpieza", wrap=True)
    put(ws, f"D{st}", "—", h="center")
    put(ws, f"E{st}", f"=D{staff_fin}", fmt=MONEY)
    put(ws, f"F{st}", f'=IF(G{staff_fin}>=1,"Confirmado","En cotización")', h="center", bold=True, est=14)
    put(ws, f"G{st}", "Confirmar mesero y servicio de limpieza", wrap=True, size=9)
    d0, d1 = dec_rows[ENCUESTA[0]["cat"]], dec_rows[ENCUESTA[-1]["cat"]]
    cf_text(ws, f"F{d0}:F{st}", {"Definida": (OK_FILL, OK_TXT), "Confirmado": (OK_FILL, OK_TXT),
                                 "Empate: desempatar": (BAD_FILL, BAD_TXT),
                                 "Pendiente de votación": (WARN_FILL, WARN_TXT),
                                 "En cotización": (WARN_FILL, WARN_TXT)})
    cf_text(ws, f"B{d0}:B{d1}", {"Pendiente": (WARN_FILL, WARN_TXT), "Empate": (BAD_FILL, BAD_TXT)})
    put(ws, f"A{DEC_DEF}", "Decisiones definidas", bold=True, color=NAVY, bg=GOLD_LIGHT)
    put(ws, f"B{DEC_DEF}", f'=COUNTIF(F{d0}:F{d1},"Definida")', fmt='0 "de 5"', h="center", bold=True,
        bg=GOLD_LIGHT)
    put(ws, f"A{DEC_PEND}", "Pendientes de votación o desempate", bold=True, color=NAVY, bg=GOLD_LIGHT)
    put(ws, f"B{DEC_PEND}", f"={len(ENCUESTA)}-B{DEC_DEF}", fmt="0", h="center", bold=True, bg=GOLD_LIGHT)
    ws.conditional_formatting.add(f"B{DEC_PEND}", CellIsRule(operator="greaterThan", formula=["0"],
                                  fill=_fill(WARN_FILL), font=Font(color=WARN_TXT, bold=True)))
    merge(ws, f"A{DEC_GASTO}:D{DEC_GASTO}", "Gasto estimado por persona según opciones ganadoras*",
          bold=True, color=NAVY, bg=GOLD_LIGHT)
    put(ws, f"E{DEC_GASTO}", f"=SUM(E{d0}:E{d1})", fmt=MONEY, bold=True, bg=GOLD_LIGHT)
    note(ws, f"A{DEC_NOTE}:G{DEC_NOTE}", "*Solo suma rubros ya definidos en la Encuesta. En Dinámica Navideña "
                                        "con intercambio incluye el regalo que compra cada quien.")

    # --- Cobranza y asistencia
    section(ws, f"A{COB_SEC}:G{COB_SEC}", "COBRANZA Y ASISTENCIA  (Lista_Invitados_y_Pagos)")
    header_cells(ws, COB_HDR, ["Concepto", "Monto (MXN)"], 1)
    header_cells(ws, COB_HDR, ["Estatus de Pago", "Amigos", "Asistencia", "Amigos / Personas"], 4)
    c0 = COB_HDR + 1
    cob = [
        ("Total de cuotas asignadas", f"={LI}!$E${LI_TOTAL}", MONEY, "link"),
        ("Anticipos recibidos", f"={LI}!$F${LI_TOTAL}", MONEY, "link"),
        ("Saldo pendiente por cobrar", f"={LI}!$G${LI_TOTAL}", MONEY, "link"),
        ("% recaudado", f"=IFERROR(B{c0 + 1}/B{c0},0)", PCT, "calc"),
        ("Diferencia cuotas vs costo total", f"=B{c0}-B{FIN_TOT}", MONEY, "calc"),
    ]
    pagos = ["Pagado", "Parcial", "Pendiente", "No asiste"]
    asis = [("Sí", f'=COUNTIF({LI_RNG("C")},"Sí")'),
            ("Pendiente", f'=COUNTIF({LI_RNG("C")},"Pendiente")'),
            ("No", f'=COUNTIF({LI_RNG("C")},"No")'),
            ("Personas confirmadas", "=B9"),
            ("Personas proyectadas", f"={LI}!$D${LI_TOTAL}")]
    for k in range(5):
        row = c0 + k
        label, f, fmt, kind = cob[k]
        put(ws, f"A{row}", label, bold=True, color=NAVY)
        put(ws, f"B{row}", f, kind=kind, fmt=fmt, bold=True)
        if k < len(pagos):
            put(ws, f"D{row}", pagos[k], h="center", bold=True)
            put(ws, f"E{row}", f'=COUNTIF({LI_RNG("H")},"{pagos[k]}")', kind="link", fmt=INT, h="center")
        put(ws, f"F{row}", asis[k][0], h="center", bold=True)
        put(ws, f"G{row}", asis[k][1], kind="link", fmt=INT, h="center")
    cf_text(ws, f"D{c0}:D{c0 + 3}", {"Pagado": (OK_FILL, OK_TXT), "Parcial": (WARN_FILL, WARN_TXT),
                                     "Pendiente": (BAD_FILL, BAD_TXT), "No asiste": (MUTED_FILL, MUTED_TXT)})
    cf_text(ws, f"F{c0}:F{c0 + 2}", {"Sí": (OK_FILL, OK_TXT), "Pendiente": (WARN_FILL, WARN_TXT),
                                     "No": (BAD_FILL, BAD_TXT)})
    dif = f"B{c0 + 4}"
    ws.conditional_formatting.add(dif, FormulaRule(formula=[f"ABS({dif})>1"], fill=_fill(WARN_FILL),
                                  font=Font(color=WARN_TXT, bold=True)))
    comment(ws, dif, "Debe ser ~$0. Si no, el número de personas en la lista no coincide con el Total de "
                     "Asistentes del panel de parámetros (o hay invitados que no asisten).")

    # --- Guía rápida
    section(ws, f"A{GUIA_SEC}:G{GUIA_SEC}", "GUÍA RÁPIDA")
    pasos = [
        "1.  Ajusta los parámetros generales (celdas crema): amigos, parejas, fecha, lugar y presupuesto objetivo.",
        "2.  Presenta las opciones en Encuesta_y_Opciones y captura los votos: la opción ganadora se calcula sola.",
        "3.  Define cantidades en Cotizador_Alcohol: el total de bebidas pasa automáticamente al presupuesto.",
        "4.  Sustituye los precios de referencia de Presupuesto_Detallado por cotizaciones reales y actualiza su estatus.",
        "5.  Registra confirmaciones y anticipos en Lista_Invitados_y_Pagos: la cuota sale del costo individual.",
        "6.  Da seguimiento en Checklist_Logistica: las fechas límite se calculan desde la fecha del evento.",
    ]
    for k, p in enumerate(pasos):
        row = GUIA_SEC + 1 + k
        merge(ws, f"A{row}:G{row}", p, h="left", indent=1, bg=ZEBRA if k % 2 else None, wrap=True)

    autofit(ws, caps={"A": 40, "B": 24, "C": 26, "G": 28},
            mins={"A": 34, "B": 20, "C": 16, "D": 23, "E": 23, "F": 23, "G": 23})
    finish_sheet(ws, landscape=True)


# --------------------------------------------------------------------------------------
def main():
    wb = Workbook()
    ws_db = wb.active
    ws_db.title = DB
    ws_en = wb.create_sheet(EN)
    ws_ca = wb.create_sheet(CA)
    ws_pd = wb.create_sheet(PD)
    ws_li = wb.create_sheet(LI)
    ws_cl = wb.create_sheet(CL)

    refs = {}
    refs.update(build_cotizador(ws_ca))
    refs.update(build_lista(ws_li))
    refs.update(build_presupuesto(ws_pd, refs["CA_TOTAL"]))
    refs.update(build_encuesta(ws_en, refs))
    refs.update(build_checklist(ws_cl))
    build_dashboard(ws_db, refs)

    for ws in wb.worksheets:
        fit_heights(ws)

    wb.active = 0
    wb.calculation = CalcProperties(fullCalcOnLoad=True)
    wb.properties.title = "Organización Posada 2026"
    wb.properties.creator = "Comité Posada 2026"
    wb.save(OUTPUT)
    print(f"Archivo generado: {OUTPUT}")


if __name__ == "__main__":
    main()
