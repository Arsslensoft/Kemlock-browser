// What the server tells beside the chain about a space's members (docs/plans/add-server-spaces.md, task 5.3), for the
// admin who confirms them: `GET /kem/v1/spaces/{id}/members` answers, for each member, the member's own fields (`user`,
// `state`, ...) and `email`, `name`, `publicBundle`, `bundleSignature`, `userKeyVersion` and `needsReconfirmation`, the
// bundle and its signature in base64url.
//
// Nothing here is trusted until a `confirm` carries it, so it is only what the sheet offers to compare:
//
// - **An offer** is the bundle of a member who accepted their invitation and waits to be confirmed, or of a confirmed
//   member whose key version changed and whose bundle the chain doesn't record yet. It is made only when the bundle is of
//   that account, its key version is the one the server says, and its self-signature verifies: a bundle that isn't signed
//   by its own key is never shown for comparison. The `confirm` is then built over exactly that bundle, after the digits
//   matched (`SpaceActions.confirm`).
// - **A fresh comparison** is what a confirmed member with `needsReconfirmation` needs: the row says so, whether or not
//   the chain already holds their new bundle (a `rekey` was vouched for by the old key, and nobody compared it).
// - **Names** are the member's name, or else their email, as the server shows them. They only label a row.
//
// Pure Dart, no Flutter.

library;

import 'dart:typed_data';

import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/bytes.dart' show constantTimeEquals;
import 'package:kemlock_core/features/spaces/space_chain.dart' show ChainCrypto, RealChainCrypto;
import 'package:kemlock_core/features/spaces/space_state.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';

/// A bundle to compare with the member's own screen, and its self-signature.
typedef BundleOffer = ({KeyBundle bundle, Uint8List bundleSignature});

/// What the server told of a space's members, checked against the chain.
class SpaceMembers {
  const SpaceMembers({this.offers = const {}, this.reconfirm = const {}, this.names = const {}});

  /// By account id, the bundles to compare and confirm.
  final Map<String, BundleOffer> offers;

  /// The confirmed members the server says need a fresh comparison.
  final Set<String> reconfirm;

  /// By account id, what the server calls the member.
  final Map<String, String> names;
}

/// The longest name the sheet shows.
const _nameLimit = 120;

/// One space's members route, through a connection that keeps the access token alive.
class SpaceMembersClient {
  SpaceMembersClient({required this.connection, required this.server, required this.space, this.crypto = const RealChainCrypto()});

  final KmConnection connection;
  final Uri server;
  final String space;

  /// The check of a bundle's self-signature, which a test replaces with a cheap one.
  final ChainCrypto crypto;

  /// The members the server tells of, read against the verified [chain]. Nothing for a caller the server doesn't let
  /// read them (`403`) or a space it doesn't know (`404`); a [KmError] for any other failure.
  Future<SpaceMembers> read(SpaceState chain) async {
    final Object? raw;
    try {
      raw = await connection.call((token) => connection.api.callValue('GET', server, '/spaces/$space/members', token: token));
    } on KmError catch (e) {
      if (e.status == 403 || e.status == 404) {
        return const SpaceMembers();
      }
      rethrow;
    }
    final list = raw is Map<String, Object?> ? raw['members'] : raw;
    if (list is! List<Object?>) {
      return const SpaceMembers();
    }
    final offers = <String, BundleOffer>{};
    final reconfirm = <String>{};
    final names = <String, String>{};
    for (final item in list) {
      if (item is! Map<String, Object?>) {
        continue;
      }
      final user = item['user'];
      if (user is! String || !isUuidText(user)) {
        continue;
      }
      final id = user.toLowerCase();
      final member = chain.member(id);
      // The chain says who is in the space: the server's list adds nothing about anyone else
      if (member == null || !member.inSpace) {
        continue;
      }
      final name = _text(item['name']) ?? _text(item['email']);
      if (name != null) {
        names[id] = name;
      }
      final needs = item['needsReconfirmation'] == true;
      final offer = await _offer(item, id);
      if (offer == null) {
        if (member.isConfirmed && needs) {
          reconfirm.add(id);
        }
        continue;
      }
      if (member.status == MemberStatus.invited && item['state'] == 'accepted') {
        offers[id] = offer;
      } else if (member.isConfirmed && needs) {
        reconfirm.add(id);
        // A bundle the chain already records has nothing new to confirm; the row only says it needs a comparison
        final recorded = member.bundle;
        if (recorded == null || !constantTimeEquals(recorded.bytes, offer.bundle.bytes)) {
          offers[id] = offer;
        }
      }
    }
    return SpaceMembers(offers: offers, reconfirm: reconfirm, names: names);
  }

  /// The member's bundle and its signature when they are the account's own: of [id], at the key version the server says,
  /// and signed by the bundle's own key. Null otherwise.
  Future<BundleOffer?> _offer(Map<String, Object?> item, String id) async {
    final bundleText = item['publicBundle'];
    final signatureText = item['bundleSignature'];
    final version = item['userKeyVersion'];
    if (bundleText is! String || signatureText is! String) {
      return null;
    }
    try {
      final bundle = KeyBundle.parse(b64urlDecode(bundleText));
      final signature = b64urlDecode(signatureText);
      if (uuidText(bundle.accountId) != id || (version != null && version != bundle.keyVersion)) {
        return null;
      }
      if (!await crypto.checkBundle(bundle, signature)) {
        return null;
      }
      return (bundle: bundle, bundleSignature: signature);
    } on MalformedException {
      return null;
    } on FormatException {
      return null;
    }
  }

  String? _text(Object? value) {
    if (value is! String) {
      return null;
    }
    final text = value.trim();
    if (text.isEmpty) {
      return null;
    }
    return text.length > _nameLimit ? text.substring(0, _nameLimit) : text;
  }
}
