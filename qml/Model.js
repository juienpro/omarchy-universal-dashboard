.pragma library

function stateDir(home) {
  return String(home || "") + "/.local/state/universal-dashboard"
}

function screenPath(home) {
  return stateDir(home) + "/screen.json"
}

function viewsIndexPath(home) {
  return stateDir(home) + "/views.json"
}

function carouselPath(home) {
  return stateDir(home) + "/carousel.json"
}

function emptyCarousel() {
  return {
    enabled: false,
    viewIds: null,
    intervalSec: 10,
    transition: "fade"
  }
}

function parseCarousel(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return emptyCarousel()
    var transition = data.transition === "slide" || data.transition === "scale" ? data.transition : "fade"
    var viewIds = null
    if (Array.isArray(data.viewIds) && data.viewIds.length) {
      viewIds = []
      for (var i = 0; i < data.viewIds.length; i++) {
        if (data.viewIds[i]) viewIds.push(String(data.viewIds[i]))
      }
      if (!viewIds.length) viewIds = null
    }
    var intervalSec = parseInt(data.intervalSec, 10)
    if (!intervalSec || intervalSec < 3) intervalSec = 10
    if (intervalSec > 600) intervalSec = 600
    return {
      enabled: !!data.enabled,
      viewIds: viewIds,
      intervalSec: intervalSec,
      transition: transition
    }
  } catch (e) {
    return emptyCarousel()
  }
}

function emptyScreen() {
  return {
    definition: null,
    inlineData: {},
    layout: {
      grid: { columns: 3, visible: false },
      placements: {},
      themeId: "default"
    },
    activeViewId: null,
    overlays: [],
    updatedAt: ""
  }
}

function parseScreen(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return emptyScreen()
    var overlays = []
    if (Array.isArray(data.overlays)) {
      for (var i = 0; i < data.overlays.length; i++) {
        var o = normalizeOverlay(data.overlays[i])
        if (o) overlays.push(o)
      }
    }
    return {
      definition: data.definition || null,
      inlineData: data.inlineData && typeof data.inlineData === "object" ? data.inlineData : {},
      layout: data.layout && typeof data.layout === "object" ? data.layout : emptyScreen().layout,
      activeViewId: data.activeViewId || null,
      overlays: overlays,
      updatedAt: data.updatedAt || ""
    }
  } catch (e) {
    return emptyScreen()
  }
}

function normalizeOverlay(raw) {
  if (!raw || typeof raw !== "object" || !raw.id) return null
  var mode = raw.mode === "dock" ? "dock" : "float"
  var anchor = String(raw.anchor || "top")
  var viewIds = null
  if (Array.isArray(raw.viewIds)) {
    viewIds = []
    for (var i = 0; i < raw.viewIds.length; i++) {
      if (raw.viewIds[i]) viewIds.push(String(raw.viewIds[i]))
    }
  }
  var opacity = Number(raw.opacity)
  if (!isFinite(opacity) || opacity < 0) opacity = 1
  if (opacity > 1) opacity = 1
  var order = parseInt(raw.order, 10)
  if (!isFinite(order) || order < 0) order = 0
  return {
    id: String(raw.id),
    slug: String(raw.slug || raw.id),
    title: String(raw.title || raw.slug || raw.id),
    mode: mode,
    anchor: anchor,
    width: raw.width,
    height: raw.height,
    opacity: opacity,
    order: order,
    viewIds: viewIds,
    definition: raw.definition || null,
    layout: raw.layout && typeof raw.layout === "object" ? raw.layout : emptyScreen().layout,
    updatedAt: String(raw.updatedAt || "")
  }
}

/** Dock edge for an overlay anchor, or "" if none (center / float-only). */
function overlayDockEdge(anchor) {
  var a = String(anchor || "")
  if (a === "top" || a === "top-left" || a === "top-right") return "top"
  if (a === "bottom" || a === "bottom-left" || a === "bottom-right") return "bottom"
  if (a === "left" || a === "center-left") return "left"
  if (a === "right" || a === "center-right") return "right"
  return ""
}

function overlayHAlign(anchor) {
  var a = String(anchor || "")
  if (a === "top-left" || a === "bottom-left" || a === "left" || a === "center-left") return "start"
  if (a === "top-right" || a === "bottom-right" || a === "right" || a === "center-right") return "end"
  return "center"
}

