// What the core takes from the browser (design decision 2: the platform seams). The JavaScript side of each lives in js/;
// everything else in the core sees only these, so the VM tests run it over fakes.
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:kemlock_core/core/storage/preferences_interface.dart';
import 'package:kemlock_core/features/sync/kemlock/km_device_key.dart';
import 'package:kemlock_core/features/sync/kemlock/km_passkey.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sso.dart';

import 'browser.dart';

/// The pixels of an image as the QR reader takes them: `0xAARRGGBB`, row by row.
typedef Pixels = ({int width, int height, Int32List argb});

/// The device keys of Kemlock Server (design D6): ECDSA P-256 keys the browser holds, that nothing can copy out.
abstract interface class DeviceKeyStore {
  /// Makes the key under [tag], replacing one that was there.
  Future<DeviceKey> create(String tag);

  /// The key under [tag], or null when there is none.
  Future<DeviceKey?> open(String tag);

  /// Forgets the key under [tag].
  Future<void> delete(String tag);
}

/// Everything the core takes from the browser. The background gives the JavaScript sides of it when it loads the core.
class CorePlatform {
  CorePlatform({
    required this.storage,
    required this.clientFor,
    required this.deviceKeys,
    required this.browserAuth,
    required this.browser,
    required this.sessionKey,
    this.passkeys,
    this.ssoRedirect,
    this.decodeImage,
    this.version = '0.0.0',
    this.clock = DateTime.now,
  });

  /// `storage.local`, as the app's preferences.
  final PreferencesBackend storage;

  /// A new HTTP client for a server. The pin is the phone's certificate pinning, which a browser has no way to do.
  final http.Client Function(String? pin) clientFor;

  final DeviceKeyStore deviceKeys;

  /// SSO through `identity.launchWebAuthFlow`.
  final KmBrowserAuth browserAuth;

  /// A passkey or security key with its PRF, asked in a page of the extension.
  final KmPasskeyAsserter? passkeys;

  /// Where the browser's identity API ends an SSO trip (`https://<id>.chromiumapp.org/`); null where it has none.
  final Uri? ssoRedirect;

  /// Which browser this is.
  final Browser browser;

  /// The key `exportSession` seals the open vault's keys with: 32 random bytes the background keeps in `storage.session`.
  final Uint8List sessionKey;

  /// An image's pixels, from a data URL; null where the browser can't decode one.
  final Future<Pixels?> Function(String dataUrl)? decodeImage;

  /// The extension's version, which Vaultwarden is told.
  final String version;

  final DateTime Function() clock;
}

/// What the background gives the core at load, beside the platform: the files it read from the extension's own files,
/// since the core holds no large data (design decision 1).
class CoreData {
  const CoreData({this.publicSuffixList, this.wordList, this.twoFactorDirectory, this.breachList});

  /// publicsuffix.org's list, as its `.dat` text.
  final String? publicSuffixList;

  /// EFF's large word list, as served: five dice digits, a tab and a word per line.
  final String? wordList;

  /// The 2FA directory's JSON, as 2fa.directory's copy the app bundles.
  final String? twoFactorDirectory;

  /// The breach list's JSON, the copy of Have I Been Pwned's list the app bundles (`assets/data/breaches.json`).
  final String? breachList;
}
