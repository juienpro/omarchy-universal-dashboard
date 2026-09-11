import QtQuick
import QtMultimedia
import qs.Commons

/**
 * Hover chrome for Video / Youtube: play-pause + mute.
 * Parent must clip; bind `player` to the QtMultimedia Video item.
 */
Item {
  id: root
  anchors.fill: parent
  z: 10

  property var player: null
  property bool enabled: true
  property string uiFont: Style.font.family
  /** Initial mute from IR `sound` (false = muted). User toggles override. */
  property bool soundDefault: false

  property bool userTouchedSound: false
  property bool soundOn: soundDefault
  property bool pinned: false

  readonly property bool playing: player && player.playbackState === MediaPlayer.PlayingState
  readonly property bool showBar: enabled && (hover.hovered || pinned)

  onSoundDefaultChanged: {
    if (!userTouchedSound)
      soundOn = soundDefault
  }

  onSoundOnChanged: applySound()
  onPlayerChanged: applySound()
  Component.onCompleted: applySound()

  function applySound() {
    if (!player) return
    player.muted = !soundOn
    player.volume = soundOn ? 1.0 : 0.0
  }

  function togglePlay() {
    if (!player) return
    if (player.playbackState === MediaPlayer.PlayingState)
      player.pause()
    else
      player.play()
  }

  function toggleSound() {
    userTouchedSound = true
    soundOn = !soundOn
    pinned = true
    pinTimer.restart()
  }

  HoverHandler {
    id: hover
    enabled: root.enabled
  }

  Timer {
    id: pinTimer
    interval: 2500
    onTriggered: root.pinned = false
  }

  // Click empty area → play/pause
  MouseArea {
    anchors.fill: parent
    enabled: root.enabled
    acceptedButtons: Qt.LeftButton
    hoverEnabled: false
    onClicked: {
      root.togglePlay()
      root.pinned = true
      pinTimer.restart()
    }
  }

  Rectangle {
    id: bar
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: 36
    color: "#cc000000"
    visible: root.showBar
    opacity: visible ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 120 } }

    Row {
      anchors.verticalCenter: parent.verticalCenter
      anchors.left: parent.left
      anchors.leftMargin: 8
      spacing: 4

      Rectangle {
        width: 32
        height: 28
        radius: 4
        color: playMa.containsMouse ? "#44ffffff" : "transparent"
        Text {
          anchors.centerIn: parent
          text: root.playing ? "⏸" : "▶"
          color: "#ffffff"
          font.family: root.uiFont
          font.pixelSize: 14
        }
        MouseArea {
          id: playMa
          anchors.fill: parent
          hoverEnabled: true
          onClicked: {
            root.togglePlay()
            root.pinned = true
            pinTimer.restart()
          }
        }
      }

      Rectangle {
        width: 32
        height: 28
        radius: 4
        color: muteMa.containsMouse ? "#44ffffff" : "transparent"
        Text {
          anchors.centerIn: parent
          text: root.soundOn ? "🔊" : "🔇"
          color: "#ffffff"
          font.family: root.uiFont
          font.pixelSize: 14
        }
        MouseArea {
          id: muteMa
          anchors.fill: parent
          hoverEnabled: true
          onClicked: root.toggleSound()
        }
      }
    }
  }
}