function overlayVAlign(anchor) {
  var a = String(anchor || "")
  if (a === "top" || a === "top-left" || a === "top-right") return "start"
  if (a === "bottom" || a === "bottom-left" || a === "bottom-right") return "end"
  return "center"
}

/** Resolve width/height against axis px. Returns 0 when content-sized (caller uses implicit). */
function overlaySizePx(size, axisPx) {
  if (size === undefined || size === null || size === "") return 0
  if (typeof size === "number") return size > 0 ? size : 0
  var s = String(size)
  if (s.charAt(s.length - 1) === "%") {
    var pct = parseFloat(s)
    if (!isFinite(pct) || axisPx <= 0) return 0
    return Math.max(1, axisPx * pct / 100)
  }
  var n = parseFloat(s)
  return isFinite(n) && n > 0 ? n : 0
}

function screenOverlays(screen) {
  if (!screen || !Array.isArray(screen.overlays)) return []
  return screen.overlays
}

function dockOverlays(screen, edge) {
  var list = screenOverlays(screen)
  var out = []
  for (var i = 0; i < list.length; i++) {
    var o = list[i]
    if (!o || o.mode !== "dock") continue
    if (overlayDockEdge(o.anchor) === edge) out.push(o)
  }
  return out
}

function floatOverlays(screen) {
  var list = screenOverlays(screen)
  var out = []
  for (var i = 0; i < list.length; i++) {
    var o = list[i]
    if (!o || o.mode === "dock") continue
    out.push(o)
  }
  return out
}

/** Fake screen object so IrView can render an overlay definition with shared inlineData. */
function overlayAsScreen(overlay, inlineData) {
  if (!overlay) return emptyScreen()
  return {
    definition: overlay.definition || null,
    inlineData: inlineData && typeof inlineData === "object" ? inlineData : {},
    layout: overlay.layout && typeof overlay.layout === "object" ? overlay.layout : emptyScreen().layout,
    activeViewId: null,
    overlays: [],
    updatedAt: overlay.updatedAt || ""
  }
}

function parseViews(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return []
    var list = Array.isArray(data.views) ? data.views : []
    var out = []
    for (var i = 0; i < list.length; i++) {
      var v = list[i]
      if (!v || typeof v !== "object") continue
      if (!v.id || !v.slug) continue
      out.push({
        id: String(v.id),
        slug: String(v.slug),
        title: String(v.title || v.slug),
        updatedAt: String(v.updatedAt || "")
      })
    }
    return out
  } catch (e) {
    return []
  }
}

function screenTitle(screen) {
  if (!screen || !screen.definition) return ""
  return String(screen.definition.title || "")
}

function hasContent(screen) {
  return !!(screen && screen.definition && screen.definition.root)
}

function viewIndex(views, activeViewId) {
  if (!activeViewId || !Array.isArray(views)) return -1
  for (var i = 0; i < views.length; i++) {
    if (views[i].id === activeViewId) return i
  }
  return -1
}

function nextViewId(views, activeViewId, delta) {
  if (!Array.isArray(views) || views.length === 0) return null
  var idx = viewIndex(views, activeViewId)
  if (idx < 0) idx = delta > 0 ? -1 : 0
  var next = (idx + delta + views.length) % views.length
  return views[next].id
}

/** Ordered subset of views for carousel (missing ids skipped). Empty viewIds → all views. */
function carouselPool(views, viewIds) {
  if (!Array.isArray(views) || views.length === 0) return []
  if (!viewIds || !viewIds.length) return views
  var out = []
  for (var i = 0; i < viewIds.length; i++) {
    var id = String(viewIds[i])
    for (var j = 0; j < views.length; j++) {
      if (views[j].id === id) {
        out.push(views[j])
        break
      }
    }
  }
  return out
}

function nextCarouselViewId(views, viewIds, activeViewId, delta) {
  return nextViewId(carouselPool(views, viewIds), activeViewId, delta || 1)
}

function datasetOf(screen, key) {
  if (!screen || !key) return null
  var data = screen.inlineData || {}
  return data[key] !== undefined ? data[key] : null
}

