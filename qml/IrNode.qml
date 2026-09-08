import QtQuick
import QtQuick.Layouts
import qs.Commons
import "Model.js" as Model

Item {
  id: root
  property string nodeId: ""
  property var screen: null
  property var bar: null
  property var colors: ({})
  /** When set (HorizontalTiles stamp), field/glyph/text binds use this row instead of dataset pick. */
  property var dataRow: null

  readonly property var definition: screen && screen.definition ? screen.definition : null
  readonly property var node: definition && nodeId && definition.nodes ? definition.nodes[nodeId] : null
  readonly property var props: node && node.props ? node.props : ({})
  readonly property string uiFont: Style.font.family

  function fontPx(tokenName) {
    switch (String(tokenName || "body")) {
      case "caption": return Style.font.caption
      case "bodySmall": return Style.font.bodySmall
      case "body": return Style.font.body
      case "subtitle": return Style.font.subtitle
      case "title": return Style.font.title
      case "heading": return Style.font.heading
      case "display": return Style.font.display
      case "displayLarge": return Style.font.displayLarge
      default: return Style.font.body
    }
  }

  // Recursive children must load by URL — direct `IrNode {}` inside this file
  // makes the type unavailable (Quickshell: "instantiated recursively").
  // Do not assign Loader.implicitHeight (read-only); size the wrapper Item instead.
  component ChildNode: Item {
    id: wrap
    property string childId: ""
    property real childWidth: parent ? parent.width : 400
    property var dataRow: root.dataRow

    width: childWidth
    implicitHeight: loader.item ? loader.item.implicitHeight : 0

    Loader {
      id: loader
      width: parent.width
      height: wrap.implicitHeight
      source: Qt.resolvedUrl("IrNode.qml")

      function sync() {
        if (!item) return
        item.width = wrap.childWidth
        item.nodeId = wrap.childId
        item.screen = root.screen
        item.bar = root.bar
        item.colors = root.colors
        item.dataRow = wrap.dataRow
      }

      onLoaded: sync()
    }

    onChildIdChanged: if (loader.item) loader.sync()
    onChildWidthChanged: if (loader.item) loader.sync()
    onDataRowChanged: if (loader.item) loader.sync()

    Connections {
      target: root
      function onScreenChanged() { if (loader.item) loader.sync() }
      function onBarChanged() { if (loader.item) loader.sync() }
      function onColorsChanged() { if (loader.item) loader.sync() }
      function onDataRowChanged() { if (loader.item) loader.sync() }
    }
  }

  implicitWidth: width > 0 ? width : 400
  implicitHeight: body.implicitHeight
  height: body.implicitHeight

  Column {
    id: body
    width: parent.width
    spacing: 0

    // ---- layout containers ----
    Column {
      visible: node && node.type === "Stack"
      width: parent.width
      spacing: Model.gapPx(props.gap)
      Repeater {
        model: node && node.children ? node.children : []
        delegate: ChildNode {
          required property string modelData
          childId: modelData
          childWidth: parent.width
          dataRow: root.dataRow
        }
      }
    }

    Flow {
      visible: node && (node.type === "Group" || node.type === "Grid")
      width: parent.width
      spacing: Model.gapPx(props.gap)
      Repeater {
        model: node && node.children ? node.children : []
        delegate: ChildNode {
          required property string modelData
          childId: modelData
          childWidth: node && node.type === "Grid"
            ? Math.floor((parent.width - Model.gapPx(props.gap) * ((props.cols || 2) - 1)) / (props.cols || 2))
            : parent.width
          dataRow: root.dataRow
        }
      }
    }

    Column {
      visible: node && (node.type === "Container" || node.type === "Panel" || node.type === "Card" || node.type === "ScrollArea")
      width: parent.width
      spacing: Model.gapPx(props.gap || props.padding || "md")
      Repeater {
        model: node && node.children ? node.children : []
        delegate: ChildNode {
          required property string modelData
          childId: modelData
          childWidth: parent.width
          dataRow: root.dataRow
        }
      }
    }

    // ---- HorizontalTiles: stamp template children once per dataset row ----
    Flow {
      id: tilesGrid
      visible: node && (node.type === "HorizontalTiles" || node.type === "Repeat") && String(props.layout || "grid") !== "stack"
      width: parent.width
      spacing: Model.gapPx(props.gap)

      readonly property var rows: {
        if (!node || (node.type !== "HorizontalTiles" && node.type !== "Repeat")) return []
        var all = Model.asRows(Model.datasetOf(screen, props.dataset))
        var limit = props.limit || 24
        return all.slice(0, limit)
      }
      readonly property var templateIds: node && node.children ? node.children : []
      readonly property int cols: Math.max(1, props.cols || Math.min(8, Math.max(1, rows.length)))
      readonly property real cellW: {
        var gap = Model.gapPx(props.gap)
        var n = cols
        return Math.max(24, Math.floor((width - gap * (n - 1)) / n))
      }

      Repeater {
        model: tilesGrid.rows
        delegate: Item {
          id: gridCell
          required property var modelData
          property var rowData: modelData
          width: tilesGrid.cellW
          implicitHeight: gridCellCol.implicitHeight
          height: implicitHeight

          Column {
            id: gridCellCol
            width: parent.width
            spacing: Model.gapPx("xs")
            Repeater {
              model: tilesGrid.templateIds
              delegate: ChildNode {
                required property string modelData
                childId: modelData
                childWidth: gridCell.width
                dataRow: gridCell.rowData
              }
            }
          }
        }
      }
    }

    Column {
      id: tilesStack
      visible: node && (node.type === "HorizontalTiles" || node.type === "Repeat") && String(props.layout || "grid") === "stack"
      width: parent.width
      spacing: Model.gapPx(props.gap)

      readonly property var rows: {
        if (!node || (node.type !== "HorizontalTiles" && node.type !== "Repeat")) return []
        var all = Model.asRows(Model.datasetOf(screen, props.dataset))
        var limit = props.limit || 24
        return all.slice(0, limit)
      }
      readonly property var templateIds: node && node.children ? node.children : []

      Repeater {
        model: tilesStack.rows
        delegate: Item {
          id: stackCell
          required property var modelData
          property var rowData: modelData
          width: parent.width
          implicitHeight: stackCellCol.implicitHeight
          height: implicitHeight

          Column {
            id: stackCellCol
            width: parent.width
            spacing: Model.gapPx("xs")
            Repeater {
              model: tilesStack.templateIds
              delegate: ChildNode {
                required property string modelData
                childId: modelData
                childWidth: stackCell.width
                dataRow: stackCell.rowData
              }
            }
          }
        }
      }
    }

    // ---- leaves ----
    Text {
      visible: node && node.type === "Icon"
      width: parent.width
      textFormat: Text.PlainText
      text: Model.boundGlyph(props, screen, root.dataRow)
      color: Model.textColor(props.color || "default", colors)
      font.family: root.uiFont
      font.pixelSize: Model.iconPx(props.size)
      horizontalAlignment: props.align === "center" ? Text.AlignHCenter
        : (props.align === "right" ? Text.AlignRight : Text.AlignLeft)
    }

    Text {
      visible: node && node.type === "Title"
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: Model.boundText(props, screen, root.dataRow)
      color: Model.textColor(props.color, colors)
      font.family: root.uiFont
      font.pixelSize: root.fontPx(Model.titleToken(props.order))
      font.bold: props.weight === "bold" || true
      horizontalAlignment: props.align === "center" ? Text.AlignHCenter : (props.align === "right" ? Text.AlignRight : Text.AlignLeft)
    }

    Text {
      visible: node && (node.type === "Text" || node.type === "Markdown")
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: node && node.type === "Markdown" ? String(props.text || "") : Model.boundText(props, screen, root.dataRow)
      color: Model.textColor(props.color || (props.c === "dimmed" ? "muted" : "default"), colors)
      font.family: root.uiFont
      font.pixelSize: root.fontPx(Model.fontToken(props.size))
      font.bold: props.weight === "bold"
      font.italic: !!props.italic
      horizontalAlignment: props.align === "center" ? Text.AlignHCenter : (props.align === "right" ? Text.AlignRight : Text.AlignLeft)
    }

    Rectangle {
      visible: node && node.type === "Badge"
      radius: Style.cornerRadius
      color: Util.alpha(colors.accent || "#888", 0.14)
      implicitWidth: badgeText.implicitWidth + 12
      implicitHeight: badgeText.implicitHeight + 6
      Text {
        id: badgeText
        anchors.centerIn: parent
        textFormat: Text.PlainText
        text: Model.boundText(props, screen, root.dataRow)
        color: Model.textColor(props.color || "accent", colors)
        font.family: root.uiFont
        font.pixelSize: root.fontPx("bodySmall")
        font.bold: true
      }
    }

    Column {
      visible: node && node.type === "Stat"
      width: parent.width
      spacing: 2

      Text {
        textFormat: Text.PlainText
        text: String(props.label || "")
        color: Model.textColor("muted", colors)
        font.family: root.uiFont
        font.pixelSize: root.fontPx("bodySmall")
        horizontalAlignment: props.align === "center" ? Text.AlignHCenter
          : (props.align === "right" ? Text.AlignRight : Text.AlignLeft)
        width: parent.width
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width
        text: {
          if (!node || node.type !== "Stat") return ""
          var row = Model.pickStatRow(props, screen, root.dataRow)
          var val = Model.formatValue(Model.readField(row, props.field))
          return String(props.prefix || "") + val + String(props.suffix || "")
        }
        color: Model.textColor("default", colors)
        font.family: root.uiFont
        font.pixelSize: root.fontPx("display")
        font.bold: true
        horizontalAlignment: props.align === "center" ? Text.AlignHCenter
          : (props.align === "right" ? Text.AlignRight : Text.AlignLeft)
      }

      Text {
        visible: !!(props.changeField)
        width: parent.width
        textFormat: Text.PlainText
        text: {
          if (!props.changeField) return ""
          var row = Model.pickStatRow(props, screen, root.dataRow)
          var raw = Model.readField(row, props.changeField)
          var n = Number(raw)
          var sign = isFinite(n) && n > 0 ? "+" : ""
          return sign + Model.formatValue(raw) + String(props.changeSuffix || "")
        }
        color: {
          if (props.colorizeChange === false) return Model.textColor("muted", colors)
          var row = Model.pickStatRow(props, screen, root.dataRow)
          var n = Number(Model.readField(row, props.changeField))
          if (!isFinite(n) || n === 0) return Model.textColor("muted", colors)
          return Model.textColor(n > 0 ? "positive" : "negative", colors)
        }
        font.family: root.uiFont
        font.pixelSize: root.fontPx("body")
        horizontalAlignment: props.align === "center" ? Text.AlignHCenter
          : (props.align === "right" ? Text.AlignRight : Text.AlignLeft)
      }
    }

    Rectangle {
      visible: node && node.type === "Divider"
      width: parent.width
      height: 1
      color: Util.alpha(colors.muted || colors.foreground || "#888", 0.35)
    }

    // Simple table
    Column {
      id: tableCol
      visible: node && node.type === "Table"
      width: parent.width
      spacing: 4

      readonly property var tableColumns: props.columns || []
      readonly property int colCount: Math.max(1, tableColumns.length)

      function colWidth(col) {
        if (col && col.width) return col.width
        return Math.floor(tableCol.width / tableCol.colCount)
      }

      Row {
        visible: tableCol.tableColumns.length > 0
        width: parent.width
        spacing: 8
        Repeater {
          model: tableCol.tableColumns
          delegate: Text {
            required property var modelData
            width: tableCol.colWidth(modelData)
            elide: Text.ElideRight
            textFormat: Text.PlainText
            text: String(modelData.label || modelData.field || "")
            color: Model.textColor("muted", colors)
            font.family: root.uiFont
            font.pixelSize: root.fontPx("bodySmall")
            font.bold: true
          }
        }
      }

      Repeater {
        model: {
          if (!node || node.type !== "Table") return []
          var rows = Model.asRows(Model.datasetOf(screen, props.dataset))
          var limit = props.pageSize || 20
          return rows.slice(0, limit)
        }
        delegate: Row {
          id: dataRow
          required property var modelData
          property var rowData: modelData
          width: parent.width
          spacing: 8
          Repeater {
            model: tableCol.tableColumns
            delegate: Text {
              required property var modelData
              width: tableCol.colWidth(modelData)
              elide: Text.ElideRight
              textFormat: Text.PlainText
              text: Model.formatValue(Model.readField(dataRow.rowData, modelData.field))
              color: Model.textColor("default", colors)
              font.family: root.uiFont
              font.pixelSize: root.fontPx("body")
            }
          }
        }
      }
    }

    // ---- Chart (Canvas; see ChartWidget.qml) ----
    // Wrapper Item owns height/implicitHeight — never set Loader.implicitHeight (read-only).
    Item {
      id: chartWrap
      visible: node && node.type === "Chart"
      width: parent.width

      readonly property int chartH: {
        var h = props && props.height != null ? parseInt(props.height, 10) : 280
        if (!isFinite(h) || h < 120) h = 280
        if (h > 1200) h = 1200
        return h
      }

      height: visible ? chartH : 0
      implicitHeight: height

      Loader {
        id: chartLoader
        anchors.fill: parent
        active: chartWrap.visible
        source: active ? Qt.resolvedUrl("ChartWidget.qml") : ""

        function sync() {
          if (!item) return
          item.width = chartWrap.width
          item.height = chartWrap.chartH
          item.props = root.props
          item.screen = root.screen
          item.colors = root.colors
          item.uiFont = root.uiFont
        }

        onLoaded: sync()
      }

      onWidthChanged: if (chartLoader.item) chartLoader.sync()
      onChartHChanged: if (chartLoader.item) chartLoader.sync()
    }

    Connections {
      target: root
      enabled: chartWrap.visible
      function onPropsChanged() { if (chartLoader.item) chartLoader.sync() }
      function onScreenChanged() { if (chartLoader.item) chartLoader.sync() }
      function onColorsChanged() { if (chartLoader.item) chartLoader.sync() }
    }

    // Fallback for unsupported widgets
    Text {
      visible: node && ["Map", "List", "Timeline", "Image", "Button", "Anchor"].indexOf(node.type) !== -1
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: "[" + (node ? node.type : "?") + " — coming soon]"
      color: Model.textColor("muted", colors)
      font.family: root.uiFont
      font.pixelSize: root.fontPx("body")
      font.italic: true
    }

    Text {
      visible: !node && nodeId
      textFormat: Text.PlainText
      text: "missing #" + nodeId
      color: Model.textColor("negative", colors)
      font.family: root.uiFont
      font.pixelSize: root.fontPx("body")
    }
  }
}
