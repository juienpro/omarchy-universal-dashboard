import QtQuick
import qs.Commons
import "Model.js" as Model

/**
 * Seamless horizontal ticker for IR Marquee nodes.
 * Two copies of the text; animates track.x by one loop width.
 */
Item {
  id: root
  property var props: ({})
  property var screen: null
  property var colors: ({})
  property var dataRow: null
  property string uiFont: Style.font.family
  property int pixelSize: Style.font.body

  readonly property string displayText: Model.boundMarqueeText(props, screen, dataRow)
  readonly property real speed: {
    var s = Number(props && props.speed)
    if (!isFinite(s)) s = 40
    if (s < 10) s = 10
    if (s > 200) s = 200
    return s
  }
  readonly property bool goLeft: !(props && props.direction === "right")
  readonly property int gapPx: {
    var g = parseInt(props && props.gap, 10)
    if (!isFinite(g) || g < 16) g = 48
    if (g > 400) g = 400
    return g
  }
  readonly property bool pauseOnHover: !(props && props.pauseOnHover === false)
  readonly property bool onlyIfOverflow: !!(props && props.onlyIfOverflow)
  readonly property color textColor: Model.textColor(props && props.color, colors)
  readonly property bool bold: !!(props && props.weight === "bold")
  readonly property bool italic: !!(props && props.italic)

  width: parent ? parent.width : 400
  implicitHeight: Math.max(labelA.implicitHeight, pixelSize)
  height: implicitHeight
  clip: true

  readonly property real contentW: labelA.implicitWidth
  readonly property real loopW: contentW + gapPx
  readonly property bool hasText: displayText.length > 0
  readonly property bool needsScroll: hasText && (!onlyIfOverflow || contentW > width + 1)

  function applyFont(t) {
    t.font.family = root.uiFont
    t.font.pixelSize = root.pixelSize
    t.font.bold = root.bold
    t.font.italic = root.italic
  }

  function restartAnim() {
    scrollAnim.stop()
    if (!needsScroll) {
      track.x = 0
      return
    }
    track.x = goLeft ? 0 : -loopW
    scrollAnim.from = goLeft ? 0 : -loopW
    scrollAnim.to = goLeft ? -loopW : 0
    scrollAnim.duration = Math.max(400, Math.round((loopW / speed) * 1000))
    if (!hover.hovered || !pauseOnHover)
      scrollAnim.start()
  }

  // Static when not scrolling (fits, or empty)
  Text {
    id: staticLabel
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: parent.width
    visible: !root.needsScroll
    textFormat: Text.PlainText
    text: root.displayText
    color: root.textColor
    elide: Text.ElideRight
    Component.onCompleted: root.applyFont(staticLabel)
  }

  Item {
    id: track
    visible: root.needsScroll
    height: parent.height
    width: root.loopW * 2
    y: 0
    x: 0

    Text {
      id: labelA
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.displayText
      color: root.textColor
      Component.onCompleted: root.applyFont(labelA)
    }

    Text {
      id: labelB
      anchors.verticalCenter: parent.verticalCenter
      x: root.loopW
      textFormat: Text.PlainText
      text: root.displayText
      color: root.textColor
      Component.onCompleted: root.applyFont(labelB)
    }
  }

  NumberAnimation {
    id: scrollAnim
    target: track
    property: "x"
    loops: Animation.Infinite
    running: false
  }

  HoverHandler {
    id: hover
    enabled: root.pauseOnHover && root.needsScroll
    onHoveredChanged: {
      if (!root.pauseOnHover || !root.needsScroll) return
      if (hovered)
        scrollAnim.pause()
      else if (scrollAnim.paused)
        scrollAnim.resume()
      else
        root.restartAnim()
    }
  }

  onDisplayTextChanged: Qt.callLater(restartAnim)
  onLoopWChanged: Qt.callLater(restartAnim)
  onSpeedChanged: Qt.callLater(restartAnim)
  onGoLeftChanged: Qt.callLater(restartAnim)
  onNeedsScrollChanged: Qt.callLater(restartAnim)
  onPixelSizeChanged: {
    applyFont(labelA)
    applyFont(labelB)
    applyFont(staticLabel)
    Qt.callLater(restartAnim)
  }
  onUiFontChanged: {
    applyFont(labelA)
    applyFont(labelB)
    applyFont(staticLabel)
  }
  onBoldChanged: {
    applyFont(labelA)
    applyFont(labelB)
    applyFont(staticLabel)
  }
  onItalicChanged: {
    applyFont(labelA)
    applyFont(labelB)
    applyFont(staticLabel)
  }

  Component.onCompleted: Qt.callLater(restartAnim)
}
