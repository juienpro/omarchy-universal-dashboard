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
  property var carousel: Model.emptyCarousel()
  property bool listOpen: false
  property int listCursor: 0
  /** Non-empty while waiting for a second `d` to confirm deletion. */
  property string deleteConfirmId: ""

  // View transition state (fade / slide / scale around load-view).
  property real dashOpacity: 1
  property real dashSlide: 0
  property real dashScale: 1
  property int transitionDir: 1
  property string activeTransition: "fade"
  property bool viewTransitioning: false
  property string pendingViewId: ""
  property string carouselFeedback: "" // "interval" | "transition" | ""
  property string toastText: ""
  property real toastOpacity: 0

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
    if (hasContent) {
      var base = screen.activeViewId ? (activeViewTitle || "Saved view") : "Live"
      if (carousel.enabled)
        return base + " · auto " + carousel.intervalSec + "s · " + (carousel.transition || "fade")
      return base
    }
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
    carouselFile.reload()
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
    if (id) requestLoadView(id, delta)
  }

  function advanceCarousel() {
    if (!carousel.enabled || viewTransitioning || loadViewProc.running || listOpen) return
    var id = Model.nextCarouselViewId(views, carousel.viewIds, screen.activeViewId, 1)
    if (id) requestLoadView(id, 1)
  }

  function requestLoadView(viewId, dir) {
    if (!viewId || loadViewProc.running || viewTransitioning) return
    if (String(viewId) === String(screen.activeViewId || "")) return
    deleteConfirmId = ""
    transitionDir = dir === undefined || dir === 0 ? 1 : (dir > 0 ? 1 : -1)
    activeTransition = carousel.transition || "fade"
    pendingViewId = String(viewId)
    if (!hasContent) {
      viewTransitioning = true
      dashOpacity = 0
      dashSlide = 0
      dashScale = 1
      commitPendingLoad()
      return
    }
    beginExitTransition()
  }

  function beginExitTransition() {
    viewTransitioning = true
    enterAnim.stop()
    exitOpacity.to = 0
    exitSlide.to = activeTransition === "slide" ? -transitionDir * 48 : 0
    exitScale.to = activeTransition === "scale" ? 0.96 : 1
    exitAnim.start()
  }

  function commitPendingLoad() {
    if (!pendingViewId) {
      viewTransitioning = false
      resetDashTransform()
      return
    }
    loadViewProc.command = [cliPath, "load-view", pendingViewId]
    loadViewProc.running = true
  }

  function beginEnterTransition() {
    if (activeTransition === "slide") {
      dashOpacity = 1
      dashSlide = transitionDir * 48
      dashScale = 1
    } else if (activeTransition === "scale") {
      dashOpacity = 0
      dashSlide = 0
      dashScale = 0.96
    } else {
      dashOpacity = 0
      dashSlide = 0
      dashScale = 1
    }
    enterOpacity.to = 1
    enterSlide.to = 0
    enterScale.to = 1
    enterAnim.start()
  }

  function resetDashTransform() {
    dashOpacity = 1
    dashSlide = 0
    dashScale = 1
  }

  function loadView(viewId) {
    requestLoadView(viewId, 1)
  }

  function selectListView() {
    if (!views.length) return
    var idx = Math.max(0, Math.min(listCursor, views.length - 1))
    var cur = Model.viewIndex(views, screen.activeViewId)
    var dir = cur >= 0 && idx < cur ? -1 : 1
    listOpen = false
    requestLoadView(views[idx].id, dir)
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

  function toggleCarousel() {
    runCarouselCmd(["toggle"], "")
  }

  function cycleCarouselTransition() {
    runCarouselCmd(["cycle-transition"], "transition")
  }

  function bumpCarouselInterval(delta) {
    if (!carousel.enabled) return
    runCarouselCmd(["interval", String(delta)], "interval")
  }

  function runCarouselCmd(args, feedback) {
    if (carouselCmdProc.running) return
    deleteConfirmId = ""
    carouselFeedback = feedback || ""
    carouselCmdProc.command = [cliPath, "carousel"].concat(args)
    carouselCmdProc.running = true
  }

  function showToast(msg) {
    toastText = String(msg || "")
    if (!toastText) return
    toastAnim.restart()
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

  SequentialAnimation {
    id: toastAnim
    NumberAnimation {
      target: root
      property: "toastOpacity"
      to: 1
      duration: 120
      easing.type: Easing.OutCubic
    }
    PauseAnimation { duration: 1100 }
    NumberAnimation {
      target: root
      property: "toastOpacity"
      to: 0
      duration: 280
      easing.type: Easing.InCubic
    }
    ScriptAction { script: root.toastText = "" }
  }

  SequentialAnimation {
    id: exitAnim
    ParallelAnimation {
      NumberAnimation {
        id: exitOpacity
        target: root
        property: "dashOpacity"
        duration: 160
        easing.type: Easing.InCubic
      }
      NumberAnimation {
        id: exitSlide
        target: root
        property: "dashSlide"
        duration: 160
        easing.type: Easing.InCubic
      }
      NumberAnimation {
        id: exitScale
        target: root
        property: "dashScale"
        duration: 160
        easing.type: Easing.InCubic
      }
    }
    ScriptAction { script: root.commitPendingLoad() }
  }

  SequentialAnimation {
    id: enterAnim
    ParallelAnimation {
      NumberAnimation {
        id: enterOpacity
        target: root
        property: "dashOpacity"
        duration: 200
        easing.type: Easing.OutCubic
      }
      NumberAnimation {
        id: enterSlide
        target: root
        property: "dashSlide"
        duration: 200
        easing.type: Easing.OutCubic
      }
      NumberAnimation {
        id: enterScale
        target: root
        property: "dashScale"
        duration: 200
        easing.type: Easing.OutCubic
      }
    }
    ScriptAction {
      script: {
        root.viewTransitioning = false
        root.pendingViewId = ""
        root.resetDashTransform()
      }
    }
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

  FileView {
    id: carouselFile
    path: Model.carouselPath(root.home)
    watchChanges: true
    printErrors: false
    onLoaded: root.carousel = Model.parseCarousel(text())
    onFileChanged: reload()
    onLoadFailed: root.carousel = Model.emptyCarousel()
  }

  Process {
    id: loadViewProc
    stdout: StdioCollector {}
    stderr: StdioCollector {}
    onExited: {
      screenFile.reload()
      viewsFile.reload()
      if (root.viewTransitioning)
        root.beginEnterTransition()
      else
        root.resetDashTransform()
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

  Process {
    id: carouselCmdProc
    stdout: StdioCollector {
      id: carouselOut
      waitForEnd: true
    }
    stderr: StdioCollector {}
    onExited: function(exitCode) {
      if (exitCode === 0) {
        try {
          var raw = carouselOut.text || ""
          if (raw.trim())
            root.carousel = Model.parseCarousel(raw)
          else
            carouselFile.reload()
        } catch (e) {
          carouselFile.reload()
        }
      } else {
        carouselFile.reload()
      }
      var kind = root.carouselFeedback
      root.carouselFeedback = ""
      if (exitCode !== 0) return
      if (kind === "interval")
        root.showToast(root.carousel.intervalSec + "s")
      else if (kind === "transition")
        root.showToast(root.carousel.transition || "fade")
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
      carouselFile.reload()
    }
  }

  // Deterministic dataset refresh (HTTP sources); plugin owns the schedule
  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: root.runRefreshDue()
  }

  // Auto-cycle saved views when MCP carousel is enabled (panel open).
  Timer {
    interval: Math.max(3, root.carousel.intervalSec || 10) * 1000
    running: root.carousel.enabled && root.wantOpen && !root.listOpen && !root.deleteConfirmId
    repeat: true
    onTriggered: root.advanceCarousel()
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
          carouselFile.reload()
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
              if (t === "n" || t === "N") {
                if (!root.listOpen) root.cycleView(1)
                return
              }
              if (t === "p" || t === "P") {
                if (!root.listOpen) root.cycleView(-1)
                return
              }
              if (t === "c") {
                if (!root.listOpen) root.toggleCarousel()
                return
              }
              if (t === "C") {
                if (!root.listOpen) root.cycleCarouselTransition()
                return
              }
              if (t === "+" || t === "=") {
                if (!root.listOpen) root.bumpCarouselInterval(1)
                return
              }
              if (t === "-" || t === "_") {
                if (!root.listOpen) root.bumpCarouselInterval(-1)
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
                        : (root.carousel.enabled
                          ? "←→ / n p · c auto · Shift+C fx · +/- delay · V · d · Esc"
                          : "←→ / n p · c auto · Shift+C fx · V list · d delete · Esc")
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
                  height: dashStage.height
                  clip: true

                  Item {
                    id: dashStage
                    width: parent.width
                    height: dashLoader.item ? dashLoader.item.implicitHeight : emptyHint.implicitHeight
                    opacity: root.dashOpacity
                    x: root.dashSlide
                    scale: root.dashScale
                    transformOrigin: Item.Center

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
                }

                Item { width: 1; height: Style.space(8) }
              }
            }

            // Brief feedback for carousel interval / transition shortcuts
            Rectangle {
              anchors.horizontalCenter: parent.horizontalCenter
              anchors.bottom: parent.bottom
              anchors.bottomMargin: Style.space(28)
              width: toastLabel.implicitWidth + Style.space(28)
              height: toastLabel.implicitHeight + Style.space(16)
              radius: Style.cornerRadius
              color: Util.alpha(root.background, 0.92)
              border.color: Util.alpha(root.accent, 0.45)
              border.width: 1
              opacity: root.toastOpacity
              visible: root.toastOpacity > 0.01
              z: 20

              Text {
                id: toastLabel
                anchors.centerIn: parent
                textFormat: Text.PlainText
                text: root.toastText
                color: root.accent
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
              }
            }
          }
        }
      }
    }
  }
}
