// Whether a password is among those known from data breaches, asked of Have I Been Pwned's Pwned Passwords without the password
// leaving the browser, as the app does (`pwned_passwords.dart`, openspec: password-leak-check): the service is asked for every
// leaked password whose SHA-1 starts with the same five characters, and the answer is searched here. It learns those five
// characters, 20 of the hash's 160 bits, and nothing else. Only while the breached-passwords switch is on.
import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

/// The password couldn't be checked: no answer in time, or one that can't be read. It says nothing about the password.
class LeakCheckError implements Exception {
  const LeakCheckError(this.reason);

  final String reason;

  @override
  String toString() => 'LeakCheckError: $reason';
}

/// Asks Pwned Passwords through [client].
class PwnedPasswords {
  PwnedPasswords(this.client, {this.timeout = const Duration(seconds: 10)});

  final http.Client client;
  final Duration timeout;

  static const _range = 'https://api.pwnedpasswords.com/range/';

  /// A padded answer is under 40 kB; anything far past that isn't one.
  static const _maxBytes = 1 << 20;

  /// The SHA-1 of [password] as the service writes it, in upper case.
  static String hashOf(String password) => sha1.convert(utf8.encode(password)).toString().toUpperCase();

  /// How many times [password] appears in the breaches Pwned Passwords knows, 0 when it isn't among them. Throws a
  /// [LeakCheckError] when it can't tell.
  Future<int> timesLeaked(String password) async {
    final hash = hashOf(password);
    final suffix = hash.substring(5);
    final http.Response response;
    try {
      final request = http.Request('GET', Uri.parse('$_range${hash.substring(0, 5)}'))
        // Pads the answer to 800-1,000 lines, so its size says nothing of the prefix
        ..headers['Add-Padding'] = 'true';
      final streamed = await client.send(request).timeout(timeout);
      final length = streamed.contentLength;
      if (length != null && length > _maxBytes) throw const LeakCheckError('answer too large');
      response = await http.Response.fromStream(streamed).timeout(timeout);
    } on LeakCheckError {
      rethrow;
    } on TimeoutException {
      throw const LeakCheckError('no answer in time');
    } catch (error) {
      throw LeakCheckError('no answer: $error');
    }
    if (response.statusCode != 200) throw LeakCheckError('status ${response.statusCode}');
    if (response.bodyBytes.length > _maxBytes) throw const LeakCheckError('answer too large');
    // Lines of SUFFIX:COUNT; the padding's have a count of 0
    for (final line in const LineSplitter().convert(response.body)) {
      final colon = line.indexOf(':');
      if (colon < 0 || line.substring(0, colon).trim().toUpperCase() != suffix) continue;
      final count = int.tryParse(line.substring(colon + 1).trim());
      if (count != null) return count < 0 ? 0 : count;
    }
    return 0;
  }
}
