import QtQuick
import "Model.js" as Model

/** Renders one overlay IR tree (reuses IrView) with optional fixed width/height. */
Item {
  id: root

  property var overlay: null
  property var bar: null
  property var host: null
  property var inlineData: ({})
  property real axisWidth: width
  property real axisHeight: 0

  readonly property var overlayScreen: Model.overlayAsScreen(overlay, inlineData)
  readonly property real fixedW: overlay ? Model.overlaySizePx(overlay.width, axisWidth) : 0
  readonly property real fixedH: overlay ? Model.overlaySizePx(overlay.height, axisHeight > 0 ? axisHeight : implicitHeight) : 0

  opacity: overlay && overlay.opacity !== undefined ? overlay.opacity : 1
  visible: !!(overlay && overlay.definition && overlay.definition.root)

  implicitWidth: fixedW > 0 ? fixedW : (loader.item ? loader.item.implicitWidth : 0)
  implicitHeight: fixedH > 0 ? fixedH : (loader.item ? loader.item.implicitHeight : 0)
  width: implicitWidth
  height: implicitHeight
  clip: true

  Loader {
    id: loader
    width: root.width > 0 ? root.width : (item ? item.implicitWidth : 0)
    height: root.fixedH > 0 ? root.fixedH : (item ? item.implicitHeight : 0)
    active: root.visible
    source: Qt.resolvedUrl("IrView.qml")

    function sync() {
      if (!item) return
      item.width = width
      item.screen = root.overlayScreen
      item.bar = root.bar
      item.host = root.host
    }

    onLoaded: sync()
    onWidthChanged: sync()
  }

  onOverlayChanged: if (loader.item) loader.sync()
  onInlineDataChanged: if (loader.item) loader.sync()
  onBarChanged: if (loader.item) loader.sync()
  onHostChanged: if (loader.item) loader.sync()
}
