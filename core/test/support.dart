// What the tests give the core in place of the browser.
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/features/sync/kemlock/km_device_key.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sso.dart';
import 'package:kemlock_extension_core/src/browser.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';

class FakeDeviceKeys implements DeviceKeyStore {
  final keys = <String, DeviceKey>{};

  @override
  Future<DeviceKey> create(String tag) async => keys[tag] = SoftwareDeviceKey.generate();

  @override
  Future<DeviceKey?> open(String tag) async => keys[tag];

  @override
  Future<void> delete(String tag) async => keys.remove(tag);
}

class FakeBrowserAuth implements KmBrowserAuth {
  @override
  Future<Uri?> authenticate(Uri url, {required String state}) async => null;

  @override
  Future<void> cancel() async {}
}

/// 32 bytes, the same for every session of a test.
final testSessionKey = Uint8List.fromList(List.generate(32, (i) => i));

CorePlatform fakePlatform(MemoryArea area, {http.Client Function(String? pin)? clientFor, DateTime Function()? clock}) => CorePlatform(
  storage: AreaPreferences(area),
  clientFor: clientFor ?? (_) => MockClient((request) async => http.Response('not found', 404)),
  deviceKeys: FakeDeviceKeys(),
  browserAuth: FakeBrowserAuth(),
  browser: Browser.chrome,
  sessionKey: testSessionKey,
  version: '1.2.3',
  clock: clock ?? () => DateTime.fromMillisecondsSinceEpoch(1700000000000, isUtc: true),
);

/// A small Public Suffix List: the real one holds these rules too.
const smallSuffixList = '''
// ===BEGIN ICANN DOMAINS===
com
io
net
co.uk
// ===BEGIN PRIVATE DOMAINS===
github.io
herokuapp.com
''';

Future<CoreService> startCore(MemoryArea area, {String? publicSuffixList = smallSuffixList, String? wordList, String? directory}) =>
    CoreService.start(fakePlatform(area), CoreData(publicSuffixList: publicSuffixList, wordList: wordList, twoFactorDirectory: directory));
