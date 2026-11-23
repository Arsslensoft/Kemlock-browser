// What a call of the core can fail with, as the TypeScript side reads it: a short code it switches on, and the words
// of the failure for the log. The wire carries it as `{ok: false, error: {code, message}}` (js/bridge.dart).

/// A call the core refused, or could not do.
class CoreFailure implements Exception {
  const CoreFailure(this.code, [this.message = '']);

  /// There is no vault yet, or the call needs one.
  static const noVault = 'noVault';

  /// The vault already exists.
  static const exists = 'exists';

  /// The call needs the vault open.
  static const locked = 'locked';

  /// A value the call was given isn't one it takes.
  static const invalid = 'invalid';

  /// What the call names isn't in the vault.
  static const notFound = 'notFound';

  /// A code link that isn't an otpauth:// one (or whose secret isn't one).
  static const notAnOtpauth = 'notAnOtpauth';

  /// What was to be added is saved already.
  static const duplicate = 'duplicate';

  /// The core was not given something it needs (the word list, a QR reader).
  static const unavailable = 'unavailable';

  /// The vault needs more to open than a password, which the extension's own vault never does.
  static const keyNeeded = 'keyNeeded';

  /// Anything else; [message] says what.
  static const failed = 'failed';

  final String code;
  final String message;

  @override
  String toString() => 'CoreFailure($code${message.isEmpty ? '' : ': $message'})';
}
