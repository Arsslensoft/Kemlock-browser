// Which browser the extension runs in, as the Kemlock Server and Vaultwarden are told: a device named "Kemlock · Chrome"
// (add-kemlock-server-sync, design 2) and Bitwarden's device type for it (2 Chrome, 3 Firefox, 5 Edge).

/// The browsers the extension is built for.
enum Browser {
  chrome('Chrome', 2),
  firefox('Firefox', 3),
  edge('Edge', 5);

  const Browser(this.label, this.deviceType);

  /// "Chrome", for the device's name.
  final String label;

  /// Bitwarden's device type for the browser's extension.
  final int deviceType;

  /// How the account's device list names this browser's extension: "Kemlock · Chrome".
  String get deviceName => 'Kemlock · $label';

  /// What a device of this browser is to Kemlock Server.
  static const kemlockKind = 'kemlock-browser';

  /// The browser a `User-Agent` names. Edge says `Edg/`, and says Chrome too; Firefox says `Firefox/`; anything else is Chrome,
  /// whose engine every other Chromium browser shares.
  static Browser fromUserAgent(String userAgent) {
    if (userAgent.contains('Edg/') || userAgent.contains('EdgA/') || userAgent.contains('EdgiOS/')) return edge;
    if (userAgent.contains('Firefox/')) return firefox;
    return chrome;
  }

  /// The browser named by [name] (`chrome`, `edge` or `firefox`), or null.
  static Browser? named(String? name) {
    for (final browser in values) {
      if (browser.name == name) return browser;
    }
    return null;
  }
}