function asRows(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") return [data]
  return []
}

function readField(row, field) {
  if (!row || !field) return undefined
  var parts = String(field).split(".")
  var cur = row
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[parts[i]]
  }
  return cur
}

function boundText(props, screen, dataRow) {
  if (!props) return ""
  if (props.textField) {
    var row = dataRow !== undefined && dataRow !== null
      ? dataRow
      : (props.dataset ? (asRows(datasetOf(screen, props.dataset))[0] || null) : null)
    if (row) {
      var val = readField(row, props.textField)
      if (val !== undefined && val !== null) return String(val)
    }
  }
  return props.text !== undefined && props.text !== null ? String(props.text) : ""
}

/** Image / Video URL from `src` or `srcField` (+ optional `dataset` / stamped row). */
function boundSrc(props, screen, dataRow) {
  if (!props) return ""
  if (props.srcField) {
    var row = dataRow !== undefined && dataRow !== null
      ? dataRow
      : (props.dataset ? (asRows(datasetOf(screen, props.dataset))[0] || null) : null)
    if (row) {
      var val = readField(row, props.srcField)
      if (val !== undefined && val !== null && String(val).length) return String(val)
    }
  }
  return props.src !== undefined && props.src !== null ? String(props.src) : ""
}

/**
 * Youtube watch input: videoId / videoIdField wins, else src / srcField
 * (watch URL, youtu.be, embed, or bare id).
 */
function youtubeInput(props, screen, dataRow) {
  if (!props) return ""
  var row = dataRow !== undefined && dataRow !== null
    ? dataRow
    : (props.dataset ? (asRows(datasetOf(screen, props.dataset))[0] || null) : null)
  if (props.videoIdField && row) {
    var idField = readField(row, props.videoIdField)
    if (idField !== undefined && idField !== null && String(idField).length)
      return String(idField).trim()
  }
  if (props.videoId !== undefined && props.videoId !== null && String(props.videoId).length)
    return String(props.videoId).trim()
  if (props.srcField && row) {
    var srcField = readField(row, props.srcField)
    if (srcField !== undefined && srcField !== null && String(srcField).length)
      return String(srcField).trim()
  }
  if (props.src !== undefined && props.src !== null && String(props.src).length)
    return String(props.src).trim()
  return ""
}

/** Re-resolve interval for Youtube (sec). Default 1200; clamp 300..86400. */
function youtubeResolveIntervalSec(props) {
  var p = props || {}
  var n = parseInt(p.resolveIntervalSec, 10)
  if (!isFinite(n)) n = 1200
  if (n < 300) n = 300
  if (n > 86400) n = 86400
  return n
}

/**
 * Video widget height: explicit `height` wins; else `size` token; else 240.
 * Tokens: xs=120 sm=160 md=240 lg=320 xl=400 2xl=480
 * When `aspect` is `16:9` / `16/9` and width > 0, height = width * 9/16
 * (wins over size; still clamped 80–1200). Explicit `height` still wins.
 */
function videoHeight(props, width) {
  var p = props || {}
  if (p.height != null) {
    var h = parseInt(p.height, 10)
    if (isFinite(h)) {
      if (h < 80) h = 80
      if (h > 1200) h = 1200
      return h
    }
  }
  var aspect = String(p.aspect || "").replace(/\s/g, "")
  if ((aspect === "16:9" || aspect === "16/9") && width != null) {
    var w = Number(width)
    if (isFinite(w) && w > 0) {
      var ah = Math.round(w * 9 / 16)
      if (ah < 80) ah = 80
      if (ah > 1200) ah = 1200
      return ah
    }
  }
  var token = String(p.size || "md")
  var map = { xs: 120, sm: 160, md: 240, lg: 320, xl: 400, "2xl": 480 }
  return map[token] || 240
}

/**
 * VideoOutput fillMode from props.fit. Default cover (no letterbox).
 * contain → PreserveAspectFit, cover → PreserveAspectCrop, stretch → Stretch.
 */
function videoFillMode(props) {
  var fit = String((props && props.fit) || "cover").toLowerCase()
  if (fit === "contain" || fit === "fit") return "contain"
  if (fit === "stretch" || fit === "fill") return "stretch"
  return "cover"
}

