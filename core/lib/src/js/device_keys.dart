// The device key of Kemlock Server (design D6, add-kemlock-server-sync design 2): a WebCrypto ECDSA P-256 key made
// non-extractable, kept in the extension's IndexedDB. The page and the content scripts can't read it, and it can't be copied out
// of the browser's profile as a key. Signing goes through `crypto.subtle.sign`, which gives the 64 bytes `r || s` of a JWS.
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'package:kemlock_core/features/sync/kemlock/km_device_key.dart';
import 'package:web/web.dart' as web;

import '../platform.dart';
import 'globals.dart';

const _database = 'kemlock-device-keys';
const _store = 'keys';

JSObject get _subtle => globalCrypto.subtle as JSObject;

/// A key pair in the browser's hands: only its public half is ever read, as a JWK.
class WebCryptoDeviceKey implements DeviceKey {
  WebCryptoDeviceKey(this._privateKey, this.publicJwk);

  final JSObject _privateKey;

  @override
  final Map<String, String> publicJwk;

  @override
  String get protection => DeviceKeyProtection.browser;

  @override
  Future<Uint8List> sign(Uint8List message) async {
    final algorithm = {
      'name': 'ECDSA',
      'hash': {'name': 'SHA-256'},
    }.jsify();
    final signature = await _subtle.callMethod<JSPromise<JSAny?>>('sign'.toJS, algorithm, _privateKey, message.toJS).toDart;
    return Uint8List.fromList((signature! as JSArrayBuffer).toDart.asUint8List());
  }
}

/// Device keys in IndexedDB, by tag.
class WebCryptoDeviceKeys implements DeviceKeyStore {
  Future<web.IDBDatabase> _open() async {
    final request = globalIndexedDb.open(_database, 1);
    request.onupgradeneeded = ((web.Event _) {
      final db = request.result! as web.IDBDatabase;
      if (!db.objectStoreNames.contains(_store)) db.createObjectStore(_store);
    }).toJS;
    return await awaitRequest(request) as web.IDBDatabase;
  }

  Future<JSAny?> _run(String mode, web.IDBRequest Function(web.IDBObjectStore store) request) async {
    final db = await _open();
    try {
      final transaction = db.transaction(_store.toJS, mode);
      return await awaitRequest(request(transaction.objectStore(_store)));
    } finally {
      db.close();
    }
  }

  @override
  Future<DeviceKey> create(String tag) async {
    final algorithm = {'name': 'ECDSA', 'namedCurve': 'P-256'}.jsify();
    final pair =
        (await _subtle.callMethod<JSPromise<JSAny?>>('generateKey'.toJS, algorithm, false.toJS, ['sign', 'verify'].jsify()).toDart)!
            as JSObject;
    await _run('readwrite', (store) => store.put(pair, tag.toJS));
    return _readKey(pair);
  }

  @override
  Future<DeviceKey?> open(String tag) async {
    final pair = await _run('readonly', (store) => store.get(tag.toJS));
    if (!pair.isDefinedAndNotNull) return null;
    return _readKey(pair! as JSObject);
  }

  @override
  Future<void> delete(String tag) async {
    await _run('readwrite', (store) => store.delete(tag.toJS));
  }

  Future<DeviceKey> _readKey(JSObject pair) async {
    final publicKey = pair.getProperty<JSObject>('publicKey'.toJS);
    final jwk =
        (await _subtle.callMethod<JSPromise<JSAny?>>('exportKey'.toJS, 'jwk'.toJS, publicKey).toDart).dartify()! as Map<Object?, Object?>;
    return WebCryptoDeviceKey(pair.getProperty<JSObject>('privateKey'.toJS), {
      'kty': jwk['kty']! as String,
      'crv': jwk['crv']! as String,
      'x': jwk['x']! as String,
      'y': jwk['y']! as String,
    });
  }
}
