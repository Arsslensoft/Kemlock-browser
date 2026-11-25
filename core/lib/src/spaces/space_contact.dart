// First contact with a space (the space chain section of docs/crypto.md, "First contact"). A chain that verifies is only
// consistent: a server could make a whole space of its own, with its own keys, and it would verify. What ties a chain
// to people is a fingerprint comparison, made once per space and device, before the device trusts the chain.
//
// - **Who.** The device picks an **anchor person** P and compares P's fingerprint. An invitee's device: P is the inviter,
//   the `by` of the `invite` in effect for the account, or a confirmed Owner the person picks when the inviter is no
//   longer a confirmed member. A confirmed member's new device: P is the confirmer, the `by` of the record that last
//   confirmed the account, unless the account's own current key signed or cosigned a record after that one, whose own
//   key then vouches for the chain. The creator's device made `create` itself and is its own anchor.
// - **What is compared.** The fingerprint of P's bundle as the verified chain records it at its head. That bundle must
//   have signed or cosigned a record at or after the `invite` (or the confirmation) that admitted the account: then a
//   match shows P's real key made that record, and an honest client signs a record only on a chain it verified.
// - **When.** On the accept screen, after the chain verifies and before the Accept button, storing an anchor, opening or
//   sealing a key, account recovery enrolment, or showing the space's members, policies or notices as checked. If the
//   person taps "Not now" or the digits differ, the device stores nothing.
//
// This is the logic; the accept screen that shows it is the sync plan's task 5.3.
//
// Decided by the owner: anchors sync between one account's devices through the personal vault
// (`SyncedSpaceAnchorStore` in space_head_store.dart) with the record that a device compared the space's fingerprint
// (`SpaceAnchors.hasCompared`), so a new device of the account that finds the space so recorded compares nothing.
// [firstContact] is for a device with no such record: a new phone of an account with no vault sync, or of a space none of
// its other phones compared. An anchor without the record (a chain that was only read) is no first contact, and the space
// goes through it again. The creator and vouched kinds hold only where the chain records the key this phone holds
// ([confirmRecordsOwnBundle]), which the screen checks.
//
// Pure Dart, no Flutter.

library;

import 'dart:typed_data';

import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/bytes.dart' show constantTimeEquals;
import 'package:kemlock_core/features/spaces/space_chain.dart';
import 'package:kemlock_core/features/spaces/space_state.dart';

/// What the device does at first contact.
enum ContactKind {
  /// The device made the space: it is its own anchor.
  creator,

  /// The account's own current key signed or cosigned a record after it was admitted: nothing to compare.
  vouched,

  /// Compare [FirstContact.person]'s fingerprint.
  compare,

  /// The inviter or the confirmer is no longer a confirmed member: the person picks one of [FirstContact.candidates], the
  /// confirmed Owners, and the comparison follows as for [compare].
  pickOwner,
}

/// What [firstContact] found.
final class FirstContact {
  const FirstContact({
    required this.kind,
    this.person,
    this.bundle,
    this.admittedAt,
    this.bundleSigned = false,
    this.candidates = const [],
  });

  final ContactKind kind;

  /// The anchor person's account id, for [ContactKind.compare].
  final String? person;

  /// The anchor person's bundle as the verified chain records it at its head: its fingerprint is what the screen compares.
  final KeyBundle? bundle;

  /// The `seq` of the invite or the confirmation that admitted the account.
  final int? admittedAt;

  /// Whether [bundle] signed or cosigned a record at or after [admittedAt]. A comparison without it shows nothing about
  /// the chain, so the screen offers none.
  final bool bundleSigned;

  /// The confirmed Owners to pick from, for [ContactKind.pickOwner].
  final List<String> candidates;

  /// Whether the screen may offer a comparison.
  bool get canCompare => kind == ContactKind.compare && bundleSigned;

  /// The 64-byte fingerprint to compare, or null.
  Uint8List? get fingerprint => bundle?.fingerprint;

  /// Whether [shown], the 64-byte fingerprint [person]'s own app shows (or the QR code carries), is the one to accept on. It
  /// compares in constant time, and is false when there is nothing to compare.
  bool matches(List<int> shown) => canCompare && fingerprintsMatch(bundle!.fingerprint, shown);
}

/// Works out who [account]'s device compares at first contact in [state], the state [chain] derives. [chain] is the
/// verified chain, in order. Throws a [StateError] when the account isn't in the space.
FirstContact firstContact({required SpaceState state, required List<SignedChainEntry> chain, required String account}) {
  final me = state.member(account);
  if (me == null || !me.inSpace) {
    throw StateError('$account is not in the space');
  }
  if (chain.isNotEmpty && chain.first.entry.by == account && me.isConfirmed && me.confirmation == null && me.rekeySeq == null) {
    return const FirstContact(kind: ContactKind.creator);
  }
  final int admittedAt;
  final String person;
  if (me.status == MemberStatus.invited) {
    final invite = chain.lastWhere((signed) => signed.entry.kind == ChainKind.invite && signed.entry.body['member'] == account);
    admittedAt = invite.entry.seq;
    person = invite.entry.by;
  } else if (me.rekeySeq != null) {
    // Their own key cosigned a record after they were confirmed
    return const FirstContact(kind: ContactKind.vouched);
  } else {
    final confirmation = me.confirmation!;
    admittedAt = confirmation.seq;
    if (chain.any((signed) => signed.entry.by == account && signed.entry.seq > admittedAt)) {
      return const FirstContact(kind: ContactKind.vouched);
    }
    person = confirmation.by;
  }
  final anchor = state.member(person);
  if (anchor == null || !anchor.isConfirmed || anchor.bundle == null) {
    return FirstContact(
      kind: ContactKind.pickOwner,
      admittedAt: admittedAt,
      candidates: [
        for (final owner in state.confirmedMembers)
          if (owner.role == SpaceRole.owner && owner.id != account) owner.id,
      ],
    );
  }
  return _compare(chain, anchor, admittedAt);
}

/// The comparison with [person], once one is chosen (the inviter, the confirmer, or the Owner the person picked).
FirstContact compareWith({
  required SpaceState state,
  required List<SignedChainEntry> chain,
  required String person,
  required int admittedAt,
}) {
  final anchor = state.member(person);
  if (anchor == null || !anchor.isConfirmed || anchor.bundle == null) {
    throw StateError('$person is not a confirmed member');
  }
  return _compare(chain, anchor, admittedAt);
}

FirstContact _compare(List<SignedChainEntry> chain, SpaceMember anchor, int admittedAt) {
  // The records the anchor person's current bundle signed (or, for a rekey, cosigned) are those from its last change on
  final since = anchor.rekeySeq ?? (anchor.confirmation == null ? 0 : anchor.confirmation!.seq + 1);
  final from = admittedAt > since ? admittedAt : since;
  final signed = chain.any((record) => record.entry.by == anchor.id && record.entry.seq >= from);
  return FirstContact(kind: ContactKind.compare, person: anchor.id, bundle: anchor.bundle, admittedAt: admittedAt, bundleSigned: signed);
}

/// When the chain later confirms this account, the device checks that the `confirm` records its own bundle byte for
/// byte. False means another key was confirmed for the account than the one this device holds.
bool confirmRecordsOwnBundle(SpaceState state, String account, KeyBundle own) {
  final recorded = state.member(account)?.bundle;
  return recorded != null && constantTimeEquals(recorded.bytes, own.bytes);
}
