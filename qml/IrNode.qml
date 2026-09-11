import QtQuick
import QtQuick.Layouts
import qs.Commons
import "Model.js" as Model

Item {
  id: root
  property string nodeId: ""
  property var screen: null
  property var bar: null
  /** Panel root — Button click actions (navigate / refresh / openUrl). */
  property var host: null
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

  function runClick(action) {
    if (root.host && typeof root.host.runIrClick === "function")
      root.host.runIrClick(action)
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
        item.host = root.host
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
      function onHostChanged() { if (loader.item) loader.sync() }
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
      readonly property string cellFont: Model.fontToken(props.size)
      readonly property string headerFont: Model.tableHeaderFontToken(props.size)

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
            font.pixelSize: root.fontPx(tableCol.headerFont)
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
            delegate: Item {
              id: cellWrap
              required property var modelData
              width: tableCol.colWidth(modelData)
              height: cellText.implicitHeight
              implicitHeight: cellText.implicitHeight

              readonly property string href: {
                var hf = modelData && modelData.hrefField ? String(modelData.hrefField) : ""
                if (!hf) return ""
                return Model.openableUrl(Model.readField(dataRow.rowData, hf))
              }
              readonly property bool hasLink: href.length > 0

              Text {
                id: cellText
                width: parent.width
                elide: Text.ElideRight
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(dataRow.rowData, modelData.field))
                color: Model.textColor(cellWrap.hasLink ? "primary" : "default", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx(tableCol.cellFont)
                font.underline: cellWrap.hasLink
              }

              MouseArea {
                anchors.fill: parent
                enabled: cellWrap.hasLink
                cursorShape: cellWrap.hasLink ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: {
                  if (cellWrap.href)
                    Qt.openUrlExternally(cellWrap.href)
                }
              }
            }
          }
        }
      }
    }

    // ---- Marquee (see MarqueeWidget.qml) ----
    Item {
      id: marqueeWrap
      visible: node && node.type === "Marquee"
      width: parent.width

      readonly property int marqueePx: root.fontPx(Model.fontToken(props.size))

      height: visible
        ? (marqueeLoader.item ? marqueeLoader.item.implicitHeight : Math.max(marqueePx + 4, 20))
        : 0
      implicitHeight: height

      Loader {
        id: marqueeLoader
        width: parent.width
        height: item ? item.implicitHeight : Math.max(marqueeWrap.marqueePx + 4, 20)
        active: marqueeWrap.visible
        source: active ? Qt.resolvedUrl("MarqueeWidget.qml") : ""

        function sync() {
          if (!item) return
          item.width = marqueeWrap.width
          item.props = root.props
          item.screen = root.screen
          item.colors = root.colors
          item.dataRow = root.dataRow
          item.uiFont = root.uiFont
          item.pixelSize = marqueeWrap.marqueePx
        }

        onLoaded: sync()
      }

      onWidthChanged: if (marqueeLoader.item) marqueeLoader.sync()
      onMarqueePxChanged: if (marqueeLoader.item) marqueeLoader.sync()
    }

    Connections {
      target: root
      enabled: marqueeWrap.visible
      function onPropsChanged() { if (marqueeLoader.item) marqueeLoader.sync() }
      function onScreenChanged() { if (marqueeLoader.item) marqueeLoader.sync() }
      function onColorsChanged() { if (marqueeLoader.item) marqueeLoader.sync() }
      function onDataRowChanged() { if (marqueeLoader.item) marqueeLoader.sync() }
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

    // ---- Video (see VideoWidget.qml) ----
    Item {
      id: videoWrap
      visible: node && node.type === "Video"
      width: parent.width

      readonly property int videoH: Model.videoHeight(props, width)

      height: visible ? videoH : 0
      implicitHeight: height

      Loader {
        id: videoLoader
        width: parent.width
        height: videoWrap.videoH
        active: videoWrap.visible
        source: active ? Qt.resolvedUrl("VideoWidget.qml") : ""

        function sync() {
          if (!item) return
          item.width = videoWrap.width
          item.props = root.props
          item.screen = root.screen
          item.colors = root.colors
          item.dataRow = root.dataRow
          item.uiFont = root.uiFont
        }

        onLoaded: sync()
      }

      onWidthChanged: if (videoLoader.item) videoLoader.sync()
      onVideoHChanged: if (videoLoader.item) videoLoader.sync()
    }

    Connections {
      target: root
      enabled: videoWrap.visible
      function onPropsChanged() { if (videoLoader.item) videoLoader.sync() }
      function onScreenChanged() { if (videoLoader.item) videoLoader.sync() }
      function onColorsChanged() { if (videoLoader.item) videoLoader.sync() }
      function onDataRowChanged() { if (videoLoader.item) videoLoader.sync() }
    }

    // ---- Youtube (yt-dlp resolve + VideoWidget-style playback) ----
    Item {
      id: youtubeWrap
      visible: node && node.type === "Youtube"
      width: parent.width

      readonly property int videoH: Model.videoHeight(props, width)

      height: visible ? videoH : 0
      implicitHeight: height

      Loader {
        id: youtubeLoader
        width: parent.width
        height: youtubeWrap.videoH
        active: youtubeWrap.visible
        source: active ? Qt.resolvedUrl("YoutubeWidget.qml") : ""

        function sync() {
          if (!item) return
          item.width = youtubeWrap.width
          item.props = root.props
          item.screen = root.screen
          item.colors = root.colors
          item.dataRow = root.dataRow
          item.uiFont = root.uiFont
        }

        onLoaded: sync()
      }

      onWidthChanged: if (youtubeLoader.item) youtubeLoader.sync()
      onVideoHChanged: if (youtubeLoader.item) youtubeLoader.sync()
    }

    Connections {
      target: root
      enabled: youtubeWrap.visible
      function onPropsChanged() { if (youtubeLoader.item) youtubeLoader.sync() }
      function onScreenChanged() { if (youtubeLoader.item) youtubeLoader.sync() }
      function onColorsChanged() { if (youtubeLoader.item) youtubeLoader.sync() }
      function onDataRowChanged() { if (youtubeLoader.item) youtubeLoader.sync() }
    }

    // ---- Image ----
    Item {
      id: imageWrap
      visible: node && node.type === "Image"
      width: parent.width
      height: visible ? Model.imageHeight(props) : 0
      implicitHeight: height

      readonly property string imgSrc: node && node.type === "Image"
        ? Model.boundSrc(props, screen, root.dataRow) : ""

      Rectangle {
        anchors.fill: parent
        radius: Model.gapPx(props.radius || "sm")
        color: Util.alpha(colors.muted || colors.foreground || "#888", 0.12)
        clip: true

        Image {
          anchors.fill: parent
          source: imageWrap.imgSrc
          fillMode: Image.PreserveAspectFit
          asynchronous: true
          visible: imageWrap.imgSrc.length > 0
        }

        Text {
          anchors.centerIn: parent
          width: parent.width - 16
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.WordWrap
          visible: !imageWrap.imgSrc.length
          textFormat: Text.PlainText
          text: Model.boundAlt(props, screen, root.dataRow) || "No image"
          color: Model.textColor("muted", colors)
          font.family: root.uiFont
          font.pixelSize: root.fontPx("bodySmall")
          font.italic: true
        }
      }
    }

    // ---- Anchor (clickable link) ----
    Item {
      id: anchorWrap
      visible: node && node.type === "Anchor"
      width: parent.width
      implicitHeight: visible ? anchorText.implicitHeight : 0
      height: implicitHeight

      readonly property string href: node && node.type === "Anchor"
        ? Model.boundHref(props, screen, root.dataRow) : ""
      readonly property bool hasLink: href.length > 0

      Text {
        id: anchorText
        width: parent.width
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: Model.boundLabel(props, screen, root.dataRow) || (anchorWrap.hasLink ? anchorWrap.href : "")
        color: Model.textColor(anchorWrap.hasLink ? "primary" : "muted", colors)
        font.family: root.uiFont
        font.pixelSize: root.fontPx(Model.fontToken(props.size))
        font.underline: anchorWrap.hasLink
      }

      MouseArea {
        anchors.fill: parent
        enabled: anchorWrap.hasLink
        cursorShape: anchorWrap.hasLink ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: {
          if (anchorWrap.href)
            Qt.openUrlExternally(anchorWrap.href)
        }
      }
    }

    // ---- Button ----
    Rectangle {
      id: buttonWrap
      visible: node && node.type === "Button"
      radius: Style.cornerRadius
      implicitWidth: Math.min(parent.width, buttonLabel.implicitWidth + 28)
      implicitHeight: buttonLabel.implicitHeight + 14
      width: implicitWidth
      height: implicitHeight

      readonly property string variant: String(props.variant || "filled")
      readonly property var clickAction: node && node.on && node.on.click ? node.on.click : null

      color: {
        var v = buttonWrap.variant
        if (v === "outline" || v === "subtle") return "transparent"
        if (v === "light") return Util.alpha(colors.accent || "#888", 0.18)
        return colors.accent || "#688"
      }
      border.width: buttonWrap.variant === "outline" ? 1 : 0
      border.color: colors.accent || "#888"

      Text {
        id: buttonLabel
        anchors.centerIn: parent
        textFormat: Text.PlainText
        text: String(props.label || "")
        color: {
          var v = buttonWrap.variant
          if (v === "filled") return colors.foreground || "#fff"
          return Model.textColor("primary", colors)
        }
        font.family: root.uiFont
        font.pixelSize: root.fontPx("body")
        font.bold: true
      }

      MouseArea {
        anchors.fill: parent
        cursorShape: buttonWrap.clickAction ? Qt.PointingHandCursor : Qt.ArrowCursor
        enabled: !!buttonWrap.clickAction
        onClicked: root.runClick(buttonWrap.clickAction)
      }
    }

    // ---- List (card grid / stack; hrefField opens URL — detailKey unsupported) ----
    Flow {
      id: listGrid
      visible: node && node.type === "List" && String(props.layout || "stack") === "grid"
      width: parent.width
      spacing: Model.gapPx("md")

      readonly property var rows: {
        if (!node || node.type !== "List") return []
        var all = Model.asRows(Model.datasetOf(screen, props.dataset))
        var limit = props.limit || 24
        return all.slice(0, limit)
      }
      readonly property int cols: Math.max(1, props.cols || 3)
      readonly property real cellW: {
        var gap = Model.gapPx("md")
        var n = cols
        return Math.max(80, Math.floor((width - gap * (n - 1)) / n))
      }
      readonly property string titleFont: Model.fontToken(props.size)
      readonly property string subFont: Model.tableHeaderFontToken(props.size)
      readonly property string metaFont: Model.listMetaFontToken(props.size)

      Repeater {
        model: listGrid.rows
        delegate: Rectangle {
          id: listGridCard
          required property var modelData
          property var rowData: modelData
          width: listGrid.cellW
          implicitHeight: listGridInner.implicitHeight + 20
          height: implicitHeight
          radius: Style.cornerRadius
          color: Util.alpha(colors.foreground || "#fff", 0.06)

          readonly property string href: {
            var hf = props.hrefField ? String(props.hrefField) : ""
            if (!hf) return ""
            return Model.openableUrl(Model.readField(listGridCard.rowData, hf))
          }

          Column {
            id: listGridInner
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: 10
            spacing: 4

            Image {
              visible: !!(props.imageField) && String(Model.readField(listGridCard.rowData, props.imageField) || "").length > 0
              width: parent.width
              height: 72
              fillMode: Image.PreserveAspectCrop
              asynchronous: true
              source: props.imageField ? String(Model.readField(listGridCard.rowData, props.imageField) || "") : ""
            }

            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
              text: Model.formatValue(Model.readField(listGridCard.rowData, props.titleField))
              color: Model.textColor("default", colors)
              font.family: root.uiFont
              font.pixelSize: root.fontPx(listGrid.titleFont)
              font.bold: true
            }

            Text {
              visible: !!(props.subtitleField)
              width: parent.width
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
              text: Model.formatValue(Model.readField(listGridCard.rowData, props.subtitleField))
              color: Model.textColor("muted", colors)
              font.family: root.uiFont
              font.pixelSize: root.fontPx(listGrid.subFont)
            }

            Text {
              visible: !!(props.metaField)
              width: parent.width
              elide: Text.ElideRight
              textFormat: Text.PlainText
              text: Model.formatValue(Model.readField(listGridCard.rowData, props.metaField))
              color: Model.textColor("muted", colors)
              font.family: root.uiFont
              font.pixelSize: root.fontPx(listGrid.metaFont)
            }
          }

          MouseArea {
            anchors.fill: parent
            enabled: listGridCard.href.length > 0
            cursorShape: listGridCard.href.length ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: {
              if (listGridCard.href)
                Qt.openUrlExternally(listGridCard.href)
            }
          }
        }
      }
    }

    Column {
      id: listStack
      visible: node && node.type === "List" && String(props.layout || "stack") !== "grid"
      width: parent.width
      spacing: Model.gapPx("sm")

      readonly property var rows: {
        if (!node || node.type !== "List") return []
        var all = Model.asRows(Model.datasetOf(screen, props.dataset))
        var limit = props.limit || 24
        return all.slice(0, limit)
      }
      readonly property string titleFont: Model.fontToken(props.size)
      readonly property string subFont: Model.tableHeaderFontToken(props.size)
      readonly property string metaFont: Model.listMetaFontToken(props.size)

      Repeater {
        model: listStack.rows
        delegate: Rectangle {
          id: listStackCard
          required property var modelData
          property var rowData: modelData
          width: parent.width
          implicitHeight: listStackInner.implicitHeight + 16
          height: implicitHeight
          radius: Style.cornerRadius
          color: Util.alpha(colors.foreground || "#fff", 0.06)

          readonly property string href: {
            var hf = props.hrefField ? String(props.hrefField) : ""
            if (!hf) return ""
            return Model.openableUrl(Model.readField(listStackCard.rowData, hf))
          }

          Row {
            id: listStackInner
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.margins: 8
            spacing: 10

            readonly property bool hasImg: !!(props.imageField)
              && String(Model.readField(listStackCard.rowData, props.imageField) || "").length > 0

            Image {
              visible: listStackInner.hasImg
              width: 48
              height: 48
              fillMode: Image.PreserveAspectCrop
              asynchronous: true
              source: props.imageField ? String(Model.readField(listStackCard.rowData, props.imageField) || "") : ""
            }

            Column {
              width: listStackCard.width - 16 - (listStackInner.hasImg ? 58 : 0)
              spacing: 2

              Text {
                width: parent.width
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(listStackCard.rowData, props.titleField))
                color: Model.textColor("default", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx(listStack.titleFont)
                font.bold: true
              }

              Text {
                visible: !!(props.subtitleField)
                width: parent.width
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(listStackCard.rowData, props.subtitleField))
                color: Model.textColor("muted", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx(listStack.subFont)
              }

              Text {
                visible: !!(props.metaField)
                width: parent.width
                elide: Text.ElideRight
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(listStackCard.rowData, props.metaField))
                color: Model.textColor("muted", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx(listStack.metaFont)
              }
            }
          }

          MouseArea {
            anchors.fill: parent
            enabled: listStackCard.href.length > 0
            cursorShape: listStackCard.href.length ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: {
              if (listStackCard.href)
                Qt.openUrlExternally(listStackCard.href)
            }
          }
        }
      }
    }

    // ---- Timeline ----
    Column {
      id: timelineCol
      visible: node && node.type === "Timeline"
      width: parent.width
      spacing: 0

      readonly property var rows: {
        if (!node || node.type !== "Timeline") return []
        return Model.asRows(Model.datasetOf(screen, props.dataset))
      }

      Repeater {
        model: timelineCol.rows
        delegate: Item {
          id: tlItem
          required property var modelData
          required property int index
          width: parent.width
          implicitHeight: tlRow.implicitHeight + 8
          height: implicitHeight

          Row {
            id: tlRow
            width: parent.width
            spacing: 10

            Item {
              width: 12
              height: tlTextCol.implicitHeight

              Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 2
                height: parent.height
                color: Util.alpha(colors.accent || "#888", 0.35)
                visible: tlItem.index < timelineCol.rows.length - 1
              }

              Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: 4
                width: 8
                height: 8
                radius: 4
                color: colors.accent || "#888"
              }
            }

            Column {
              id: tlTextCol
              width: parent.width - 22
              spacing: 2

              Text {
                width: parent.width
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(tlItem.modelData, props.timeField))
                color: Model.textColor("muted", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx("caption")
              }

              Text {
                width: parent.width
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(tlItem.modelData, props.titleField))
                color: Model.textColor("default", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx("body")
                font.bold: true
              }

              Text {
                visible: !!(props.bodyField)
                width: parent.width
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
                text: Model.formatValue(Model.readField(tlItem.modelData, props.bodyField))
                color: Model.textColor("muted", colors)
                font.family: root.uiFont
                font.pixelSize: root.fontPx("bodySmall")
              }
            }
          }
        }
      }
    }

    // Fallback for unsupported widgets
    Text {
      visible: node && node.type === "Map"
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: "[Map — coming soon]"
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
