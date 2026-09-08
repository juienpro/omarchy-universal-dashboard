import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Dashboard host: a real FloatingWindow (not a bar KeyboardPanel popup).
// The bar widget toggles window.visible; Esc / the window chrome also close it.
Item {
  id: root

  property var bar: null
  property var settings: ({})
  property var anchorItem: null
  property var hostWidget: null

  readonly property string home: Quickshell.env("HOME")
  property var screen: Model.emptyScreen()
  property var views: []
  property bool listOpen: false
  property int listCursor: 0
  /** Non-empty while waiting for a second `d` to confirm deletion. */
  property string deleteConfirmId: ""

  readonly property bool hasContent: Model.hasContent(screen)
  readonly property string titleText: Model.screenTitle(screen) || "Universal Dashboard"
  readonly property string activeViewTitle: {
    if (!screen.activeViewId) return ""
    for (var i = 0; i < views.length; i++) {
      if (views[i].id === screen.activeViewId) return views[i].title || views[i].slug
    }
    return ""
  }
  readonly property string deleteConfirmTitle: {
    if (!deleteConfirmId) return ""
    for (var i = 0; i < views.length; i++) {
      if (views[i].id === deleteConfirmId) return views[i].title || views[i].slug
    }
    return "this view"
  }
  readonly property string statusText: {
    if (deleteConfirmId)
      return "Delete « " + deleteConfirmTitle + " »? d again · Esc cancel"
    if (hasContent)
      return screen.activeViewId ? (activeViewTitle || "Saved view") : "Live"
    return views.length ? (views.length + " views") : "Idle"
  }

  /** Desired open state — separate from FloatingWindow.visible (can desync after WM kill). */
  property bool wantOpen: false

  readonly property bool opened: {
    if (!wantOpen || !windowLoader.item) return false
    var w = windowLoader.item
    if (!w.visible) return false
    if ("backingWindowVisible" in w) return w.backingWindowVisible === true
    return true
  }

  // Independent window — other bar popouts must not dismiss it.
  property bool popoutSwitchClosing: false
  function closeForPopoutSwitch() {}

  // FloatingWindow is an opaque xdg surface (not a translucent layer-shell
  // popup). Force opaque fill so a light compositor backdrop cannot wash
  // out secondary text.
  readonly property color foreground: Color.popups.text
  readonly property color background: {
    var c = Color.popups.background
    return Qt.rgba(c.r, c.g, c.b, 1)
  }
  readonly property color muted: Util.alpha(Color.popups.text, 0.62)
  readonly property color accent: Color.accent
  readonly property color borderColor: Color.popups.border
  readonly property string fontFamily: Style.font.family

  function open() { openFromHotkey() }

  function focusDashWindow() {
    var w = windowLoader.item
    if (w && w.keyFocus) w.keyFocus.forceActiveFocus()
  }

  function openFromHotkey() {
    screenFile.reload()
    viewsFile.reload()
    runRefreshDue()
    wantOpen = true

    // SUPER/Ctrl+W kills the Wayland surface but leaves a zombie QWindow.
    // Remount via Loader so the next show gets a fresh FloatingWindow.
    var w = windowLoader.item
    var zombie = w && ("backingWindowVisible" in w) && w.backingWindowVisible !== true
    if (zombie || !windowLoader.active) {
      windowLoader.active = false
      Qt.callLater(function() {
        if (!root.wantOpen) return
        windowLoader.active = true
      })
      return
    }

    w.visible = true
    Qt.callLater(root.focusDashWindow)
  }

  function close() {
    wantOpen = false
    listOpen = false
    deleteConfirmId = ""
    if (windowLoader.item) windowLoader.item.visible = false
  }

  function toggle() {
    if (root.opened) close()
    else openFromHotkey()
  }

  function runRefreshDue() {
    if (refreshDueProc.running) return
    refreshDueProc.command = [cliPath, "refresh-due"]
    refreshDueProc.running = true
  }

  function cycleView(delta) {
    deleteConfirmId = ""
    var id = Model.nextViewId(views, screen.activeViewId, delta)
    if (id) loadView(id)
  }

  function loadView(viewId) {
    if (!viewId || loadViewProc.running) return
    deleteConfirmId = ""
    loadViewProc.command = [cliPath, "load-view", String(viewId)]
    loadViewProc.running = true
  }

  function selectListView() {
    if (!views.length) return
    var idx = Math.max(0, Math.min(listCursor, views.length - 1))
    loadView(views[idx].id)
    listOpen = false
  }

  function viewIdForDelete() {
    if (listOpen && views.length) {
      var idx = Math.max(0, Math.min(listCursor, views.length - 1))
      return views[idx].id
    }
    return screen.activeViewId || ""
  }

  function requestDelete() {
    var id = viewIdForDelete()
    if (!id) return
    if (deleteConfirmId === id) {
      deleteConfirmId = ""
      if (deleteViewProc.running) return
      deleteViewProc.command = [cliPath, "delete-view", String(id)]
      deleteViewProc.running = true
      return
    }
    deleteConfirmId = id
  }

  function cancelDeleteConfirm() {
    deleteConfirmId = ""
  }

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  readonly property string cliPath: {
    var raw = Qt.resolvedUrl("../bin/universal-dashboard").toString()
    if (raw.indexOf("file://") === 0) raw = raw.substring(7)
    if (raw.indexOf("localhost/") === 0) raw = raw.substring(9)
    try { return decodeURIComponent(raw) } catch (e) { return raw }
  }

  FileView {
    id: screenFile
    path: Model.screenPath(root.home)
    watchChanges: true
    printErrors: false
    onLoaded: root.screen = Model.parseScreen(text())
    onFileChanged: reload()
    onLoadFailed: root.screen = Model.emptyScreen()
  }

  FileView {
    id: viewsFile
    path: Model.viewsIndexPath(root.home)
    watchChanges: true
    printErrors: false
    onLoaded: root.views = Model.parseViews(text())
    onFileChanged: reload()
    onLoadFailed: root.views = []
  }

  Process {
    id: loadViewProc
    stdout: StdioCollector {}
    stderr: StdioCollector {}
    onExited: {
      screenFile.reload()
      viewsFile.reload()
    }
  }

  Process {
    id: deleteViewProc
    stdout: StdioCollector {}
    stderr: StdioCollector {}
    onExited: {
      root.listOpen = false
      root.deleteConfirmId = ""
      screenFile.reload()
      viewsFile.reload()
    }
  }

  Process {
    id: refreshDueProc
    stdout: StdioCollector {}
    stderr: StdioCollector {}
    onExited: {
      screenFile.reload()
    }
  }

  // Poll file state for external MCP writes
  Timer {
    interval: 2000
    running: true
    repeat: true
    onTriggered: {
      screenFile.reload()
      viewsFile.reload()
    }
  }

  // Deterministic dataset refresh (HTTP sources); plugin owns the schedule
  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: root.runRefreshDue()
  }

  // FloatingWindow is loaded on demand and destroyed after compositor kill
  // (SUPER+W / Ctrl+W) so reopen always gets a fresh Wayland surface.
  Loader {
    id: windowLoader
    active: false
    sourceComponent: dashWindowComponent
    onLoaded: {
      if (!item) return
      if (root.wantOpen) {
        item.visible = true
        Qt.callLater(root.focusDashWindow)
      }
    }
  }

  Component {
    id: dashWindowComponent

    FloatingWindow {
      id: window
      title: root.titleText
      color: root.background
      visible: false
      implicitWidth: 920
      implicitHeight: 640
      minimumSize: Qt.size(560, 400)

      // Exposed so Panel can focus after open.
      property alias keyFocus: keyCatcher

      onClosed: {
        // Compositor closed us — tear down the proxy (zombie QWindow otherwise).
        root.wantOpen = false
        root.listOpen = false
        root.deleteConfirmId = ""
        Qt.callLater(function() {
          if (!root.wantOpen) windowLoader.active = false
        })
      }

      onVisibleChanged: {
        if (visible) {
          screenFile.reload()
          viewsFile.reload()
          root.runRefreshDue()
          Qt.callLater(root.focusDashWindow)
        } else {
          root.listOpen = false
          root.deleteConfirmId = ""
        }
      }

      FocusScope {
        anchors.fill: parent
        focus: true

        BorderSurface {
          anchors.fill: parent
          anchors.margins: Style.space(10)
          borderSpec: Border.surfaceSpec("popups", "border", root.borderColor, Math.max(1, Style.space(2)))
          color: root.background

          PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent
            onCloseRequested: {
              if (root.deleteConfirmId) {
                root.cancelDeleteConfirm()
                return
              }
              if (root.listOpen) root.listOpen = false
              else root.close()
            }
            onMoveRequested: function(dx, dy) {
              root.deleteConfirmId = ""
              if (root.listOpen) {
                if (dy !== 0)
                  root.listCursor = Math.max(0, Math.min(Math.max(0, root.views.length - 1), root.listCursor + dy))
              } else if (dx !== 0) {
                root.cycleView(dx)
              }
            }
            onActivateRequested: {
              if (root.listOpen) root.selectListView()
            }
            onTextKey: function(t) {
              if (t === "d" || t === "D") {
                root.requestDelete()
                return
              }
              if (t === "v" || t === "V") {
                root.deleteConfirmId = ""
                root.listOpen = !root.listOpen
                if (root.listOpen) {
                  var idx = Model.viewIndex(root.views, root.screen.activeViewId)
                  root.listCursor = idx >= 0 ? idx : 0
                }
              }
            }

            ScrollView {
              id: scroll
              anchors.fill: parent
              anchors.margins: Style.spacing.popupPadding
              clip: true
              ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

              Column {
                width: scroll.availableWidth
                spacing: Style.space(12)

                Item {
                  width: parent.width
                  height: headerRow.height

                  Row {
                    id: headerRow
                    width: parent.width
                    spacing: Style.space(12)

                    Column {
                      width: parent.width - hints.implicitWidth - Style.space(12)
                      spacing: Style.space(2)

                      Text {
                        textFormat: Text.PlainText
                        text: root.titleText
                        color: root.foreground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.heading
                        font.bold: true
                        elide: Text.ElideRight
                        width: parent.width
                      }

                      Text {
                        textFormat: Text.PlainText
                        text: root.statusText + (root.views.length ? (" · " + root.views.length + " views") : "")
                        color: root.muted
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.subtitle
                      }
                    }

                    Text {
                      id: hints
                      anchors.verticalCenter: parent.verticalCenter
                      textFormat: Text.PlainText
                      text: root.deleteConfirmId
                        ? "d confirm · Esc cancel"
                        : "← → views · V list · d delete · Esc"
                      color: root.muted
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }
                  }
                }

                Rectangle {
                  width: parent.width
                  height: 1
                  color: Util.alpha(root.borderColor, 0.35)
                }

                Column {
                  visible: root.listOpen
                  width: parent.width
                  spacing: Style.space(4)

                  Text {
                    textFormat: Text.PlainText
                    text: root.views.length ? "Saved views" : "No saved views"
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                  }

                  Repeater {
                    model: root.views
                    delegate: Rectangle {
                      required property var modelData
                      required property int index
                      width: parent.width
                      height: Style.space(28)
                      radius: Style.cornerRadius
                      color: index === root.listCursor
                        ? Util.alpha(root.accent, 0.12)
                        : "transparent"

                      Text {
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.left: parent.left
                        anchors.leftMargin: Style.space(8)
                        textFormat: Text.PlainText
                        text: modelData.title + "  (" + modelData.slug + ")"
                        color: index === root.listCursor ? root.accent : root.foreground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                      }

                      MouseArea {
                        anchors.fill: parent
                        onClicked: {
                          root.listCursor = index
                          root.selectListView()
                        }
                      }
                    }
                  }
                }

                Item {
                  visible: !root.listOpen
                  width: parent.width
                  height: dashLoader.item ? dashLoader.item.implicitHeight : emptyHint.implicitHeight

                  Text {
                    id: emptyHint
                    visible: !root.hasContent
                    width: parent.width
                    wrapMode: Text.WordWrap
                    textFormat: Text.PlainText
                    text: "Connect an agent with MCP, then ask it to show something.\n\n"
                      + "Claude:\n  claude mcp add universal-dashboard -- " + root.cliPath + " serve\n\n"
                      + "Codex:\n  codex mcp add universal-dashboard -- " + root.cliPath + " serve"
                    color: root.muted
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    lineHeight: 1.35
                  }

                  Loader {
                    id: dashLoader
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: item ? Math.max(item.implicitHeight, 1) : 0
                    active: root.hasContent && !root.listOpen
                    source: Qt.resolvedUrl("IrView.qml")
                    onLoaded: syncDash()
                    onWidthChanged: syncDash()

                    function syncDash() {
                      if (!item) return
                      item.width = width
                      item.screen = root.screen
                      item.bar = root.bar
                    }
                  }

                  Connections {
                    target: root
                    function onScreenChanged() {
                      if (dashLoader.item) {
                        dashLoader.item.screen = root.screen
                        dashLoader.syncDash()
                      }
                    }
                  }
                }

                Item { width: 1; height: Style.space(8) }
              }
            }
          }
        }
      }
    }
  }
}
