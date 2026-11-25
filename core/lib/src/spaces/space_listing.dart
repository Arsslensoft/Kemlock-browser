// What `GET /kem/v1/spaces` answers, the account's spaces (docs/plans/add-server-spaces.md, task 5.1), as the server's code
// gives it: an array of
//
//     {"space": {"id", "name", "keyVersion", "keysPendingSince"?, "createdAt"},
//      "member": {"user", "role", "custom": [], "state", "invitedBy", "invitedAt", "acceptedAt"?, "sealedSpaceKey"?,
//                 "keyVersion"?, "confirmation"?, "revokedAt"?}}
//
// where `name` is base64url of the space's name as a `kem1` envelope of kind `"space-name"`. Nothing here is trusted: the
// name opens only through the chain's commitment (`openCommittedName`), the state beside it only says whether an
// invitation was accepted (the chain doesn't record that), and every fact about people and keys is the chain's.
//
// Pure Dart, no Flutter.

library;

import 'dart:typed_data';

import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/models/json.dart';

/// One space the account is a member of, as the list gives it.
class ListedSpace {
  const ListedSpace({required this.id, this.sealedName, this.keyVersion = 0, this.state = '', this.hasAcceptedAt = false});

  final String id;

  /// The sealed name, or null when the server gave none or it isn't base64url.
  final Uint8List? sealedName;

  /// The space key version the server says the name is under; the chain's own is what counts.
  final int keyVersion;

  /// The account's own state in the space: `invited`, `accepted`, `confirmed`, `revoked`, as the server says it.
  final String state;

  /// Whether the member record has an `acceptedAt`, however the server writes the time.
  final bool hasAcceptedAt;

  /// Whether the account accepted its invitation and waits to be confirmed.
  bool get accepted => state == 'accepted' || (state == 'invited' && hasAcceptedAt);
}

/// The spaces of [raw], the answer of the list. An answer that isn't an array is a [KmError]; an item that isn't a space
/// (no id, no member) is left out, and a name that isn't base64url is read as none.
List<ListedSpace> parseSpaceList(Object? raw) {
  if (raw is! List<Object?>) {
    throw const KmError(KmProblem.server, message: 'a list of spaces');
  }
  final spaces = <ListedSpace>[];
  for (final item in raw) {
    if (item is! Map<String, Object?>) {
      continue;
    }
    final space = item['space'];
    final member = item['member'];
    if (space is! Map<String, Object?> || member is! Map<String, Object?>) {
      continue;
    }
    final id = space['id'];
    if (id is! String) {
      continue;
    }
    Uint8List? sealedName;
    final name = space['name'];
    if (name is String) {
      try {
        sealedName = b64urlDecode(name);
      } on MalformedException {
        sealedName = null;
      }
    }
    final state = member['state'];
    spaces.add(
      ListedSpace(
        id: id,
        sealedName: sealedName,
        keyVersion: asInt(space['keyVersion']) ?? 0,
        state: state is String ? state : '',
        hasAcceptedAt: member['acceptedAt'] != null,
      ),
    );
  }
  return spaces;
}