/**
 * Image widget height: explicit `height` (40–2000), else default 160.
 */
function imageHeight(props) {
  var p = props || {}
  if (p.height != null) {
    var h = parseInt(p.height, 10)
    if (isFinite(h)) {
      if (h < 40) h = 40
      if (h > 2000) h = 2000
      return h
    }
  }
  return 160
}

/** Alt text for Image — `altField` (+ dataset / row) or static `alt`. */
function boundAlt(props, screen, dataRow) {
  if (!props) return ""
  if (props.altField) {
    var row = dataRow !== undefined && dataRow !== null
      ? dataRow
      : (props.dataset ? (asRows(datasetOf(screen, props.dataset))[0] || null) : null)
    if (row) {
      var val = readField(row, props.altField)
      if (val !== undefined && val !== null && String(val).length) return String(val)
    }
  }
  return props.alt !== undefined && props.alt !== null ? String(props.alt) : ""
}

/**
 * Anchor / link label: `labelField` (+ dataset / row) or static `label`.
 */
function boundLabel(props, screen, dataRow) {
  if (!props) return ""
  if (props.labelField) {
    var row = dataRow !== undefined && dataRow !== null
      ? dataRow
      : (props.dataset ? (asRows(datasetOf(screen, props.dataset))[0] || null) : null)
    if (row) {
      var val = readField(row, props.labelField)
      if (val !== undefined && val !== null && String(val).length) return String(val)
    }
  }
  return props.label !== undefined && props.label !== null ? String(props.label) : ""
}

/**
 * Anchor href: `hrefField` (+ dataset / row) or static `href`, http(s) only.
 */
function boundHref(props, screen, dataRow) {
  if (!props) return ""
  var raw = ""
  if (props.hrefField) {
    var row = dataRow !== undefined && dataRow !== null
      ? dataRow
      : (props.dataset ? (asRows(datasetOf(screen, props.dataset))[0] || null) : null)
    if (row) {
      var val = readField(row, props.hrefField)
      if (val !== undefined && val !== null) raw = String(val)
    }
  }
  if (!raw.length && props.href !== undefined && props.href !== null)
    raw = String(props.href)
  return openableUrl(raw)
}

/**
 * Marquee / ticker text. With dataset + textField and multiple rows, joins
 * all field values (separator default " · "). Otherwise same as boundText.
 */
function boundMarqueeText(props, screen, dataRow) {
  if (!props) return ""
  if (props.textField && props.dataset && (dataRow === undefined || dataRow === null)) {
    var rows = asRows(datasetOf(screen, props.dataset))
    if (rows.length > 1) {
      var sep = props.separator !== undefined && props.separator !== null
        ? String(props.separator)
        : " · "
      var parts = []
      for (var i = 0; i < rows.length; i++) {
        var val = readField(rows[i], props.textField)
        if (val !== undefined && val !== null && String(val).length)
          parts.push(String(val))
      }
      if (parts.length) return parts.join(sep)
    }
  }
  return boundText(props, screen, dataRow)
}

function formatValue(value) {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") {
    if (!isFinite(value)) return "—"
    if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    return String(Math.round(value * 100) / 100)
  }
  return String(value)
}

function pickStatRow(props, screen, dataRow) {
  if (dataRow !== undefined && dataRow !== null) return dataRow
  var rows = asRows(datasetOf(screen, props.dataset))
  if (!rows.length) return null
  if (props.where && props.where.field !== undefined) {
    for (var i = 0; i < rows.length; i++) {
      if (readField(rows[i], props.where.field) === props.where.equals) return rows[i]
    }
    return null
  }
  return rows[0]
}

function gapPx(token) {
  switch (String(token || "md")) {
    case "xs": return 4
    case "sm": return 8
    case "md": return 12
    case "lg": return 18
    case "xl": return 24
    case "2xl": return 32
    default: return 12
  }
}

/** Map IR size token → Style.font property name (resolved in QML). */
function fontToken(token) {
  switch (String(token || "md")) {
    case "xs": return "caption"
    case "sm": return "bodySmall"
    case "md": return "body"
    case "lg": return "title"
    case "xl": return "display"
    case "2xl": return "displayLarge"
    default: return "body"
  }
}

