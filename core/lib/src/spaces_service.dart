// The person's shared spaces in the browser (docs/plans/add-spaces.md): the spaces on Kemlock Server, as the app's Spaces sheet
// lists and opens them, and the WebDAV spaces the vault joined. A space is one more scope of the sync run (`runAll`, called by
// `SyncService`) over Kemlock-core's engine (`KmSpaceSync`): the chain verified against this device's anchor, keys opened through
// the chain's commitments, the signed manifest checked, items merged and kept in the vault's lists with their `spaceId`.
//
// Nothing here trusts the server's word about people or keys. Who is in a space, their roles, grants and keys come from the
// verified chain (`SpaceState`), and every change a person makes is a record the chain's own authority check
// (`checkAction`) accepts, signed with the account's key and sent to the space's home alone.
//
// The account's keys are open for one request at a time (`SpacesHost.withAccount`, which wipes them when it returns), so
// nothing here keeps them. What the app keeps beside Kemlock-core (the listing, invitation, members, first-contact and fingerprint
// code of `mobile/lib/features/spaces`) is copied in `spaces/`, until the app moves it to Kemlock-core.
import 'package:http/http.dart' as http;
import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart' show uuidBytes;
import 'package:kemlock_core/crypto/bytes.dart' show b64;
import 'package:kemlock_core/features/spaces/server_spaces.dart';
import 'package:kemlock_core/features/spaces/space_actions.dart';
import 'package:kemlock_core/features/spaces/space_bridge.dart';
import 'package:kemlock_core/features/spaces/space_chain.dart';
import 'package:kemlock_core/features/spaces/space_chain_client.dart';
import 'package:kemlock_core/features/spaces/space_head_store.dart';
import 'package:kemlock_core/features/spaces/space_records.dart';
import 'package:kemlock_core/features/spaces/space_scope.dart';
import 'package:kemlock_core/features/spaces/space_state.dart';
import 'package:kemlock_core/features/spaces/space_verify.dart' show ChainAnchor;
import 'package:kemlock_core/features/sync/kemlock/km_account.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_cache.dart';
import 'package:kemlock_core/features/sync/kemlock/km_failover.dart' show KmHomeAway;
import 'package:kemlock_core/features/sync/kemlock/km_files.dart' show KmFileStore, KmFiles, kmServerFileId;
import 'package:kemlock_core/features/sync/kemlock/km_models.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sync.dart' show KmAnchors;
import 'package:kemlock_core/features/sync/removal_guard.dart' show RemovalChoice;
import 'package:kemlock_core/features/sync/sync.dart';
import 'package:kemlock_core/features/sync/sync_crypto.dart' show InviteError, SpaceInvite, decryptSyncFile, isSpaceId, openInvite;
import 'package:kemlock_core/features/sync/sync_merge.dart';
import 'package:kemlock_core/features/sync/sync_personal.dart';
import 'package:kemlock_core/features/sync/webdav.dart';
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_entry.dart';
import 'package:kemlock_core/models/vault_key.dart';
import 'package:kemlock_core/vault/item_links.dart' show entriesOf, linkIdOf, relinkedAfterMove;
import 'package:kemlock_core/vault/vault_store.dart' show VaultSession;

import 'failure.dart';
import 'item_extras.dart' show listsWithEntry;
import 'spaces/space_contact.dart';
import 'spaces/space_invites.dart';
import 'spaces/space_listing.dart';
import 'spaces/space_members.dart';
import 'vault_service.dart';

/// The storage key of a server space's cache, under the vault's own suffix (the app's key, so one vault opens in either).
String spaceCacheKey(String space) => 'backmycodes_kemlock_space_$space';

/// The anchors of the account's server spaces in [store], as a Kemlock Server run carries them: none when the vault holds none, so a
/// run with nothing to carry writes nothing (the app's `kmAnchorsOf`).
KmAnchors kmAnchorsOf(SpaceAnchorStorage store, VaultSession session) => KmAnchors(
  load: () async {
    final anchors = await store.load(session);
    return anchors.length == 0 && anchors.extra.isEmpty ? null : anchors.toJson();
  },
  save: (anchors) => store.save(SpaceAnchors.fromJson(anchors), session),
);

/// The name of the collection every new space starts with.
const everyoneName = 'Everyone';

/// What the sync service gives the spaces: the open account's session, the settings and the scope states it keeps.
abstract interface class SpacesHost {
  /// The Kemlock Server account the vault syncs with, or null.
  KemlockTarget? get kemlockTarget;

  /// The vault's sync settings (the WebDAV spaces are in them).
  SyncSettings get syncSettings;

  /// Keeps [next] as the sync settings.
  Future<void> saveSyncSettings(SyncSettings next);

  /// What each scope held after its last run, by scope id (the map is the service's own: change it, then [saveScopeStates]).
  Map<String, ScopeState> get scopeStates;

  Future<void> saveScopeStates();

  /// Runs [action] with a connection to the server in use and the open account, whose keys are wiped when it returns.
  Future<T> withAccount<T>(Future<T> Function(KmConnection connection, KmAccount account) action);

  /// The name of the home server while it can't be reached, or null.
  String? homeAway();

  /// The home server's address.
  Uri homeUrl();

  /// The account's public keys as the vault holds them, or null.
  Future<KeyBundle?> ownBundle();

  /// The anchors of the spaces' chains, on the device and carried by the vault's sync.
  SpaceAnchorStorage get anchors;

  /// The files waiting to go up, which a space's run uploads as the vault's own run does, or null when there are none to carry.
  KmFileStore? get fileStore;

  /// A client for the WebDAV spaces.
  http.Client clientFor();
}

/// What one server space tells about passwords: its verified chain, the account whose vault this is, and the collection of each
/// entry by the entry's own id (`HiddenPasswords` of the app).
class SpaceHold {
  const SpaceHold({required this.chain, required this.account, this.collections = const {}, this.compared = false});

  final SpaceState chain;
  final String account;
  final Map<String, String> collections;

  /// A fingerprint was compared for the space (first contact): until then it holds nothing here, so nothing is written to it.
  final bool compared;
}

/// A space's own item as the space page lists it.
typedef _Item = ({String id, String kind, String name});

class SpacesService {
  SpacesService(this._vault, this._host);

  final VaultService _vault;
  final SpacesHost _host;

  /// The chains this session verified, by the id the entries carry as their `spaceId`. Memory only: a locked core has none, so
  /// the logins of a space stay hidden until its chain is read again (fail closed).
  final Map<String, SpaceHold> _holds = {};

  /// The names the chains' commitments opened, and the last problem of each space's run.
  final Map<String, String> _names = {};
  final Map<String, String> _problems = {};
  List<Object?> _rows = const [];
  String? _listProblem;

  /// Forgets what the session knew.
  void unload() {
    _holds.clear();
    _names.clear();
    _problems.clear();
    _rows = const [];
    _listProblem = null;
  }

  int get _millis => _vault.nowMs;
  int get _seconds => _millis ~/ 1000;

  // ─── The engine for one space ───────────────────────────────────────

