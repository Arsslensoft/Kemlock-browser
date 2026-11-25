// Which browser the extension runs in, as the Kemlock Server and Vaultwarden are told: a device named "Kemlock · Chrome"
// (add-kemlock-server-sync, design 2) and Bitwarden's device type for it (2 Chrome, 3 Firefox, 5 Edge, 20 Safari).

/// The browsers the extension is built for.
enum Browser {
  chrome('Chrome', 2),
  firefox('Firefox', 3),
  edge('Edge', 5),
  safari('Safari', 20);

  const Browser(this.label, this.deviceType);

  /// "Chrome", for the device's name.
  final String label;

  /// Bitwarden's device type for the browser's extension.
  final int deviceType;

  /// How the account's device list names this browser's extension: "Kemlock · Chrome".
  String get deviceName => 'Kemlock · $label';

  /// What a device of this browser is to Kemlock Server.
  static const kemlockKind = 'kemlock-browser';

  /// The browser a `User-Agent` names. Edge says `Edg/`, and says Chrome too; Firefox says `Firefox/`; Safari says `Safari/` and
  /// `Version/` and never Chrome (every Chromium browser says `Safari/` too, with `Chrome/`); anything else is Chrome, whose engine
  /// every other Chromium browser shares.
  static Browser fromUserAgent(String userAgent) {
    if (userAgent.contains('Edg/') || userAgent.contains('EdgA/') || userAgent.contains('EdgiOS/')) return edge;
    if (userAgent.contains('Firefox/')) return firefox;
    if (userAgent.contains('Safari/') && userAgent.contains('Version/') && !_chromium.any(userAgent.contains)) return safari;
    return chrome;
  }

  /// What only a Chromium browser's user agent holds (Chrome, Opera, Brave and Vivaldi say `Chrome/`; iOS's Chrome says `CriOS/`).
  static const _chromium = ['Chrome/', 'Chromium/', 'CriOS/', 'FxiOS/'];

  /// The browser named by [name] (`chrome`, `edge`, `firefox` or `safari`), or null.
  static Browser? named(String? name) {
    for (final browser in values) {
      if (browser.name == name) return browser;
    }
    return null;
  }
}
