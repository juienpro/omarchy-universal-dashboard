import QtQuick
import QtMultimedia
import Quickshell.Io
import qs.Commons
import "Model.js" as Model

/**
 * YouTube via yt-dlp stream resolve + Qt Multimedia (not a WebEngine iframe).
 * Props: src | videoId | …, fit, aspect, autoPlay, sound, controls, resolveIntervalSec.
 */
Item {
  id: root
  property var props: ({})
  property var screen: null
  property var colors: ({})
  property var dataRow: null
  property string uiFont: Style.font.family

  readonly property string input: Model.youtubeInput(props, screen, dataRow)
  readonly property int videoH: Model.videoHeight(props, width)
  readonly property bool wantAutoPlay: !(props && props.autoPlay === false)
  readonly property bool soundDefault: !!(props && props.sound)
  readonly property int resolveIntervalSec: Model.youtubeResolveIntervalSec(props)
  readonly property string fitMode: Model.videoFillMode(props)
  readonly property bool wantControls: !(props && props.controls === false)

  readonly property string cliPath: {
    var raw = Qt.resolvedUrl("../bin/universal-dashboard").toString()
    if (raw.indexOf("file://") === 0) raw = raw.substring(7)
    if (raw.indexOf("localhost/") === 0) raw = raw.substring(9)
    try { return decodeURIComponent(raw) } catch (e) { return raw }
  }

  property string streamSrc: ""
  property string resolveError: ""
  property bool resolving: false
  property string lastResolvedInput: ""

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
    visible: root.streamSrc.length > 0 && !root.resolveError
  }

  Text {
    anchors.centerIn: parent
    width: parent.width - 24
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    visible: !root.input.length || root.resolving || root.resolveError.length > 0
      || (root.streamSrc.length > 0 && player.error !== MediaPlayer.NoError)
    textFormat: Text.PlainText
    text: {
      if (!root.input.length) return "No YouTube source"
      if (root.resolving && !root.streamSrc.length) return "Resolving YouTube…"
      if (root.resolveError.length) return root.resolveError
      return player.errorString || "Video error"
    }
    color: Model.textColor("muted", colors)
    font.family: root.uiFont
    font.pixelSize: Style.font && Style.font.body ? Style.font.body : 13
    font.italic: true
    z: 2
  }

  VideoChrome {
    player: player
    enabled: root.wantControls && root.streamSrc.length > 0 && !root.resolveError
      && player.error === MediaPlayer.NoError
    soundDefault: root.soundDefault
    uiFont: root.uiFont
  }

  Process {
    id: resolveProc
    stdout: StdioCollector {
      id: resolveOut
      waitForEnd: true
    }
    stderr: StdioCollector {
      id: resolveErr
      waitForEnd: true
    }
    onExited: function(exitCode) {
      root.resolving = false
      if (exitCode !== 0) {
        var err = (resolveErr.text || "").trim()
        if (!err.length) err = (resolveOut.text || "").trim()
        if (!err.length) err = "youtube-resolve failed"
        err = err.replace(/^Error:\s*/i, "")
        err = err.replace(/^ERROR:\s*/i, "")
        var m = err.match(/\[youtube\]\s+[A-Za-z0-9_-]+:\s*(.+)$/i)
        if (m && m[1]) err = m[1]
        if (err.length > 160) err = err.slice(0, 157) + "…"
        if (!root.streamSrc.length)
          root.resolveError = err
        return
      }
      try {
        var raw = (resolveOut.text || "").trim()
        var obj = JSON.parse(raw)
        var url = obj && obj.src ? String(obj.src) : ""
        if (!url.length) {
          root.resolveError = "Empty stream URL"
          return
        }
        root.resolveError = ""
        root.lastResolvedInput = root.input
        root.applyStream(url)
      } catch (e) {
        root.resolveError = "Bad youtube-resolve JSON"
      }
    }
  }

  Timer {
    id: refreshTimer
    interval: Math.max(300, root.resolveIntervalSec) * 1000
    repeat: true
    running: root.input.length > 0 && root.visible
    onTriggered: root.resolve(false)
  }

  Timer {
    id: errorRetry
    interval: 2500
    repeat: false
    onTriggered: root.resolve(true)
  }

  function applyStream(url) {
    if (!url || !url.length) return
    if (String(player.source) === url) {
      if (root.wantAutoPlay && player.playbackState !== MediaPlayer.PlayingState)
        player.play()
      return
    }
    root.streamSrc = url
    player.stop()
    player.source = url
    if (root.wantAutoPlay)
      player.play()
  }

  function resolve(force) {
    var want = root.input
    if (!want.length) {
      root.streamSrc = ""
      root.resolveError = ""
      root.lastResolvedInput = ""
      player.stop()
      player.source = ""
      return
    }
    if (resolveProc.running) return
    if (!force && want === root.lastResolvedInput && root.streamSrc.length)
      return
    root.resolving = true
    if (!root.streamSrc.length)
      root.resolveError = ""
    resolveProc.command = [root.cliPath, "youtube-resolve", want]
    resolveProc.running = true
  }

  onInputChanged: {
    root.streamSrc = ""
    root.lastResolvedInput = ""
    root.resolveError = ""
    player.stop()
    player.source = ""
    resolve(true)
  }

  onWantAutoPlayChanged: {
    if (root.wantAutoPlay && root.streamSrc.length)
      player.play()
    else if (!root.wantAutoPlay)
      player.pause()
  }

  Connections {
    target: player
    function onErrorChanged() {
      if (player.error !== MediaPlayer.NoError && root.input.length)
        errorRetry.restart()
    }
  }

  Component.onCompleted: resolve(true)
}
