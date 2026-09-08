import QtQuick
import qs.Commons
import "Model.js" as Model

/**
 * Canvas Chart for IR Chart nodes (no QtCharts on Omarchy).
 * Supports: line, area, bar, barStacked, scatter, pie, donut, gauge.
 */
Item {
  id: root
  property var props: ({})
  property var screen: null
  property var colors: ({})
  property string uiFont: Style.font.family

  readonly property var payload: Model.chartPayload(props, screen)
  readonly property var seriesColors: Model.chartSeriesColors(colors)
  readonly property var axisColor: (colors && colors.muted) ? colors.muted : ((colors && colors.dim) ? colors.dim : "#888")
  readonly property var textCol: (colors && colors.foreground) ? colors.foreground : "#eee"
  readonly property var gridColor: (colors && colors.muted) ? colors.muted : "#888"

  width: parent ? parent.width : 400
  height: payload.height || 280
  implicitHeight: height
  implicitWidth: width

  function colorAt(i) {
    var list = root.seriesColors
    if (!list || !list.length) return "#6cf"
    return list[i % list.length]
  }

  function withAlpha(col, a) {
    try {
      return Qt.rgba(col.r, col.g, col.b, a)
    } catch (e) {
      return col
    }
  }

  Text {
    anchors.fill: parent
    visible: !root.payload.supported
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
    wrapMode: Text.WordWrap
    textFormat: Text.PlainText
    text: "Chart kind \"" + root.payload.kind + "\" not rendered yet"
    color: root.axisColor
    font.family: root.uiFont
    font.pixelSize: Style.font.body
    font.italic: true
  }

  Text {
    anchors.fill: parent
    visible: root.payload.supported && (!root.payload.labels || root.payload.labels.length === 0)
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
    textFormat: Text.PlainText
    text: "No chart data"
    color: root.axisColor
    font.family: root.uiFont
    font.pixelSize: Style.font.body
    font.italic: true
  }

  Canvas {
    id: canvas
    anchors.fill: parent
    visible: root.payload.supported && root.payload.labels && root.payload.labels.length > 0
    antialiasing: true

    onPaint: {
      var ctx = getContext("2d")
      var w = width
      var h = height
      ctx.clearRect(0, 0, w, h)

      var p = root.payload
      if (!p || !p.supported || !p.labels || !p.labels.length) return

      var kind = p.kind
      if (kind === "pie" || kind === "donut") {
        paintPie(ctx, w, h, p, kind === "donut")
        return
      }
      if (kind === "gauge") {
        paintGauge(ctx, w, h, p)
        return
      }
      paintCartesian(ctx, w, h, p, kind)
    }

    function paintCartesian(ctx, w, h, p, kind) {
      var padL = 44
      var padR = 12
      var padT = 18
      var padB = 28
      var left = padL
      var right = w - padR
      var top = padT
      var bot = h - padB
      var innerW = Math.max(1, right - left)
      var innerH = Math.max(1, bot - top)
      var n = p.labels.length
      var stacked = kind === "barStacked"
      var isBar = kind === "bar" || stacked
      var isArea = kind === "area"
      var isScatter = kind === "scatter"
      var isLine = kind === "line" || isArea

      var minV = 0
      var maxV = 0
      var has = false
      var si, i, v, stack

      if (stacked) {
        for (i = 0; i < n; i++) {
          stack = 0
          for (si = 0; si < p.series.length; si++) {
            v = p.series[si].values[i]
            if (v !== null && v !== undefined && isFinite(v)) stack += v
          }
          if (!has) {
            minV = Math.min(0, stack)
            maxV = Math.max(0, stack)
            has = true
          } else {
            if (stack < minV) minV = stack
            if (stack > maxV) maxV = stack
          }
        }
      } else {
        for (si = 0; si < p.series.length; si++) {
          for (i = 0; i < p.series[si].values.length; i++) {
            v = p.series[si].values[i]
            if (v === null || v === undefined || !isFinite(v)) continue
            if (!has) {
              minV = v
              maxV = v
              has = true
            } else {
              if (v < minV) minV = v
              if (v > maxV) maxV = v
            }
          }
        }
        if (has && minV > 0 && isBar) minV = 0
      }
      if (!has) {
        minV = 0
        maxV = 1
      }
      var span = maxV - minV
      if (span === 0) span = Math.abs(maxV) * 0.01 || 1
      minV -= span * 0.06
      maxV += span * 0.06
      span = maxV - minV

      function xAt(idx) {
        if (n <= 1) return left + innerW / 2
        return left + innerW * (idx / (n - 1))
      }

      function yAt(val) {
        return top + innerH * (1 - (val - minV) / span)
      }

      // grid + axes
      ctx.save()
      ctx.strokeStyle = root.withAlpha(root.gridColor, 0.35)
      ctx.lineWidth = 1
      var ticks = 4
      for (i = 0; i <= ticks; i++) {
        var gv = minV + (span * i) / ticks
        var gy = yAt(gv)
        ctx.beginPath()
        ctx.moveTo(left, gy)
        ctx.lineTo(right, gy)
        ctx.stroke()
        ctx.fillStyle = root.axisColor
        ctx.font = Style.font.bodySmall + "px " + root.uiFont
        ctx.textAlign = "right"
        ctx.textBaseline = "middle"
        var label = Math.abs(gv) >= 1000 ? (Math.round(gv / 100) / 10) + "k" : String(Math.round(gv * 100) / 100)
        ctx.fillText(label, left - 6, gy)
      }
      ctx.strokeStyle = root.withAlpha(root.axisColor, 0.7)
      ctx.beginPath()
      ctx.moveTo(left, top)
      ctx.lineTo(left, bot)
      ctx.lineTo(right, bot)
      ctx.stroke()
      ctx.restore()

      // x labels (sparse)
      ctx.fillStyle = root.axisColor
      ctx.font = Style.font.caption + "px " + root.uiFont
      ctx.textAlign = "center"
      ctx.textBaseline = "top"
      var step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 56))))
      for (i = 0; i < n; i += step) {
        var xl = isBar ? left + (innerW * (i + 0.5)) / n : xAt(i)
        ctx.fillText(String(p.labels[i]).slice(0, 8), xl, bot + 6)
      }

      var seriesCount = Math.max(1, p.series.length)
      var groupW = innerW / n
      var barGap = groupW * 0.18
      var barW = isBar
        ? (stacked ? Math.max(2, groupW - barGap) : Math.max(2, (groupW - barGap) / seriesCount))
        : 0

      // series
      for (si = 0; si < p.series.length; si++) {
        var col = root.colorAt(si)
        var vals = p.series[si].values

        if (isBar) {
          for (i = 0; i < n; i++) {
            v = vals[i]
            if (v === null || v === undefined || !isFinite(v)) continue
            var base = 0
            if (stacked) {
              base = 0
              for (var s2 = 0; s2 < si; s2++) {
                var pv = p.series[s2].values[i]
                if (pv !== null && isFinite(pv)) base += pv
              }
            }
            var y0 = yAt(stacked ? base : 0)
            var y1 = yAt(stacked ? base + v : v)
            var bh = Math.abs(y1 - y0)
            var bx = stacked
              ? left + groupW * i + barGap / 2
              : left + groupW * i + barGap / 2 + barW * si
            var by = Math.min(y0, y1)
            ctx.fillStyle = root.withAlpha(col, 0.85)
            ctx.fillRect(bx, by, barW, Math.max(1, bh))
            ctx.strokeStyle = col
            ctx.lineWidth = 1
            ctx.strokeRect(bx, by, barW, Math.max(1, bh))
          }
          continue
        }

        if (isScatter) {
          ctx.fillStyle = col
          for (i = 0; i < n; i++) {
            v = vals[i]
            if (v === null || !isFinite(v)) continue
            ctx.beginPath()
            ctx.arc(xAt(i), yAt(v), 4, 0, Math.PI * 2)
            ctx.fill()
          }
          continue
        }

        if (isArea) {
          ctx.beginPath()
          var started = false
          for (i = 0; i < n; i++) {
            v = vals[i]
            if (v === null || !isFinite(v)) continue
            if (!started) {
              ctx.moveTo(xAt(i), yAt(v))
              started = true
            } else ctx.lineTo(xAt(i), yAt(v))
          }
          if (started) {
            ctx.lineTo(xAt(n - 1), bot)
            ctx.lineTo(xAt(0), bot)
            ctx.closePath()
            ctx.fillStyle = root.withAlpha(col, 0.28)
            ctx.fill()
          }
        }

        if (isLine || isArea) {
          ctx.beginPath()
          started = false
          for (i = 0; i < n; i++) {
            v = vals[i]
            if (v === null || !isFinite(v)) {
              started = false
              continue
            }
            if (!started) {
              ctx.moveTo(xAt(i), yAt(v))
              started = true
            } else ctx.lineTo(xAt(i), yAt(v))
          }
          ctx.strokeStyle = col
          ctx.lineWidth = 2
          ctx.lineJoin = "round"
          ctx.lineCap = "round"
          ctx.stroke()
        }
      }

      // legend
      if (p.series.length > 1) {
        var lx = left
        var ly = 4
        ctx.font = Style.font.caption + "px " + root.uiFont
        ctx.textBaseline = "middle"
        for (si = 0; si < p.series.length; si++) {
          col = root.colorAt(si)
          ctx.fillStyle = col
          ctx.fillRect(lx, ly, 8, 8)
          ctx.fillStyle = root.textCol
          ctx.textAlign = "left"
          var name = String(p.series[si].name || "")
          ctx.fillText(name, lx + 12, ly + 4)
          lx += 20 + ctx.measureText(name).width
          if (lx > right - 40) break
        }
      }
    }

    function paintPie(ctx, w, h, p, donut) {
      var fieldVals = (p.series[0] && p.series[0].values) || []
      var total = 0
      var i
      for (i = 0; i < fieldVals.length; i++) {
        var v = fieldVals[i]
        if (v !== null && isFinite(v) && v > 0) total += v
      }
      if (total <= 0) return

      var cx = w / 2
      var cy = h * 0.52
      var r = Math.min(w, h) * 0.32
      var inner = donut ? r * 0.55 : 0
      var angle = -Math.PI / 2

      for (i = 0; i < fieldVals.length; i++) {
        v = fieldVals[i]
        if (v === null || !isFinite(v) || v <= 0) continue
        var slice = (v / total) * Math.PI * 2
        var a0 = angle
        var a1 = angle + slice
        ctx.beginPath()
        if (donut && inner > 0) {
          ctx.arc(cx, cy, r, a0, a1, false)
          ctx.arc(cx, cy, inner, a1, a0, true)
          ctx.closePath()
        } else {
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, r, a0, a1)
          ctx.closePath()
        }
        ctx.fillStyle = root.colorAt(i)
        ctx.fill()
        ctx.strokeStyle = root.withAlpha(root.textCol, 0.15)
        ctx.lineWidth = 1
        ctx.stroke()
        angle += slice
      }

      // legend
      ctx.font = Style.font.caption + "px " + root.uiFont
      ctx.textAlign = "left"
      ctx.textBaseline = "middle"
      var lx = 8
      var ly = 10
      for (i = 0; i < Math.min(p.labels.length, 8); i++) {
        v = fieldVals[i]
        if (v === null || !isFinite(v) || v <= 0) continue
        ctx.fillStyle = root.colorAt(i)
        ctx.fillRect(lx, ly - 4, 8, 8)
        ctx.fillStyle = root.textCol
        ctx.fillText(String(p.labels[i]).slice(0, 12), lx + 12, ly)
        ly += 14
        if (ly > h - 8) break
      }
    }

    function paintGauge(ctx, w, h, p) {
      var vals = (p.series[0] && p.series[0].values) || []
      var value = null
      for (var i = 0; i < vals.length; i++) {
        if (vals[i] !== null && isFinite(vals[i])) {
          value = vals[i]
          break
        }
      }
      if (value === null) return

      var max = Math.max(100, Math.abs(value))
      for (i = 0; i < vals.length; i++) {
        if (vals[i] !== null && isFinite(vals[i]) && Math.abs(vals[i]) > max) max = Math.abs(vals[i])
      }
      var t = Math.max(0, Math.min(1, value / max))
      var cx = w / 2
      var cy = h * 0.62
      var r = Math.min(w, h) * 0.36
      var start = Math.PI
      var end = Math.PI * 2

      ctx.lineWidth = Math.max(8, r * 0.18)
      ctx.lineCap = "round"
      ctx.strokeStyle = root.withAlpha(root.axisColor, 0.35)
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, end)
      ctx.stroke()

      ctx.strokeStyle = root.colorAt(0)
      ctx.beginPath()
      ctx.arc(cx, cy, r, start, start + (end - start) * t)
      ctx.stroke()

      ctx.fillStyle = root.textCol
      ctx.font = "bold " + Style.font.display + "px " + root.uiFont
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(Model.formatValue(value), cx, cy - 4)

      if (p.labels && p.labels[0]) {
        ctx.fillStyle = root.axisColor
        ctx.font = Style.font.bodySmall + "px " + root.uiFont
        ctx.fillText(String(p.labels[0]), cx, cy + Style.font.display * 0.7)
      }
    }
  }

  onPayloadChanged: canvas.requestPaint()
  onSeriesColorsChanged: canvas.requestPaint()
  onColorsChanged: canvas.requestPaint()
  onWidthChanged: canvas.requestPaint()
  onHeightChanged: canvas.requestPaint()
}