  Future<T> _run<T>(Future<T> Function(KmConnection connection, KmAccount account) action) {
    _vault.requireSession();
    if (_host.kemlockTarget == null) throw const CoreFailure(CoreFailure.invalid, 'no Kemlock Server account');
    return _wrap(() => _host.withAccount(action));
  }

  KmSpaceSync _sync(String space, KmConnection connection, KmAccount account) {
    final session = _vault.requireSession();
    final key = spaceCacheKey(space);
    final anchors = _host.anchors;
    return KmSpaceSync(
      connection: connection,
      server: connection.server,
      account: account,
      space: space,
      loadCache: () async => KmCache.fromJson(await _vault.vault.loadEncryptedValue(key, session)),
      saveCache: (cache) async {
        await _vault.vault.saveEncryptedValue(key, cache.toJson(), session);
        await _vault.store.flush();
      },
      // A file waiting to go up is sent once its item is in the space; the browser keeps no other, so none is fetched
      files: _host.fileStore == null
          ? null
          : KmFiles(store: _host.fileStore!, connection: connection, server: connection.server, fetchMissing: false),
      loadAnchor: (id) async => (await anchors.load(session)).of(id),
      loadCompared: (id) async => (await anchors.load(session)).hasCompared(id),
      saveAnchor: (id, anchor, {afterFence = false, compared = false}) async {
        await anchors.remember(id, anchor, session, afterFence: afterFence, compared: compared);
        await _vault.store.flush();
      },
      clock: () => DateTime.fromMillisecondsSinceEpoch(_millis),
      onChain: report,
      onComparedChain: reportCompared,
      homeDown: _host.homeAway,
      homeUrl: _host.homeUrl,
    );
  }

  /// Takes the chain a read or a run of [space] verified. [collections] is the collection of each entry when the run knows them;
  /// a read of the chain alone keeps the ones known, so a changed grant is followed at once.
  void report(String space, String account, SpaceState chain, {Map<String, String>? collections}) {
    // The collection of each entry is the run's, else the last one known, else what the scope state kept
    final known = _holds[space]?.collections ?? spaceCollectionsOf(_host.scopeStates[space]?.extra ?? const {});
    // A run reports its collections only once the space is compared (the engine opens nothing before); a bare read says nothing of it
    _holds[space] = SpaceHold(chain: chain, account: account, collections: collections ?? known, compared: collections != null);
  }

  /// Takes a chain whose fingerprint this device compared (`KmSpaceSync.onComparedChain`).
  void reportCompared(String space, String account, SpaceState chain, {Map<String, String>? collections}) {
    final known = _holds[space]?.collections ?? spaceCollectionsOf(_host.scopeStates[space]?.extra ?? const {});
    _holds[space] = SpaceHold(chain: chain, account: account, collections: collections ?? known, compared: true);
  }

