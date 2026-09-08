import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "juienpro.universal-dashboard"

  // nf-md-view_dashboard
  readonly property string label: "󰕮"
  readonly property bool windowOpen: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property color pillColor: windowOpen
    ? (bar ? bar.urgent : Color.urgent)
    : (panelLoader.item && panelLoader.item.hasContent
      ? (bar ? bar.urgent : Color.urgent)
      : (bar ? bar.barForeground : Color.foreground))

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("hostWidget" in target) target.hostWidget = root
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Not a bar popout — FloatingWindow is independent. Keep opened false so the
  // bar's exclusive-popout coordinator does not treat this as a dropdown.
  readonly property bool opened: false

  function open() {
    if (panelLoader.item && panelLoader.item.open) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  readonly property bool popoutSwitchClosing: false
  function closeForPopoutSwitch() {}

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "juienpro.universal-dashboard"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function nextView(): void {
      if (panelLoader.item && panelLoader.item.cycleView) panelLoader.item.cycleView(1)
    }
    function prevView(): void {
      if (panelLoader.item && panelLoader.item.cycleView) panelLoader.item.cycleView(-1)
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.label
    foreground: root.pillColor
    active: root.windowOpen
    useActiveColor: true
    tooltipText: "Universal Dashboard"
    slotSize: Style.bar.iconSlot

    onPressed: function(b) {
      if (!root.bar) return
      root.togglePanel()
    }
  }
}
