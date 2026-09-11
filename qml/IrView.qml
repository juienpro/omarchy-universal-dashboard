import QtQuick
import QtQuick.Layouts
import qs.Commons
import "Model.js" as Model

Item {
  id: root
  property var screen: null
  property var bar: null
  /** Panel root for Button click actions. */
  property var host: null

  readonly property var definition: screen && screen.definition ? screen.definition : null
  readonly property var colors: ({
    foreground: Color.popups.text,
    accent: Color.accent,
    muted: Util.alpha(Color.popups.text, 0.62),
    positive: Color.accent,
    negative: Color.urgent,
    warning: Color.accent,
    dim: Util.alpha(Color.popups.text, 0.62)
  })

  readonly property var placedCells: Model.placedRootCells(screen)
  readonly property int gridColumns: Model.gridColumnCount(screen)
  readonly property bool usePlacementGrid: placedCells.length > 0

  // Width assigned by Panel's Loader; height follows the IR tree / grid.
  implicitWidth: width > 0 ? width : 400
  implicitHeight: usePlacementGrid
    ? (placementGrid.implicitHeight > 0 ? placementGrid.implicitHeight : 0)
    : (rootLoader.item ? rootLoader.item.implicitHeight : 0)
  height: implicitHeight

  function syncCell(loader, cell, cellWidth) {
    if (!loader || !loader.item || !cell) return
    loader.item.width = cellWidth
    loader.item.nodeId = cell.id
    loader.item.screen = root.screen
    loader.item.bar = root.bar
    loader.item.host = root.host
    loader.item.colors = root.colors
  }

  // Screen layout grid (column / index / colspan from MCP).
  GridLayout {
    id: placementGrid
    visible: root.usePlacementGrid
    width: root.width
    columns: Math.max(1, root.gridColumns)
    columnSpacing: Model.gapPx("md")
    rowSpacing: Model.gapPx("md")

    Repeater {
      model: root.usePlacementGrid ? root.placedCells : []
      delegate: Item {
        id: cellWrap
        required property var modelData

        readonly property int span: Math.max(1, modelData.colspan || 1)
        readonly property real cellWidth: {
          var cols = Math.max(1, root.gridColumns)
          var gap = Model.gapPx("md")
          var unit = (placementGrid.width - gap * (cols - 1)) / cols
          return Math.max(1, unit * span + gap * (span - 1))
        }

        Layout.column: Math.max(0, (modelData.colStart || 1) - 1)
        Layout.row: Math.max(0, (modelData.row || 1) - 1)
        Layout.columnSpan: span
        Layout.fillWidth: true
        Layout.preferredWidth: cellWidth
        Layout.alignment: Qt.AlignTop | Qt.AlignLeft
        Layout.preferredHeight: cellLoader.item ? cellLoader.item.implicitHeight : 0

        width: cellWidth
        implicitHeight: cellLoader.item ? cellLoader.item.implicitHeight : 0
        height: implicitHeight

        Loader {
          id: cellLoader
          width: cellWrap.cellWidth
          height: item ? item.implicitHeight : 0
          source: Qt.resolvedUrl("IrNode.qml")
          onLoaded: root.syncCell(cellLoader, cellWrap.modelData, cellWrap.cellWidth)
        }

        onCellWidthChanged: root.syncCell(cellLoader, modelData, cellWidth)
        onModelDataChanged: root.syncCell(cellLoader, modelData, cellWidth)

        Connections {
          target: root
          function onScreenChanged() { root.syncCell(cellLoader, cellWrap.modelData, cellWrap.cellWidth) }
          function onBarChanged() { root.syncCell(cellLoader, cellWrap.modelData, cellWrap.cellWidth) }
          function onHostChanged() { root.syncCell(cellLoader, cellWrap.modelData, cellWrap.cellWidth) }
        }
      }
    }
  }

  // Fallback: render IR root (no placements yet).
  Loader {
    id: rootLoader
    visible: !root.usePlacementGrid
    width: root.width
    height: item ? item.implicitHeight : 0
    active: !root.usePlacementGrid && !!(root.definition && root.definition.root)
    source: active ? Qt.resolvedUrl("IrNode.qml") : ""

    function sync() {
      if (!item || !root.definition) return
      item.width = root.width
      item.nodeId = root.definition.root
      item.screen = root.screen
      item.bar = root.bar
      item.host = root.host
      item.colors = root.colors
    }

    onLoaded: sync()
    onWidthChanged: if (item) item.width = width
  }

  onScreenChanged: if (rootLoader.item) rootLoader.sync()
  onBarChanged: if (rootLoader.item) rootLoader.sync()
  onHostChanged: if (rootLoader.item) rootLoader.sync()
  onWidthChanged: if (rootLoader.item) rootLoader.sync()

  Binding {
    target: rootLoader.item
    property: "colors"
    value: root.colors
    when: !!rootLoader.item
  }

  Binding {
    target: rootLoader.item
    property: "screen"
    value: root.screen
    when: !!rootLoader.item
  }
}
