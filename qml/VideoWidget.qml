import QtQuick
import QtMultimedia
import qs.Commons
import "Model.js" as Model

/**
 * Inline video / stream for IR Video nodes (Qt Multimedia + FFmpeg backend).
 * Props: src | srcField (+ dataset), height | size, aspect, fit, autoPlay, sound, controls.
 */
Item {
  id: root
  property var props: ({})
  property var screen: null
  property var colors: ({})
  property var dataRow: null
  property string uiFont: Style.font.family

  readonly property string src: Model.boundSrc(props, screen, dataRow)
  readonly property int videoH: Model.videoHeight(props, width)
  readonly property bool wantAutoPlay: !(props && props.autoPlay === false)
  readonly property bool soundDefault: !!(props && props.sound)
  readonly property string fitMode: Model.videoFillMode(props)
  readonly property bool wantControls: !(props && props.controls === false)

  width: parent ? parent.width : 400
  height: videoH
  implicitHeight: videoH
  implicitWidth: width
  clip: true

  Rectangle {
    anchors.fill: parent
    color: "#000000"
    radius: Style.cornerRadius || 0
  }

  Video {
    id: player
    anchors.fill: parent
    fillMode: root.fitMode === "stretch"
      ? VideoOutput.Stretch
      : (root.fitMode === "contain" ? VideoOutput.PreserveAspectFit : VideoOutput.PreserveAspectCrop)
    muted: true
    volume: 0.0
    autoPlay: false
  }

  Text {
    anchors.centerIn: parent
    width: parent.width - 24
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    visible: !root.src.length || player.error !== MediaPlayer.NoError
    textFormat: Text.PlainText
    text: !root.src.length
      ? "No video source"
      : (player.errorString || "Video error")
    color: Model.textColor("muted", colors)
    font.family: root.uiFont
    font.pixelSize: Style.font && Style.font.body ? Style.font.body : 13
    font.italic: true
    z: 2
  }

  VideoChrome {
    player: player
    enabled: root.wantControls && root.src.length > 0 && player.error === MediaPlayer.NoError
    soundDefault: root.soundDefault
    uiFont: root.uiFont
  }

  function applySource() {
    var url = root.src
    if (!url.length) {
      player.stop()
      player.source = ""
      return
    }
    if (String(player.source) === url) {
      if (root.wantAutoPlay && player.playbackState !== MediaPlayer.PlayingState)
        player.play()
      return
    }
    player.stop()
    player.source = url
    if (root.wantAutoPlay)
      player.play()
  }

  onSrcChanged: applySource()
  onWantAutoPlayChanged: {
    if (root.wantAutoPlay && root.src.length)
      player.play()
    else if (!root.wantAutoPlay)
      player.pause()
  }
  Component.onCompleted: applySource()
}
