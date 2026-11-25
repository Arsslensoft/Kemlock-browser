// What every call of the account's own routes has: a connection to the server with the session's tokens, the opened account, and the
// words an approval is shown in. The connection renews the access token and seals each new session before it is used (KmConnection).
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/features/sync/kemlock/km_account.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_approvals.dart';

import '../failure.dart';
import 'kit_pieces.dart';

class AccountContext {
  AccountContext({required this.connection, required this.account, this.words, this.clock = DateTime.now});

  final KmConnection connection;

  /// The opened account. Its keys are wiped when the call that made this ends.
  final KmAccount account;

  /// EFF's large list, for the five words of an approval; null when the extension was given none.
  final List<String>? words;
  final DateTime Function() clock;

  KmApi get api => connection.api;
  Uri get server => connection.server;

  /// One request under `/kem/v1` with the access token. A 204 answers an empty object, and a 404 null when [absentIsNull].
  Future<Map<String, Object?>?> call(String method, String route, {Object? body, bool absentIsNull = false}) =>
      connection.call((token) => api.call(method, server, route, token: token, body: body, absentIsNull: absentIsNull));
}

/// A time as the pages take it: epoch milliseconds, or null.
int? millis(DateTime? time) => time?.millisecondsSinceEpoch;

/// The text of [value] if it is a string, else null.
String? textOf(Object? value) => value is String ? value : null;

/// [value] as an object, or a [CoreFailure] when it is none.
Map<String, Object?> objectOf(Object? value, String what) =>
    value is Map<String, Object?> ? value : throw CoreFailure(CoreFailure.failed, 'an answer without $what');

/// What [error] is as the one code the pages read: the engine's own failures named by their kind (`rateLimited`, `sessionEnded`,
/// `phraseMismatch`, `pieceChecksum`, ...), never their text, which can carry what was typed.
Object accountFailure(Object error) {
  switch (error) {
    case CoreFailure():
      return error;
    case KmError(:final problem, :final status, :final message):
      final code = switch (problem) {
        KmProblem.server => switch (status) {
          400 || 422 => 'badRequest',
          403 => 'forbidden',
          404 => 'notFound',
          409 => 'conflict',
          _ => 'server',
        },
        _ => problem.name,
      };
      return CoreFailure(code, 'the server answered $status${message == null ? '' : ': $message'}');
    case KmApprovalError(:final issue):
      return CoreFailure(issue.name);
    case PieceError(:final problem):
      return CoreFailure('piece${problem.name[0].toUpperCase()}${problem.name.substring(1)}');
    case MalformedException() || CorruptedException():
      return const CoreFailure('unreadable');
    default:
      return error;
  }
}