/** Table header: one step smaller than cell `fontToken(size)`. */
function tableHeaderFontToken(token) {
  switch (String(token || "md")) {
    case "xs":
    case "sm":
      return "caption"
    case "md":
      return "bodySmall"
    case "lg":
      return "body"
    case "xl":
      return "title"
    case "2xl":
      return "display"
    default:
      return "bodySmall"
  }
}

/** List meta line: two steps smaller than title `fontToken(size)`. */
function listMetaFontToken(token) {
  switch (String(token || "md")) {
    case "xs":
    case "sm":
    case "md":
      return "caption"
    case "lg":
      return "bodySmall"
    case "xl":
      return "body"
    case "2xl":
      return "title"
    default:
      return "caption"
  }
}

/** Only http(s) — used before Qt.openUrlExternally from table cells. */
function openableUrl(value) {
  var u = String(value == null ? "" : value).trim()
  if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u
  return ""
}

/**
 * Icon glyph size in px — independent of Style.font / text tokens.
 * Same approach as omarchy.weather hero: raw pixelSize (64), not displayLarge (~28).
 * 2xl/hero = 64 (native weather); 3xl…6xl go larger for dashboard heroes.
 */
function iconPx(token) {
  switch (String(token || "md")) {
    case "xs": return 20
    case "sm": return 28
    case "md": return 36
    case "lg": return 48
    case "xl": return 56
    case "2xl":
    case "hero": return 64
    case "3xl": return 80
    case "4xl": return 96
    case "5xl": return 128
    case "6xl": return 160
    default: return 36
  }
}

/** @deprecated use iconPx — kept for older QML that still calls this name. */
function iconFontToken(token) {
  return "displayLarge"
}

/**
 * Screen placement resolver (same rules as packages/ir resolveLayoutPositions).
 * Returns [{ id, colStart, colspan, row }, ...] with 1-based col/row.
 * With column set, index is a 0-based row (not add-order in that column).
 */
function resolveLayoutPositions(columns, ids, placements) {
  var cols = Math.max(1, Math.floor(columns || 3))
  var occupied = {}
  var results = []
  var autoRow = 1
  var autoCol = 1

  function key(r, c) { return String(r) + "," + String(c) }
  function occupies(row, colStart, colspan) {
    for (var c = colStart; c < colStart + colspan; c++) {
      if (occupied[key(row, c)]) return true
    }
    return false
  }
  function mark(row, colStart, colspan) {
    for (var c = colStart; c < colStart + colspan; c++) occupied[key(row, c)] = true
  }
  function colspanOf(p) {
    var n = p && p.colspan != null ? Math.floor(p.colspan) : 1
    if (n < 1) n = 1
    if (n > cols) n = cols
    return n
  }

  var list = Array.isArray(ids) ? ids : []
  var pl = placements && typeof placements === "object" ? placements : {}

  for (var i = 0; i < list.length; i++) {
    var id = list[i]
    var p = pl[id] || {}
    var colspan = colspanOf(p)

    if (p.column != null) {
      var colStart = Math.floor(p.column)
      if (colStart < 1) colStart = 1
      if (colStart > cols) colStart = cols
      if (colStart + colspan - 1 > cols) colspan = cols - colStart + 1

      var row = p.index != null ? Math.max(0, Math.floor(p.index)) + 1 : 1
      while (occupies(row, colStart, colspan)) row++

      mark(row, colStart, colspan)
      results.push({ id: id, colStart: colStart, colspan: colspan, row: row })
      continue
    }

    while (occupies(autoRow, autoCol, colspan)) {
      autoCol++
      if (autoCol + colspan - 1 > cols) {
        autoRow++
        autoCol = 1
      }
    }
    mark(autoRow, autoCol, colspan)
    results.push({ id: id, colStart: autoCol, colspan: colspan, row: autoRow })
    autoCol += colspan
    if (autoCol > cols) {
      autoRow++
      autoCol = 1
    }
  }
  return results
}

