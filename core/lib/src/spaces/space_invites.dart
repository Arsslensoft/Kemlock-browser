// The routes an invitation uses on Kemlock Server, beside the chain's (docs/plans/add-server-spaces.md, tasks 5.2 and 5.3):
//
// - `GET /kem/v1/spaces/{id}/lookup?email=` answers `{account, bundle, bundleSignature, keyVersion}`: the account that has
//   the email, its public-key bundle and the bundle's self-signature (base64url), and the key version. It is limited to the space's Owners, Admins and members who manage users: `403` for anyone else,
//   `404` (`no-account`) for an unknown email, and it is rate-limited (`429`). It tells who an invitation would reach; the
//   fingerprint is compared later, at the confirmation, and a bundle given here is never what a key is sealed to. The
//   signature is checked, and the key version compared with the bundle's, before an invitation is built; an answer
//   without them, or with a wrong one, is refused.
// - `POST /kem/v1/spaces/{id}/members/{user}/resend` sends an invitation's email again: `204`, and `429` at most once per
//   10 minutes.
// - `POST /kem/v1/spaces/{id}/members/me/accept` with no body is the invitee's accept: `200` with the member, who then waits
//   to be confirmed. The server takes the bundle from the account, so nothing is uploaded, and the accept is no chain
//   record: the spec's kinds have none, and the server's "accepted" step of an invitation is its own, not in the chain
//   ("What the server stores, serves and checks", S2). `DELETE /kem/v1/spaces/{id}/members/me` declines it, which drops
//   the invitation.
//
// Pure Dart, no Flutter.

library;

import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/features/spaces/space_chain.dart' show ChainCrypto, RealChainCrypto;
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';

/// The account an invitation by email would reach, and the bundle the server holds for it.
typedef InviteeLookup = ({String account, KeyBundle bundle});

/// Why a lookup of an account by email gave none.
enum InviteLookupProblem {
  /// The caller isn't an Owner, an Admin or a member who manages users.
  notAllowed,

  /// Too many lookups: try again later.
  rateLimited,

  /// The answer isn't `{account, bundle, bundleSignature, keyVersion}` of one account, or its signature or key version
  /// is not that bundle's.
  malformed,
}

/// A lookup that failed for a reason the sheet words.
class InviteLookupError implements Exception {
  const InviteLookupError(this.problem, {this.retryAfter});

  final InviteLookupProblem problem;

  /// Seconds to wait, for [InviteLookupProblem.rateLimited], when the server said.
  final int? retryAfter;

  @override
  String toString() => 'InviteLookupError(${problem.name})';
}

/// Why an invitation wasn't sent again.
enum ResendProblem {
  /// It was sent less than 10 minutes ago.
  tooSoon,

  /// The caller may not, or there is no such invitation.
  notAllowed,
}

/// An invitation that wasn't sent again, and why.
class ResendError implements Exception {
  const ResendError(this.problem, {this.retryAfter});

  final ResendProblem problem;
  final int? retryAfter;

  @override
  String toString() => 'ResendError(${problem.name})';
}

/// One space's invitation routes, through a connection that keeps the access token alive.
class SpaceInviteClient {
  SpaceInviteClient({required this.connection, required this.server, required this.space, this.crypto = const RealChainCrypto()});

  final KmConnection connection;
  final Uri server;
  final String space;

  /// The check of a bundle's self-signature, which a test replaces with a cheap one.
  final ChainCrypto crypto;

  KmApi get _api => connection.api;

  /// The account that has [email] and its bundle, or null when none does. A [InviteLookupError] when the server refuses
  /// the caller or limits the lookups, or answers with something else than one account's bundle; a [KmError] for any other
  /// failure.
  Future<InviteeLookup?> lookup(String email) async {
    final Map<String, Object?>? answer;
    try {
      answer = await connection.call((token) => _api.call('GET', server, '/spaces/$space/lookup', token: token, query: {'email': email}));
    } on KmError catch (e) {
      if (e.status == 404) {
        return null;
      }
      if (e.status == 403) {
        throw const InviteLookupError(InviteLookupProblem.notAllowed);
      }
      if (e.problem == KmProblem.rateLimited) {
        throw InviteLookupError(InviteLookupProblem.rateLimited, retryAfter: e.retryAfter);
      }
      rethrow;
    }
    final account = answer?['account'];
    final bundle = answer?['bundle'];
    final signature = answer?['bundleSignature'];
    final keyVersion = answer?['keyVersion'];
    // Every answer carries the signature and the key version, so one without them is refused like a wrong one
    if (account is! String || bundle is! String || signature is! String || keyVersion is! int || !isUuidText(account)) {
      throw const InviteLookupError(InviteLookupProblem.malformed);
    }
    try {
      final parsed = KeyBundle.parse(b64urlDecode(bundle));
      // A bundle of another account than the one named is the server's mistake or its lie
      if (uuidText(parsed.accountId) != account.toLowerCase()) {
        throw const InviteLookupError(InviteLookupProblem.malformed);
      }
      if (keyVersion != parsed.keyVersion) {
        throw const InviteLookupError(InviteLookupProblem.malformed);
      }
      // A bundle that isn't signed by its own key is refused before an invitation is built over it
      if (!await crypto.checkBundle(parsed, b64urlDecode(signature))) {
        throw const InviteLookupError(InviteLookupProblem.malformed);
      }
      return (account: account.toLowerCase(), bundle: parsed);
    } on MalformedException {
      throw const InviteLookupError(InviteLookupProblem.malformed);
    }
  }

  /// Sends the invitation of [user] again. A [ResendError] for a 429 (once per 10 minutes) and for a refusal; a
  /// [KmError] for any other failure.
  Future<void> resend(String user) async {
    if (!isUuidText(user)) {
      throw ArgumentError.value(user, 'user', 'an account id');
    }
    try {
      await connection.call((token) => _api.call('POST', server, '/spaces/$space/members/$user/resend', token: token));
    } on KmError catch (e) {
      if (e.problem == KmProblem.rateLimited) {
        throw ResendError(ResendProblem.tooSoon, retryAfter: e.retryAfter);
      }
      if (e.status == 403 || e.status == 404) {
        throw const ResendError(ResendProblem.notAllowed);
      }
      rethrow;
    }
  }

  /// Answers the invitation: accepts it with `POST .../members/me/accept` and no body, which answers the member (their
  /// state is then "accepted" and they wait to be confirmed), or declines it with `DELETE .../members/me`, which drops it.
  /// The server takes the bundle from the account, so neither uploads anything, and neither seals or opens a key. A
  /// [KmError] when the server refuses.
  Future<void> answer({required bool accept}) async {
    if (accept) {
      await connection.call((token) => _api.call('POST', server, '/spaces/$space/members/me/accept', token: token));
    } else {
      await connection.call((token) => _api.call('DELETE', server, '/spaces/$space/members/me', token: token));
    }
  }
}