  /// A failure of the engine as the failure the popup words (`space.*`): what a person can act on keeps its name.
  Future<T> _wrap<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on CoreFailure {
      rethrow;
    } on SpaceActionError catch (e) {
      throw CoreFailure('space_action_${e.problem.name}', e.detail ?? '');
    } on InviteLookupError catch (e) {
      throw CoreFailure('space_lookup_${e.problem.name}', '${e.retryAfter ?? ''}');
    } on ResendError catch (e) {
      throw CoreFailure('space_resend_${e.problem.name}', '${e.retryAfter ?? ''}');
    } on HeldItemError catch (e) {
      throw CoreFailure('space_held_${e.problem.name}', e.detail ?? '');
    } on SpaceSyncError catch (e) {
      throw CoreFailure('space_sync_${e.issue.name}', e.detail ?? '');
    } on ChainRefusal catch (e) {
      throw CoreFailure('space_sync_cantBeChecked', e.detail);
    } on KmHomeAway {
      throw CoreFailure('space_action_homeAway', _host.homeAway() ?? '');
    } on StateError catch (e) {
      throw CoreFailure('space_invalid', e.message);
    }
  }

  // ─── Reading the account's spaces ───────────────────────────────────

  Future<List<ListedSpace>> _listed(KmConnection connection) async {
    final raw = await connection.call((token) => connection.api.callValue('GET', connection.server, '/spaces', token: token));
    final seen = <String>{};
    return [
      for (final listed in parseSpaceList(raw))
        // A space the vault's own scopes use, or an id that isn't a UUID, is not one to list
        if (isServerSpaceId(listed.id) && seen.add(listed.id)) listed,
    ];
  }

  String _shortId(String id) => id.length <= 8 ? id : id.substring(0, 8);

  /// The name the chain's commitment opened for [id] (this session's, or the one its last run kept in its scope state), or null.
  String? _knownName(String id) {
    final name = _names[id] ?? _host.scopeStates[id]?.extra['name'];
    return name is String && name.isNotEmpty ? name : null;
  }

  /// The name an item's view gives its space: a WebDAV space's own, else the one known, else the start of the id.
  String _spaceName(String id) =>
      _host.syncSettings.spaces.where((space) => space.id == id).firstOrNull?.name ?? _knownName(id) ?? _shortId(id);

  /// The role and status a row shows for [account] in [state] (the app's `serverSpaceStatus`).
  String _status(SpaceState? state, String account, {required bool accepted, required bool compared}) {
    if (state == null) return 'cantBeChecked';
    final me = state.member(account);
    if (me == null || !me.inSpace) return 'removed';
    if (me.status == MemberStatus.invited) return accepted ? 'accepted' : 'invited';
    if (!compared) return 'compare';
    final replaces = me.role == SpaceRole.owner || me.role == SpaceRole.admin;
    if (replaces && state.keysNeedReplacing) return 'keysNeedReplacing';
    return me.role.wire;
  }

  int _itemCount(String space) {
    final lists = _vault.lists;
    int count<T extends VaultEntry<T>>(List<T> list) => list.where((entry) => entry.spaceId == space).length;
    return count(lists.accounts) +
        count(lists.backupServices) +
        count(lists.keys) +
        count(lists.notes) +
        count(lists.logins) +
        count(lists.cards) +
        count(lists.identities) +
        count(lists.files);
  }

  /// The WebDAV spaces of the settings, as rows. One that moved to Kemlock Server is the phone's to run: it is listed, not synced.
  List<Object?> _davRows() {
    final states = _host.scopeStates;
    return [
      for (final space in _host.syncSettings.spaces)
        {
          'id': space.id,
          'kind': 'webdav',
          'name': space.name,
          'status': space.movedToServer ? 'moved' : 'webdav',
          'compared': true,
          'items': _itemCount(space.id),
          'lastSync': ?states[space.id]?.lastSyncAt,
          'problem': ?_problems[space.id],
        },
    ];
  }

  /// The spaces of the account on its server, each with its chain verified, and the WebDAV ones. A server that can't be reached
  /// leaves the rows of the last listing, with the problem.
  Future<Map<String, Object?>> list({bool refresh = true}) async {
    final dav = _davRows();
    if (_host.kemlockTarget == null) return {'available': false, 'server': const <Object?>[], 'webdav': dav};
    try {
      if (!refresh) return {'available': true, 'server': _rows, 'webdav': dav, 'problem': ?_listProblem, 'homeAway': ?_host.homeAway()};
      final rows = await _run((connection, account) async {
        final rows = <Object?>[];
        final states = _host.scopeStates;
        for (final listed in await _listed(connection)) {
          final sync = _sync(listed.id, connection, account);
          SpaceState? state;
          String? name;
          var compared = false;
          try {
            state = await sync.chainState();
            compared = await sync.isCompared();
            final sealed = listed.sealedName;
            // Opening the name opens the space key, which waits for first contact
            if (sealed != null && compared) {
              try {
                name = await sync.openSpaceName(state, sealed);
              } catch (_) {
                // A name that can't be opened shows the start of the id; the list still loads
                name = null;
              }
            }
          } on SpaceSyncError {
            state = null;
          }
          if (name != null) _names[listed.id] = name;
          final me = state?.member(account.accountId);
          rows.add({
            'id': listed.id,
            'kind': 'server',
            'name': name ?? _knownName(listed.id) ?? _shortId(listed.id),
            'status': _status(state, account.accountId, accepted: listed.accepted, compared: compared),
            'compared': compared,
            if (me != null && me.inSpace) 'role': me.role.wire,
            if (state != null) 'members': state.members.values.where((member) => member.inSpace).length,
            'items': _itemCount(listed.id),
            'lastSync': ?states[listed.id]?.lastSyncAt,
            'problem': ?_problems[listed.id],
          });
        }
        return rows;
      });
      _rows = rows;
      _listProblem = null;
    } on CoreFailure {
      rethrow;
    } catch (error) {
      _listProblem = problemOf(error).name;
    }
    return {'available': true, 'server': _rows, 'webdav': dav, 'problem': ?_listProblem, 'homeAway': ?_host.homeAway()};
  }

  // ─── One space ──────────────────────────────────────────────────────

  /// [Access] of [member] to the collection of [entry] in [hold]'s chain; the entry's collection is the scope state's, else the
  /// first collection, where a new entry goes (`KmSpaceSync` plans the same).
  String? _collectionOf(SpaceHold hold, String entryId) => hold.collections[entryId] ?? hold.chain.collections.keys.firstOrNull;

  /// What this account may do with [entryId] of the server space [space]: null while the space's chain isn't verified.
  Access? _access(String space, String entryId) {
    final hold = _holds[space];
    // A space whose fingerprint wasn't compared, or one the account isn't confirmed in, gives it nothing
    if (hold == null || !hold.compared) return null;
    final me = hold.chain.member(hold.account);
    if (me == null || !me.isConfirmed) return null;
    final collection = _collectionOf(hold, entryId);
    return collection == null ? null : hold.chain.accessOf(hold.account, collection);
  }

  /// Whether [space] is a WebDAV space of the settings that has not moved: no roles, no grants, and every password open to whoever
  /// holds the key.
  bool _plainDav(String space) => _host.syncSettings.spaces.any((s) => s.id == space && !s.movedToServer);

  /// Whether the items of [space] (null or empty for the vault's own) have a server to hold their files: every one but a WebDAV space.
  bool carriesFiles(String? space) => space == null || space.isEmpty || !_plainDav(space);

  /// Refuses a change to an entry of [space] (null or empty for the vault's own) the chain doesn't let this account make:
  /// a view-only grant, a space not verified yet, a member no longer confirmed. The WebDAV spaces have no roles.
  void requireEdit(String? space, String entryId) {
    if (space == null || space.isEmpty || _plainDav(space)) return;
    if (_host.syncSettings.spaces.any((s) => s.id == space)) {
      throw const CoreFailure('space_readOnly', 'a space that moved to Kemlock Server');
    }
    final hold = _holds[space];
    if (hold == null) throw const CoreFailure('space_notChecked', 'the space has not been checked yet');
    if (!(_access(space, entryId)?.edit ?? false)) throw const CoreFailure('space_readOnly', 'a space where this account may not edit');
  }

  /// Whether the password of [login] is hidden from this account (the app's `HiddenPasswords.hides`): a login of a space whose
  /// chain isn't verified yet counts as hidden, unless it is a WebDAV space that has not moved.
  bool hides(String? space, String entryId) {
    if (space == null || space.isEmpty) return false;
    final hold = _holds[space];
    if (hold == null) return !_plainDav(space);
    if (!hold.compared) return true;
    final collection = hold.collections[entryId];
    if (collection != null) {
      final access = hold.chain.accessOf(hold.account, collection);
      return access == null || access.hidePasswords;
    }
    final mine = hold.chain.collectionsOf(hold.account);
    if (mine.isEmpty) return true;
    return mine.every((id) => hold.chain.accessOf(hold.account, id)?.hidePasswords ?? true);
  }

  /// The ids of the logins whose password is hidden from this account: what nothing may show, copy, export or send.
  List<String> hiddenLoginIds() => [
    for (final login in _vault.lists.logins)
      if (hides(login.spaceId, login.id)) login.id,
  ];

  /// The `space` of an item's view: where it is, whether this account may change it, and whether its password is hidden.
  Map<String, Object?>? note(String? space, String entryId, {bool login = false}) {
    if (space == null || space.isEmpty) return null;
    final dav = _plainDav(space);
    final canEdit = dav || (_access(space, entryId)?.edit ?? false);
    return {
      'id': space,
      'name': _spaceName(space),
      'canEdit': canEdit,
      if (login) 'passwordHidden': hides(space, entryId),
      if (!dav && _holds[space] != null) 'collection': ?_collectionOf(_holds[space]!, entryId),
    };
  }

  List<_Item> _itemsOf(String space) {
    final lists = _vault.lists;
    return [
      for (final login in lists.logins)
        if (login.spaceId == space) (id: login.id, kind: 'login', name: login.name),
      for (final account in lists.accounts)
        if (account.spaceId == space) (id: account.id, kind: 'code', name: account.issuer.isEmpty ? account.label : account.issuer),
      for (final service in lists.backupServices)
        if (service.spaceId == space) (id: service.id, kind: 'backupCodes', name: service.serviceName),
      for (final note in lists.notes)
        if (note.spaceId == space) (id: note.id, kind: 'note', name: note.title),
      for (final card in lists.cards)
        if (card.spaceId == space) (id: card.id, kind: 'card', name: card.name),
      for (final identity in lists.identities)
        if (identity.spaceId == space) (id: identity.id, kind: 'identity', name: identity.name),
      for (final key in lists.keys)
        if (key.spaceId == space) (id: key.id, kind: 'key', name: key.name),
      for (final file in lists.files)
        if (file.spaceId == space) (id: file.id, kind: 'file', name: file.name),
    ];
  }

  bool _allows(SpaceState state, ChainAction Function() make) {
    try {
      return checkAction(state, make().entry).problem == null;
    } catch (_) {
      return false;
    }
  }

  /// The row of [member] as the page shows it: the chain's status with what the server adds for an accepted invitation.
  String _memberStatus(SpaceMember member, {required bool accepted, required bool reconfirm}) {
    if (member.status == MemberStatus.removed) return 'removed';
    if (member.status == MemberStatus.invited) return accepted ? 'accepted' : 'invited';
    if (reconfirm) return 'reconfirm';
    return member.rekeySeq != null ? 'rekeyed' : 'confirmed';
  }

  /// A space as its page shows it. The chain is read and verified first; a space that doesn't verify throws `space.sync.cantBeChecked`.
  Future<Map<String, Object?>> space(String id) => _run((connection, account) async {
    _requireServerSpace(id);
    final sync = _sync(id, connection, account);
    final state = await sync.chainState();
    final compared = await sync.isCompared();
    final me = state.member(account.accountId);
    if (me == null || !me.inSpace) throw const CoreFailure('space_action_cantApply', 'not in the space');
    final listed = [
      for (final space in await _listed(connection))
        if (space.id == id) space,
    ];
    final accepted = listed.isNotEmpty && listed.first.accepted;
    var name = _knownName(id);
    final sealed = listed.isEmpty ? null : listed.first.sealedName;
    if (sealed != null && compared) {
      try {
        name = await sync.openSpaceName(state, sealed) ?? name;
      } catch (_) {
        // The id's start stands in for it
      }
    }
    if (name != null) _names[id] = name;
    // What the server tells of the members beside the chain: names, and the bundles an admin compares and confirms
    var members = const SpaceMembers();
    if (compared && me.isConfirmed) {
      try {
        members = await SpaceMembersClient(connection: connection, server: connection.server, space: id).read(state);
      } catch (_) {
        members = const SpaceMembers();
      }
    }
    String named(String member) => members.names[member] ?? _shortId(member);
    final homeAway = _host.homeAway();
    final confirmed = me.isConfirmed && compared;
    final canAct = confirmed && homeAway == null;
    final rows = <Object?>[];
    final order = state.members.values.where((member) => member.inSpace).toList()..sort((a, b) => a.id.compareTo(b.id));
    for (final member in order) {
      final you = member.id == account.accountId;
      final offer = members.offers[member.id];
      final reconfirm = members.reconfirm.contains(member.id);
      final roles = [
        for (final role in const [SpaceRole.owner, SpaceRole.admin, SpaceRole.member])
          if (canAct &&
              member.isConfirmed &&
              role != member.role &&
              !you &&
              _allows(
                state,
                () => ChainAction(
                  entry: buildRole(state: state, by: account.accountId, member: member.id, role: role, at: 0),
                ),
              ))
            role.wire,
      ];
      final manageable =
          canAct && !you && _allows(state, () => buildRemoveAction(state: state, by: account.accountId, member: member.id, at: 0));
      rows.add({
        'id': member.id,
        'name': named(member.id),
        'role': member.role.wire,
        'status': _memberStatus(member, accepted: offer != null, reconfirm: reconfirm),
        'you': you,
        'canRemove': manageable,
        'roles': roles,
        'canConfirm': manageable && offer != null && (member.status == MemberStatus.invited || (member.isConfirmed && reconfirm)),
        'canResend': manageable && member.status == MemberStatus.invited && offer == null,
        if (offer != null) 'digits': offer.bundle.fingerprintDigits,
      });
    }
    String? collectionAccess(String collection) {
      final access = state.accessOf(account.accountId, collection);
      if (access == null) return null;
      if (access.manage) return 'manage';
      return '${access.edit ? 'edit' : 'view'}${access.hidePasswords ? 'Hidden' : ''}';
    }

    bool mayGrant(String collection) =>
        me.isConfirmed &&
        (me.role == SpaceRole.owner || me.role == SpaceRole.admin || (state.accessOf(account.accountId, collection)?.manage ?? false));
    final collections = <Object?>[];
    for (final collection in (state.collections.keys.toList()..sort())) {
      final info = state.collections[collection]!;
      final grants = (state.grants[collection] ?? const <String, CollectionPermission>{}).entries.toList()
        ..sort((a, b) => a.key.compareTo(b.key));
      final granted = [for (final grant in grants) Grantee.parse(grant.key)];
      collections.add({
        'id': collection,
        'keyVersion': info.keyVersion,
        'marked': info.marked,
        'myAccess': ?collectionAccess(collection),
        'canGrant': canAct && mayGrant(collection),
        'grants': [
          for (final grant in grants)
            {
              'grantee': grant.key,
              'name': Grantee.parse(grant.key).isGroup ? '' : named(Grantee.parse(grant.key).id),
              'group': Grantee.parse(grant.key).isGroup,
              'permission': grant.value.wire,
            },
        ],
        'withoutGrant': [
          for (final member in order)
            if (!granted.contains(Grantee.user(member.id))) {'id': member.id, 'name': named(member.id)},
        ],
      });
    }
    final policies = state.policies;
    final master = policies['masterPassword'];
    final items = <Object?>[];
    for (final item in _itemsOf(id)) {
      final access = _access(id, item.id);
      final hold = _holds[id];
      items.add({
        'id': item.id,
        'kind': item.kind,
        'name': item.name,
        'canEdit': access?.edit ?? false,
        if (item.kind == 'login') 'passwordHidden': hides(id, item.id),
        'collection': ?(hold == null ? null : _collectionOf(hold, item.id)),
      });
    }
    final onlyOwner = me.isConfirmed && me.role == SpaceRole.owner && state.confirmedOwners == 1;
    return {
      'id': id,
      'name': name ?? _shortId(id),
      'status': _status(state, account.accountId, accepted: accepted, compared: compared),
      'compared': compared,
      'role': me.role.wire,
      'memberStatus': _memberStatus(me, accepted: accepted, reconfirm: false),
      'homeAway': ?homeAway,
      'members': rows,
      'collections': collections,
      'items': items,
      'policies': {
        'flags': [
          for (final flag in policies.keys)
            if (policies[flag] == true) flag,
        ]..sort(),
        if (master is Map<String, Object?> && master['minLength'] is int) 'minLength': master['minLength'],
      },
      'accountRecovery': policies['accountRecovery'] == true,
      'keys': {'spaceKeyVersion': state.spaceKeyVersion, 'needReplacing': state.keysNeedReplacing},
      'canInvite':
          canAct &&
          _allows(state, () => buildInviteAction(state: state, by: account.accountId, member: _probe, role: SpaceRole.member, at: 0)),
      'canLeave': confirmed && !onlyOwner,
      'onlyOwner': onlyOwner,
    };
  });

  /// An account id no member has, to ask the chain whether an invitation would be allowed at all.
  static const _probe = '00000000-0000-4000-8000-000000000001';

  void _requireServerSpace(String id) {
    if (!isServerSpaceId(id)) throw const CoreFailure(CoreFailure.invalid, 'not a space on Kemlock Server');
    if (_host.syncSettings.spaces.any((space) => space.movedToServer && serverSpaceUuidOrNull(space.id) == id)) {
      throw const CoreFailure('space_readOnly', 'a space that moved to Kemlock Server and is run by the phone');
    }
  }

  // ─── First contact ──────────────────────────────────────────────────

  /// What a person compares before a space holds anything here: the chain as verified, the inviter's (or confirmer's) fingerprint
  /// as it records it. Nothing is stored. [person] picks one of the Owners when the chain names no one to compare with.
  Future<Map<String, Object?>> contact(String id, {String? person}) => _run((connection, account) async {
    _requireServerSpace(id);
    final read = await _readContact(connection, account, id, person: person);
    final first = read.first;
    final state = read.state;
    String named(String member) => _shortId(member);
    final policies = state.policies;
    return {
      'id': id,
      'name': _knownName(id) ?? _shortId(id),
      'kind': first.kind.name,
      'invited': state.member(account.accountId)?.status == MemberStatus.invited,
      'person': ?first.person,
      'personName': ?(first.person == null ? null : named(first.person!)),
      'digits': ?first.bundle?.fingerprintDigits,
      'bundleSigned': first.bundleSigned,
      'candidates': [
        for (final candidate in first.candidates) {'id': candidate, 'name': named(candidate)},
      ],
      'ownKeyMismatch': read.ownKeyMismatch,
      'members': state.members.values.where((member) => member.inSpace).length,
      'accountRecovery': policies['accountRecovery'] == true,
    };
  });

  Future<({SpaceState state, FirstContact first, ChainAnchor? anchor, bool ownKeyMismatch})> _readContact(
    KmConnection connection,
    KmAccount account,
    String id, {
    String? person,
  }) async {
    final sync = _sync(id, connection, account);
    final contact = await sync.chainForContact();
    final state = contact.state;
    final me = state.member(account.accountId);
    if (me == null || !me.inSpace) throw const CoreFailure('space_action_cantApply', 'not in the space');
    final FirstContact first;
    if (person != null) {
      first = compareWith(
        state: state,
        chain: contact.records,
        person: person,
        admittedAt: firstContact(state: state, chain: contact.records, account: account.accountId).admittedAt ?? 0,
      );
    } else {
      first = firstContact(state: state, chain: contact.records, account: account.accountId);
    }
    // The creator on another device, and an account whose own key signed after it was confirmed, have nothing to compare, but only
    // if the chain records the key this device holds: a chain a server made up could name the account with its own
    var ownKeyMismatch = false;
    if (first.kind == ContactKind.creator || first.kind == ContactKind.vouched) {
      final own = await _host.ownBundle();
      ownKeyMismatch = own == null || !confirmRecordsOwnBundle(state, account.accountId, own);
    }
    return (state: state, first: first, anchor: contact.anchor, ownKeyMismatch: ownKeyMismatch);
  }

  /// The digits matched (or there was nothing to compare): stores the space's anchor as compared. [digits] is what the screen
  /// showed, and must still be the fingerprint of the key the chain records now, so a key the server changed meanwhile is never
  /// trusted for what was compared.
  Future<void> trust(String id, {String? person, String? digits}) => _run((connection, account) async {
    _requireServerSpace(id);
    final read = await _readContact(connection, account, id, person: person);
    final first = read.first;
    final anchor = read.anchor;
    if (anchor == null) throw const CoreFailure('space_invalid', 'the chain gives no anchor');
    switch (first.kind) {
      case ContactKind.creator || ContactKind.vouched:
        if (read.ownKeyMismatch) throw const CoreFailure('space_ownKey', 'the chain records another key for this account');
      case ContactKind.compare:
        final bundle = first.bundle;
        if (!first.canCompare || bundle == null || digits == null || bundle.fingerprintDigits != digits) {
          throw const CoreFailure('space_mismatch', 'the fingerprint is not the one that was compared');
        }
      case ContactKind.pickOwner:
        throw const CoreFailure('space_invalid', 'an Owner to compare with has to be picked first');
    }
    await _sync(id, connection, account).rememberAnchor(anchor);
  });

  /// Accepts or declines the invitation to [id]. Accepting waits for first contact: nothing is accepted from a chain no one compared.
  Future<void> answer(String id, {required bool accept}) => _run((connection, account) async {
    _requireServerSpace(id);
    final sync = _sync(id, connection, account);
    if (accept && !await sync.isCompared()) {
      throw const CoreFailure('space_notCompared', 'compare the fingerprint first');
    }
    await SpaceInviteClient(connection: connection, server: connection.server, space: id).answer(accept: accept);
  });

  // ─── What a member does ─────────────────────────────────────────────

  Future<void> _act(String id, Future<void> Function(SpaceActions actions, KmAccount account, KmConnection connection) action) =>
      _run((connection, account) async {
        _requireServerSpace(id);
        final sync = _sync(id, connection, account);
        if (!await sync.isCompared()) throw const CoreFailure('space_notCompared', 'compare the fingerprint first');
        await action(sync.actions(), account, connection);
      });

  /// Makes a space named [name], with "Everyone". The maker knows its own chain: first contact is done once the chain begins with the
  /// record this device signed.
  Future<String> make(String name) => _run((connection, account) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty || trimmed.length > 120) throw const CoreFailure(CoreFailure.invalid, 'a space needs a name');
    final space = newUuid();
    final sync = _sync(space, connection, account);
    // The `create` is a chain record: it goes to the home alone
    sync.requireHome();
    final bundle = KeyBundle(
      accountId: uuidBytes(account.accountId),
      keyVersion: account.keyVersion,
      kx1PublicKey: account.kx1PublicKey,
      sig1PublicKey: account.sig1PublicKey,
    );
    final built = await buildCreateSpace(
      account: account.accountId,
      bundle: bundle,
      bundleSignature: await signBundle(bundle, account.sig1PrivateKey),
      space: space,
      collection: newUuid(),
      name: trimmed,
      collectionName: everyoneName,
      at: _seconds,
    );
    final SignedChainEntry signed;
    try {
      signed = await signChainEntry(built.action.entry, account.sig1PrivateKey);
      await SpaceChainClient(connection: connection, server: connection.server, space: space).append(built.action.request(signed));
    } finally {
      built.spaceKey.fillRange(0, built.spaceKey.length, 0);
      built.collectionKey.fillRange(0, built.collectionKey.length, 0);
    }
    await sync.rememberCreated(signed);
    _names[space] = trimmed;
    return space;
  });

  /// Leaves the space, and takes its items, state and anchor off this browser.
  Future<void> leave(String id) async {
    await _act(id, (actions, account, connection) async {
      final state = await actions.readChain();
      final me = state.member(account.accountId);
      if (me != null && me.isConfirmed && me.role == SpaceRole.owner && state.confirmedOwners == 1) {
        throw const CoreFailure('space_onlyOwner', 'make another member an Owner first');
      }
      await actions.leave();
    });
    await _forget(id);
  }

  /// The space's entries of every kind, its state, its cache and its anchor go; the vault's own and other spaces' stay.
  Future<void> _forget(String id) async {
    final session = _vault.requireSession();
    await _vault.applyReshaped((held) => applyScope(held, id, const Lists()));
    _host.scopeStates.remove(id);
    await _host.saveScopeStates();
    _vault.vault.removeEncryptedValue(spaceCacheKey(id));
    final held = await _host.anchors.load(session);
    await _host.anchors.save(held.forgetting(id), session);
    await _vault.store.flush();
    _holds.remove(id);
    _problems.remove(id);
    _rows = [
      for (final row in _rows)
        if (row is Map<String, Object?> && row['id'] != id) row,
    ];
  }

  /// Invites the account that has [email] as [role]. The lookup's answer is checked (its bundle's signature); an invitation
  /// grants and seals nothing, and "Everyone" goes with it as the first collection of a space nobody configures.
  Future<void> invite(String id, String email, String role) => _act(id, (actions, account, connection) async {
    final wanted = SpaceRole.fromWire(role);
    if (wanted == null || wanted == SpaceRole.custom) throw const CoreFailure(CoreFailure.invalid, 'a role of owner, admin or member');
    final found = await SpaceInviteClient(connection: connection, server: connection.server, space: id).lookup(email.trim());
    if (found == null) throw const CoreFailure('space_lookup_none');
    final state = await actions.readChain();
    final grants = {for (final collection in state.collections.keys.take(1)) collection: CollectionPermission.edit};
    await actions.invite(found.account, wanted, grants: grants);
  });

  Future<void> resend(String id, String member) => _act(id, (actions, account, connection) async {
    await SpaceInviteClient(connection: connection, server: connection.server, space: id).resend(member);
  });

  /// Confirms [member] over exactly the bundle whose digits ([digits]) the person compared, then seals the keys they are entitled to.
  Future<void> confirm(String id, String member, String digits) => _act(id, (actions, account, connection) async {
    final state = await actions.readChain();
    final offers = await SpaceMembersClient(connection: connection, server: connection.server, space: id).read(state);
    final offer = offers.offers[member];
    if (offer == null) throw const CoreFailure('space_invalid', 'this member has nothing to confirm');
    if (offer.bundle.fingerprintDigits != digits) {
      throw const CoreFailure('space_mismatch', 'the fingerprint is not the one that was compared');
    }
    await actions.confirm(
      member: member,
      bundle: offer.bundle,
      bundleSignature: offer.bundleSignature,
      confirmerSig1PrivateKey: account.sig1PrivateKey,
    );
  });

  Future<void> setRole(String id, String member, String role) => _act(id, (actions, account, connection) async {
    final wanted = SpaceRole.fromWire(role);
    if (wanted == null || wanted == SpaceRole.custom) throw const CoreFailure(CoreFailure.invalid, 'a role of owner, admin or member');
    await actions.setRole(member, wanted);
  });

  /// Removes a member, or revokes an invitation. The keys it marks wait for a replacement (the page says so).
  Future<void> remove(String id, String member) => _act(id, (actions, account, connection) async {
    if (member == account.accountId) throw const CoreFailure(CoreFailure.invalid, 'leave the space instead');
    await actions.remove(member);
  });

  /// Gives [member] [permission] on [collection], or takes the grant away when it is null.
  Future<void> grant(String id, String collection, String member, String? permission) => _act(id, (actions, account, connection) async {
    final grantee = Grantee.user(member);
    if (permission == null) {
      await actions.ungrant(collection, grantee);
      return;
    }
    final wanted = CollectionPermission.values.where((p) => p.wire == permission).firstOrNull;
    if (wanted == null) throw const CoreFailure(CoreFailure.invalid, 'no such permission');
    await actions.grant(collection, grantee, wanted);
  });

  // ─── Held items ─────────────────────────────────────────────────────

  Future<List<Object?>> held(String id) => _run((connection, account) async {
    _requireServerSpace(id);
    final found = await _sync(id, connection, account).heldItems(now: _millis);
    return [
      for (final item in found) {'id': item.id, 'kind': item.kind, 'name': item.name ?? '', 'canKeep': item.canKeep},
    ];
  });

  Future<void> keepHeld(String id, String item) => _run((connection, account) async {
    _requireServerSpace(id);
    await _sync(id, connection, account).keepHeld(item, now: _millis);
  });

  Future<void> deleteHeld(String id, String item) async {
    // Looked for before the server deletes it: a space sync that follows takes the entry away, and then nothing says what names it
    final entry = _heldEntry(id, item);
    await _run((connection, account) async {
      _requireServerSpace(id);
      await _sync(id, connection, account).deleteHeld(item, now: _millis);
    });
    await _dropLinksToHeld(id, item, entry);
  }

  /// The entry of [space] this device holds for the held item [item], by its id or its item id; null when it holds none.
  VaultEntry<Object?>? _heldEntry(String space, String item) {
    final owner = _vault.accountOwner?.call();
    final wanted = item.toLowerCase();
    bool named(VaultEntry<Object?> entry) =>
        entry.spaceId == space && (entry.id.toLowerCase() == wanted || linkIdOf(entry, account: owner).toLowerCase() == wanted);
    return entriesOf(_vault.lists).where(named).firstOrNull;
  }

  /// Takes the links to the held item [item] of [space], which the server has just deleted, off the entries that named it. [entry] is the
  /// copy this device held, which says every id that names it; without one the item's own id is all there is, and a stand-in with that id
  /// finds the `links` that name it (not a login's `accountId`, which needs the kind). The entries are saved apart from the delete, which
  /// is the server's: a link that can't be taken off (an end this account may not edit, or a write that fails, even one that leaves
  /// storage in part written) stays one-way, since the item is gone and nothing mends a link to it, and the delete must not fail for it:
  /// it is done on the server, and a retry would be refused as no longer held.
  Future<void> _dropLinksToHeld(String space, String item, VaultEntry<Object?>? entry) async {
    final gone = entry ?? SecureNote(id: item.toLowerCase(), title: '', addedAt: _millis).inSpace(space);
    try {
      await _vault.saveChanged((lists) => _vault.withLinksDroppedTo(lists, gone));
    } catch (_) {
      // Left as it is: see above
    }
  }

  /// This account's own fingerprint, 12 groups of 5 digits, for the other side's comparison; null without an opened account.
  Future<String?> ownFingerprint() async => (await _host.ownBundle())?.fingerprintDigits;

  // ─── Moving items ───────────────────────────────────────────────────

  /// Puts the entry [id] of [kind] in the space [space] (null: the vault's own), in [collection] when it is a server space's.
  /// Needs edit where the entry is, and where it goes.
  Future<void> moveItem(String kind, String id, String? space, {String? collection}) async {
    _vault.requireSession();
    final target = space == null || space.isEmpty ? null : space;
    // Where the entry is now, and how it moves: the move is made on the lists the write holds once it has the lock, never on a copy
    // read before the waits below
    final lists = _vault.lists;
    final ({String? space})? Function(Lists) find;
    final Lists Function(Lists) move;
    switch (kind) {
      case 'login':
        find = (l) => _spaceOf(l.logins, id);
        move = (l) => _with(l, logins: [for (final e in l.logins) e.id == id ? e.inSpace(target) : e]);
      case 'code':
        find = (l) => _spaceOf(l.accounts, id);
        move = (l) => _with(l, accounts: [for (final e in l.accounts) e.id == id ? e.inSpace(target) : e]);
      case 'backupCodes':
        find = (l) => _spaceOf(l.backupServices, id);
        move = (l) => _with(l, backupServices: [for (final e in l.backupServices) e.id == id ? e.inSpace(target) : e]);
      case 'note':
        find = (l) => _spaceOf(l.notes, id);
        move = (l) => _with(l, notes: [for (final e in l.notes) e.id == id ? e.inSpace(target) : e]);
      case 'card':
        find = (l) => _spaceOf(l.cards, id);
        move = (l) => _with(l, cards: [for (final e in l.cards) e.id == id ? e.inSpace(target) : e]);
      case 'identity':
        find = (l) => _spaceOf(l.identities, id);
        move = (l) => _with(l, identities: [for (final e in l.identities) e.id == id ? e.inSpace(target) : e]);
      case 'key':
        find = (l) => _spaceOf(l.keys, id);
        move = (l) => _with(l, keys: [for (final e in l.keys) e.id == id ? e.inSpace(target) : e]);
      default:
        throw const CoreFailure(CoreFailure.invalid, 'this kind of item has no space');
    }
    final String? from = (find(lists) ?? _missing<({String? space})>()).space;
    if ((from ?? '') == (target ?? '')) return;
    // The server keeps a file under one item's id, and the browser holds no file's bytes to send again under the new owner's: a note
    // with files on the server stays where it is (the app moves such a note, which sends them again)
    if (kind == 'note' && lists.notes.any((note) => note.id == id && note.files.any((file) => kmServerFileId(file) != null))) {
      throw const CoreFailure(CoreFailure.unavailable, 'a note with files on the server can not move to another owner here');
    }
    // A login whose password a grant hides stays where it is: moving it to the vault, or to a space that doesn't hide it, would show it
    if (kind == 'login' && hides(from, id)) throw const CoreFailure('space_hidden', 'a login whose password is hidden');
    // Taking an entry out of a space is a write there, and so is putting one in
    requireEdit(from, id);
    if (target != null) {
      if (_plainDav(target)) {
        if (collection != null) throw const CoreFailure(CoreFailure.invalid, 'a WebDAV space has no collections');
      } else {
        if (_host.syncSettings.spaces.any((s) => s.id == target)) {
          throw const CoreFailure('space_readOnly', 'a space that moved to Kemlock Server');
        }
        final hold = _holds[target];
        if (hold == null) throw const CoreFailure('space_notChecked', 'the space has not been checked yet');
        final chosen = collection ?? hold.chain.collections.keys.firstOrNull;
        final info = chosen == null ? null : hold.chain.collections[chosen];
        if (chosen == null || info == null) throw const CoreFailure(CoreFailure.invalid, 'no such collection');
        // The account must be confirmed in a space it compared: an invited or uncompared one holds nothing here, and wipes what is put in
        final me = hold.chain.member(hold.account);
        if (!hold.compared || me == null || !me.isConfirmed) {
          throw const CoreFailure('space_notChecked', 'the space is not one this account is confirmed in');
        }
        if (!(hold.chain.accessOf(hold.account, chosen)?.edit ?? false)) {
          throw const CoreFailure('space_readOnly', 'a collection where this account may not edit');
        }
        final held = _host.scopeStates[target] ?? const ScopeState(known: []);
        _host.scopeStates[target] = ScopeState(
          known: held.known,
          lastSyncAt: held.lastSyncAt,
          extra: withSpaceCollections(held.extra, {...spaceCollectionsOf(held.extra), id: chosen}),
        );
        await _host.saveScopeStates();
      }
    }
    await _vault.saveChanged((held) {
      // The entry may have gone, or moved, while the waits above went on: then there is nothing to move, and nothing is written
      final now = find(held);
      if (now == null) throw const CoreFailure(CoreFailure.notFound, 'no such item');
      if ((now.space ?? '') != (from ?? '')) throw const CoreFailure(CoreFailure.stale, 'the item is not where it was');
      return _relinkedAfterMove(held, move(held), id, from, target);
    });
  }

  /// [moved], the lists with the entry [id] moved from [from] to [to], with the other entries that linked to it by its old item id now
  /// linking by the new one: an entry whose id isn't a UUID is given another item id by its new owner (`relinkedAfterMove`), and an
  /// entry with a UUID id keeps its own, so nothing changes for it. An entry that links to it from a space this account may not edit
  /// is left as it is, since the move must not fail for it: that link then names an item id nothing holds, shown as not available.
  Lists _relinkedAfterMove(Lists before, Lists moved, String id, String? from, String? to) {
    final owner = _vault.accountOwner?.call();
    VaultEntry<Object?>? entryIn(Lists lists, String? space) =>
        entriesOf(lists).where((entry) => entry.id == id && (entry.spaceId ?? '') == (space ?? '')).firstOrNull;
    final was = entryIn(before, from);
    final now = entryIn(moved, to);
    if (was == null || now == null) return moved;
    final changed = relinkedAfterMove(
      moved,
      oldLinkId: linkIdOf(was, account: owner),
      newLinkId: linkIdOf(now, account: owner),
      now: _millis,
    );
    var next = moved;
    for (final other in changed) {
      try {
        requireEdit(other.spaceId, other.id);
      } on CoreFailure {
        continue;
      }
      next = listsWithEntry(next, other);
    }
    return next;
  }

  ({String? space})? _spaceOf<T extends VaultEntry<T>>(List<T> list, String id) {
    for (final entry in list) {
      if (entry.id == id) return (space: entry.spaceId);
    }
    return null;
  }

  T _missing<T>() => throw const CoreFailure(CoreFailure.notFound, 'no such item');

  Lists _with(
    Lists l, {
    List<OtpAccount>? accounts,
    List<BackupService>? backupServices,
    List<VaultKey>? keys,
    List<SecureNote>? notes,
    List<Login>? logins,
    List<PaymentCard>? cards,
    List<Identity>? identities,
  }) => Lists(
    accounts: accounts ?? l.accounts,
    backupServices: backupServices ?? l.backupServices,
    keys: keys ?? l.keys,
    notes: notes ?? l.notes,
    passkeys: l.passkeys,
    keyAccounts: l.keyAccounts,
    contacts: l.contacts,
    logins: logins ?? l.logins,
    cards: cards ?? l.cards,
    identities: identities ?? l.identities,
    files: l.files,
  );

  // ─── WebDAV spaces ──────────────────────────────────────────────────

  /// Joins the WebDAV space an invite (`bmc-space:…`) and its one-time code open, in the folder [dav] names. The file must be there
  /// and open with the invite's key.
  Future<Map<String, Object?>> joinDav(Map<String, Object?> input) async {
    _vault.requireSession();
    final text = input['invite'];
    final code = input['code'];
    final folder = input['folder'];
    if (text is! String || code is! String || folder is! String) {
      throw const CoreFailure(CoreFailure.invalid, 'an invite, its code and a folder');
    }
    final url = Uri.tryParse(folder.trim());
    if (url == null || url.scheme != 'https' || url.host.isEmpty) {
      throw CoreFailure('space_dav_${url != null && url.scheme == 'http' ? 'insecure' : 'folder'}');
    }
    final dav = DavAccount(
      url: folder.trim(),
      username: (input['username'] as String?) ?? '',
      password: (input['password'] as String?) ?? '',
    );
    final SpaceInvite invite;
    try {
      invite = await openInvite(text, code);
    } on InviteError catch (e) {
      throw CoreFailure('space_dav_invite_${e.problem.name}');
    }
    if (!isSpaceId(invite.id)) throw const CoreFailure('space_dav_invite_format');
    final settings = _host.syncSettings;
    if (settings.spaces.any((space) => space.id == invite.id)) throw const CoreFailure('space_dav_joined');
    final client = _host.clientFor();
    try {
      final file = await WebDav(client).readFile(dav, invite.file);
      if (file == null) throw const CoreFailure('space_dav_noFile');
      // The file proves the key: a wrong one throws here, and nothing is stored
      await decryptSyncFile(file.text, invite.key);
    } on CoreFailure {
      rethrow;
    } catch (error) {
      throw CoreFailure('space_dav_${problemOf(error).name}');
    } finally {
      client.close();
    }
    final space = Space(
      id: invite.id,
      name: invite.name,
      target: SyncTarget(dav: dav, file: invite.file, key: b64(invite.key)),
      joinedAt: _millis,
    );
    await _host.saveSyncSettings(settings.copyWith(spaces: [...settings.spaces, space]));
    return {'id': space.id, 'name': space.name};
  }

  /// Leaves a WebDAV space: its entries of every kind go from this browser, and its place and state with them.
  Future<void> leaveDav(String id) async {
    _vault.requireSession();
    final settings = _host.syncSettings;
    final space = settings.spaces.where((s) => s.id == id).firstOrNull;
    if (space == null) throw const CoreFailure(CoreFailure.notFound, 'no such space');
    if (space.movedToServer) throw const CoreFailure('space_readOnly', 'a space that moved to Kemlock Server and is run by the phone');
    await _vault.applyReshaped((held) => applyScope(held, id, const Lists()));
    await _host.saveSyncSettings(
      settings.copyWith(
        spaces: [
          for (final s in settings.spaces)
            if (s.id != id) s,
        ],
      ),
    );
    _host.scopeStates.remove(id);
    await _host.saveScopeStates();
    _problems.remove(id);
  }

  // ─── The sync run ───────────────────────────────────────────────────

  /// Syncs every space once, after the vault's own scope: the account's confirmed spaces on Kemlock Server, then the WebDAV ones. A
  /// space that fails shows its problem on its row and leaves the others going. Answers true when the person changed something
  /// meanwhile, so the run is made again.
  Future<bool> runAll({RemovalChoice? choice}) async {
    final settings = _host.syncSettings;
    final target = settings.kemlock;
    final davSpaces = [
      for (final space in settings.spaces)
        if (isSpaceId(space.id) && !space.movedToServer) space,
    ];
    if (target == null && davSpaces.isEmpty) return false;
    final revision = _vault.revision;
    final session = _vault.session;
    var lists = _vault.lists;
    // What the run learns is kept on a copy, and written to the host only once the run is known to be current: an edit made meanwhile
    // would otherwise leave a `known` that lists items never applied, and the next run would delete them for everyone
    final states = {..._host.scopeStates};
    final learned = <String>{};
    final now = _millis;
    final problems = <String, String?>{};

    Future<void> scope(
      String key,
      Future<({SyncDoc doc, List<String> known, Map<String, Object?> state, int skipped})> Function(Lists, ScopeState) sync,
    ) async {
      try {
        final result = await sync(scopeLists(lists, key), states[key] ?? const ScopeState(known: []));
        // What the document holds under the id of an entry kept in another scope stays out of this one, and out of what it held
        final keptOut = heldElsewhere(lists, key, result.doc);
        lists = applyScope(lists, key, result.doc);
        final known = keptOut.isEmpty ? result.known : [...result.known.where((id) => !keptOut.contains(id))];
        states[key] = ScopeState(known: known, lastSyncAt: now, extra: result.state);
        learned.add(key);
        problems[key] = null;
      } catch (error) {
        problems[key] = problemOf(error).name;
      }
    }

    if (target != null) {
      List<ListedSpace>? listed;
      try {
        listed = await _host.withAccount((connection, account) => _listed(connection));
        _listProblem = null;
      } catch (error) {
        _listProblem = problemOf(error).name;
      }
      if (listed != null) {
        // A space that moved from WebDAV is the phone's: its entries here carry the WebDAV id, and the server space is never run
        final moved = {
          for (final space in settings.spaces)
            if (space.movedToServer) ?serverSpaceUuidOrNull(space.id),
        };
        for (final space in listed) {
          if (moved.contains(space.id)) continue;
          // A space this vault synced before, which the server no longer lists as confirmed, is run too: its chain says whether the
          // account is still in it, and an account that is no longer takes its items off
          if (space.state != 'confirmed' && !states.containsKey(space.id)) continue;
          await scope(space.id, (local, state) async {
            // Not through [_wrap]: what the run throws is what the space's problem is named from
            final result = await _host.withAccount((connection, account) async {
              final syncer = _sync(space.id, connection, account);
              final run = await syncer.sync(local, state, now: now, choice: choice);
              // The name the chain's commitment opens is kept with the space's state, for the badges of its items
              var name = _knownName(space.id);
              final sealed = space.sealedName;
              if (run.confirmed && sealed != null) {
                try {
                  name = await syncer.openSpaceName(run.chain, sealed) ?? name;
                } catch (_) {
                  // The name stays as it was
                }
              }
              if (name != null) _names[space.id] = name;
              final kept = takeBridgeSignal(run.state).state;
              return (doc: run.doc, known: run.known, state: {...kept, 'name': ?name}, skipped: run.skipped);
            });
            return result;
          });
        }
      }
    }
    if (davSpaces.isNotEmpty) {
      final client = _host.clientFor();
      try {
        final dav = WebDav(client);
        for (final space in davSpaces) {
          await scope(space.id, (local, state) async {
            final run = await runWebDavScope(webDav: dav, target: space.target, local: local, state: state, now: now);
            return (doc: run.doc, known: run.known, state: run.state, skipped: 0);
          });
        }
      } finally {
        client.close();
      }
    }
    if (!identical(session, _vault.session)) return false;
    // The person changed something meanwhile: what the run read is out of date, and a new run merges that in
    if (_vault.revision != revision) return true;
    // The vault's write lock checks the revision again once this has its turn: a save ahead of it makes the run out of date too
    if (!sameLists(lists, _vault.lists) && !await _vault.applySynced(lists, ifRevision: revision)) return true;
    for (final MapEntry(:key, :value) in problems.entries) {
      if (value == null) {
        _problems.remove(key);
      } else {
        _problems[key] = value;
      }
    }
    for (final key in learned) {
      _host.scopeStates[key] = states[key]!;
    }
    await _host.saveScopeStates();
    return false;
  }
}