/** Root widget cells for the live screen placement grid. */
function placedRootCells(screen) {
  if (!screen || !screen.definition || !screen.definition.nodes) return []
  var rootId = screen.definition.root
  var root = rootId ? screen.definition.nodes[rootId] : null
  if (!root || !Array.isArray(root.children) || root.children.length === 0) return []
  var columns = 3
  if (screen.layout && screen.layout.grid && screen.layout.grid.columns)
    columns = Math.max(1, Math.floor(screen.layout.grid.columns))
  var placements = screen.layout && screen.layout.placements ? screen.layout.placements : {}
  return resolveLayoutPositions(columns, root.children, placements)
}

function gridColumnCount(screen) {
  if (screen && screen.layout && screen.layout.grid && screen.layout.grid.columns)
    return Math.max(1, Math.floor(screen.layout.grid.columns))
  return 3
}

/** Resolve Icon glyph from props + optional dataset row (or stamped dataRow). */
function boundGlyph(props, screen, dataRow) {
  if (!props) return ""
  if (props.glyphField) {
    var row = dataRow !== undefined && dataRow !== null
      ? dataRow
      : (props.dataset ? pickStatRow(props, screen) : null)
    var val = readField(row, props.glyphField)
    if (val !== undefined && val !== null && String(val).length) return String(val)
  }
  return props.glyph !== undefined && props.glyph !== null ? String(props.glyph) : ""
}

/** Map Title.order → Style.font property name. */
function titleToken(order) {
  var n = parseInt(order, 10) || 2
  if (n <= 1) return "display"
  if (n === 2) return "heading"
  if (n === 3) return "title"
  return "body"
}

function textColor(token, colors) {
  var c = colors || {}
  switch (String(token || "default")) {
    case "muted":
    case "dimmed":
      return c.muted || c.dim || "#888"
    case "primary":
    case "accent":
    case "cyan":
      return c.accent || c.primary || "#6cf"
    case "positive":
    case "green":
      return c.positive || c.accent || "#3a7"
    case "negative":
    case "red":
      return c.negative || "#c44"
    case "warning":
    case "yellow":
    case "orange":
      return c.warning || c.accent || "#ca4"
    case "text":
    case "white":
    case "default":
    default:
      return c.foreground || "#eee"
  }
}

/** Chart kinds drawn by ChartWidget.qml (others show a stub). */
function chartKindSupported(kind) {
  switch (String(kind || "")) {
    case "line":
    case "area":
    case "bar":
    case "barStacked":
    case "scatter":
    case "pie":
    case "donut":
    case "gauge":
      return true
    default:
      return false
  }
}

/**
 * Normalize Chart props + dataset into paint-ready series.
 * { kind, labels, series:[{name,values}], height, supported }
 */
function chartPayload(props, screen) {
  var p = props || {}
  var kind = String(p.kind || "line")
  var rows = asRows(datasetOf(screen, p.dataset))
  var yFields = Array.isArray(p.y) ? p.y : []
  var labels = []
  var series = []
  var yi, i

  for (yi = 0; yi < yFields.length; yi++) {
    series.push({
      name: String(yFields[yi]).replace(/_/g, " "),
      field: String(yFields[yi]),
      values: []
    })
  }

  for (i = 0; i < rows.length; i++) {
    labels.push(formatValue(readField(rows[i], p.x)))
    for (yi = 0; yi < series.length; yi++) {
      var n = Number(readField(rows[i], series[yi].field))
      series[yi].values.push(isFinite(n) ? n : null)
    }
  }

  var h = parseInt(p.height, 10)
  if (!isFinite(h) || h < 120) h = 280
  if (h > 1200) h = 1200

  return {
    kind: kind,
    labels: labels,
    series: series,
    height: h,
    supported: chartKindSupported(kind)
  }
}

/** Fallback series colors when theme only exposes accent/urgent. */
function chartSeriesColors(colors) {
  var c = colors || {}
  var out = []
  if (c.accent) out.push(c.accent)
  if (c.positive && out.indexOf(c.positive) < 0) out.push(c.positive)
  if (c.warning && out.indexOf(c.warning) < 0) out.push(c.warning)
  if (c.negative && out.indexOf(c.negative) < 0) out.push(c.negative)
  var extras = ["#7ec8ff", "#e879f9", "#3dd68c", "#f5c542", "#ff8a3d", "#ff5c7a"]
  for (var i = 0; i < extras.length; i++) out.push(extras[i])
  return out.length ? out : ["#6cf"]
}
