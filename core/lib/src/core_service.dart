// The core as the TypeScript side calls it: one method name and a list of JSON arguments in, a JSON value out (js/bridge.dart
// carries them over the wire). Each method is a `CoreApi` method of src/shared/api.ts, with its arguments in order.
import 'dart:typed_data';

import 'package:kemlock_core/crypto/account/encoding.dart' show MalformedException, Owner;
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/models/json.dart' show asInt;

import 'account/account_service.dart';
import 'browser.dart';
import 'custom_fields.dart';
import 'failure.dart';
import 'generate.dart';
import 'health.dart';
import 'item_extras.dart';
import 'item_files.dart';
import 'keys_service.dart';
import 'matching.dart';
import 'passkey_service.dart';
import 'platform.dart';
import 'sends.dart';
import 'sync_service.dart';
import 'tools_service.dart';
import 'transfer_service.dart';
import 'vault_service.dart';

/// Opens the vault's storage and answers calls.
class CoreService {
  CoreService._(this.vault)
    : sync = SyncService(vault),
      keys = KeysService(vault),
      passkeys = PasskeyService(vault),
      transfer = TransferService(vault) {
    // Spaces: a change to an entry of one is checked against the verified chain, and an item's view says where it is
    vault.editGuard = sync.spaces.requireEdit;
    vault.spaceNote = (space, id, {login = false}) => sync.spaces.note(space, id, login: login);
    vault.passwordHides = sync.spaces.hides;
    // A link names an entry whose id isn't a UUID by the Kemlock Server account's own
    vault.accountOwner = () {
      final target = sync.kemlockTarget;
      if (target == null) return null;
      try {
        return Owner.user(target.accountId);
      } on MalformedException {
        return null;
      }
    };
    sends = SendsApi(vault, sync);
    tools = ToolsService(vault, sync);
    itemFiles = ItemFiles(vault, sync);
    customFields = CustomFieldDefs(sync);
    // A file that never went up is taken out before a run, and the admin's fields are read again after one
    sync.beforeRun = itemFiles.settle;
    sync.afterRun = customFields.invalidate;
  }

  static Future<CoreService> start(CorePlatform platform, CoreData data) async => CoreService._(await VaultService.start(platform, data));

  final VaultService vault;
  final SyncService sync;
  final PasskeyService passkeys;

  /// Sends (sends.dart), which need the sync's Kemlock Server.
  late final SendsApi sends;

  /// Files of File items and notes (item_files.dart), which need the sync's Kemlock Server.
  late final ItemFiles itemFiles;

  /// The custom fields an admin offers (custom_fields.dart).
  late final CustomFieldDefs customFields;

  /// The vault's keys, contacts and the PGP tools (docs/plans/add-keys.md).
  final KeysService keys;

  /// Tags, order, backup codes, duplicates and breach checks (docs/plans/add-vault-tools.md).
  late final ToolsService tools;

  /// Import and export (transfer_service.dart).
  final TransferService transfer;

  /// The account's own calls (account/account_service.dart).
  late final AccountService account = AccountService(sync, vault);

  /// The methods the TypeScript `CoreApi` has, by name.
  static const methods = {
    'state',
    'createVault',
    'unlock',
    'lock',
    'removeVault',
    'exportSession',
    'restoreSession',
    'codes',
    'liveCodes',
    'nextHotp',
    'logins',
    'revealLogin',
    'saveLogin',
    'deleteLogin',
    'ignoreHealth',
    'backupCodes',
    'useBackupCode',
    'addCode',
    'previewCode',
    'readQr',
    'linkCode',
    'match',
    'generate',
    'health',
    'syncStatus',
    'signInKemlock',
    'signInKemlockSso',
    'signInKemlockPasskey',
    'signInWebdav',
    'signInVaultwarden',
    'answerStep',
    'syncNow',
    'confirmRemovals',
    'keepRemovals',
    'signOut',
    'settings',
    'saveSettings',
    'recentPasswords',
    'addRecentPassword',
    'rememberPick',
    'picks',
    'pickedHosts',
    'forgetPick',
    'checkServer',
    'securityKeyChallenge',
    'passkeyUnlockInfo',
    'passkeyUnlockPrepare',
    'addPasskeyUnlock',
    'renamePasskeyUnlock',
    'removePasskeyUnlock',
    'unlockWithPasskey',
    // Added by spaces
    'spaces',
    'space',
    'spaceContact',
    'spaceTrust',
    'spaceAnswer',
    'spaceMake',
    'spaceLeave',
    'spaceInvite',
    'spaceResend',
    'spaceConfirm',
    'spaceRole',
    'spaceRemove',
    'spaceGrant',
    'spaceHeld',
    'spaceKeepHeld',
    'spaceDeleteHeld',
    'ownFingerprint',
    'moveItem',
    'hiddenLoginIds',
    'joinDavSpace',
    'leaveDavSpace',
    'syncSpaces',
    // End of added by spaces
    // Added by sends
    ...sendsMethods,
    ...keysMethods,
    ...ToolsService.methods,
    // Passkeys (docs/plans/add-passkeys.md)
    'passkeys',
    'deletePasskey',
    'checkPasskeyRp',
    'findPasskeys',
    'createPasskey',
    'signPasskey',
    ...TransferService.methods,
    'account',
    // Custom fields, links, MFA code and backup codes members (item_extras.dart, vault_links.dart)
    'customFieldDefs',
    'revealField',
    'revealFields',
    'linkedItems',
    'linkCandidates',
    'setLinks',
    'saveCode',
    'saveBackupCodes',
    // Files of items (item_files.dart)
    ...itemFilesMethods,
    // Notes, cards and identities
    'notes',
    'revealNote',
    'saveNote',
    'deleteNote',
    'cards',
    'revealCard',
    'saveCard',
    'deleteCard',
    'identities',
    'revealIdentity',
    'saveIdentity',
    'deleteIdentity',
  };

  String _string(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  String? _optionalString(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value == null) return null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  int _index(List<Object?> args, int at) {
    final value = at < args.length ? asInt(args[at]) : null;
    if (value == null) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not a whole number');
    return value;
  }

  Map<String, Object?> _object(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! Map<String, Object?>) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
    return value;
  }

  /// The base64url bytes of [object]'s member [name].
  Uint8List _bytes(Map<String, Object?> object, String name) {
    final value = object[name];
    if (value is! String || value.isEmpty) throw CoreFailure(CoreFailure.invalid, '$name is not text');
    try {
      return unb64url(value);
    } on FormatException {
      throw CoreFailure(CoreFailure.invalid, '$name is not base64url');
    }
  }

  /// Passkey unlock isn't offered in Firefox: its extension pages can only name a web domain as the relying party, so a credential
  /// there would answer to any page of that domain (docs/plans/add-passkey-unlock.md). The pages hide it; this keeps a page that
  /// doesn't from making one.
  void _passkeysAllowed() {
    if (vault.platform.browser == Browser.firefox) {
      throw const CoreFailure(CoreFailure.unavailable, 'no passkey unlock in Firefox');
    }
  }

  /// Opens the sync settings of the vault that just opened. A sync that can't be read leaves the vault open, with sync not loaded.
  Future<void> _opened() async {
    try {
      await sync.load();
    } catch (_) {
      sync.unload();
    }
    // A file that was to go up when the worker stopped is taken out of its item: nothing holds its bytes any more
    try {
      await itemFiles.settle();
    } catch (_) {
      // Tried again before the next run
    }
  }

  /// Everything that holds a file's bytes or a definition lets go: the vault locks, or is removed.
  void _forgetFiles() {
    itemFiles.unload();
    customFields.unload();
  }

  /// The links [args] holds as `ItemRef`s, at [at].
  List<ItemRef> _refs(List<Object?> args, int at) => parseRefs(at < args.length ? args[at] : null);

  /// The item [args] names at [at], as an `ItemRef`.
  ItemRef _ref(List<Object?> args, int at) => parseRef(at < args.length ? args[at] : null);

  static const _noSpacesMethod = Object();

  /// The spaces' methods (docs/plans/add-spaces.md), or [_noSpacesMethod] for any other.
  Future<Object?> _spacesCall(String method, List<Object?> args) async {
    final spaces = sync.spaces;
    switch (method) {
      case 'spaces':
        vault.requireSession();
        return spaces.list(refresh: args.isEmpty || args[0] != false);
      case 'space':
        return spaces.space(_string(args, 0));
      case 'spaceContact':
        return spaces.contact(_string(args, 0), person: _optionalString(args, 1));
      case 'spaceTrust':
        await spaces.trust(_string(args, 0), person: _optionalString(args, 1), digits: _optionalString(args, 2));
        return null;
      case 'spaceAnswer':
        await spaces.answer(_string(args, 0), accept: args.length > 1 && args[1] == true);
        return null;
      case 'spaceMake':
        return {'id': await spaces.make(_string(args, 0))};
      case 'spaceLeave':
        await spaces.leave(_string(args, 0));
        return null;
      case 'spaceInvite':
        await spaces.invite(_string(args, 0), _string(args, 1), _string(args, 2));
        return null;
      case 'spaceResend':
        await spaces.resend(_string(args, 0), _string(args, 1));
        return null;
      case 'spaceConfirm':
        await spaces.confirm(_string(args, 0), _string(args, 1), _string(args, 2));
        return null;
      case 'spaceRole':
        await spaces.setRole(_string(args, 0), _string(args, 1), _string(args, 2));
        return null;
      case 'spaceRemove':
        await spaces.remove(_string(args, 0), _string(args, 1));
        return null;
      case 'spaceGrant':
        await spaces.grant(_string(args, 0), _string(args, 1), _string(args, 2), _optionalString(args, 3));
        return null;
      case 'spaceHeld':
        return spaces.held(_string(args, 0));
      case 'spaceKeepHeld':
        await spaces.keepHeld(_string(args, 0), _string(args, 1));
        return null;
      case 'spaceDeleteHeld':
        await spaces.deleteHeld(_string(args, 0), _string(args, 1));
        return null;
      case 'ownFingerprint':
        vault.requireSession();
        return spaces.ownFingerprint();
      case 'moveItem':
        await spaces.moveItem(_string(args, 0), _string(args, 1), _optionalString(args, 2), collection: _optionalString(args, 3));
        return null;
      case 'hiddenLoginIds':
        vault.requireSession();
        return spaces.hiddenLoginIds();
      case 'joinDavSpace':
        return spaces.joinDav(_object(args, 0));
      case 'leaveDavSpace':
        await spaces.leaveDav(_string(args, 0));
        return null;
      case 'syncSpaces':
        await sync.syncSpacesNow();
        return spaces.list();
    }
    return _noSpacesMethod;
  }

  /// Answers [method] with [args], the JSON values `CoreApi`'s method takes in order; the result is JSON.
  Future<Object?> call(String method, [List<Object?> args = const []]) async {
    if (keys.handles(method)) return keys.call(method, args);
    if (ToolsService.methods.contains(method)) return tools.call(method, args);
    if (TransferService.methods.contains(method)) return transfer.call(method, args);
    if (itemFilesMethods.contains(method)) return itemFiles.call(method, args);
    switch (method) {
      case 'state':
        final state = vault.state();
        final status = vault.session == null ? null : sync.status();
        // Files are listed with any place and go up and come down with Kemlock Server only
        return {...state, 'fileSync': sync.syncPlace == 'kemlock' ? 'kemlock' : 'readOnly', 'sync': ?status};
      case 'createVault':
        await vault.createVault(_string(args, 0));
        await _opened();
        return null;
      case 'unlock':
        final result = await vault.unlock(_string(args, 0));
        if (result.ok) await _opened();
        return {'ok': result.ok, 'wrongPasswords': result.wrongPasswords};
      case 'lock':
        _forgetFiles();
        sends.unload();
        transfer.forget();
        sync.unload();
        keys.forget();
        account.unload();
        await vault.lock();
        return null;
      case 'removeVault':
        _forgetFiles();
        sends.unload();
        transfer.forget();
        sync.unload();
        keys.forget();
        account.unload();
        await vault.removeVault();
        return null;
      case 'exportSession':
        return vault.exportSession();
      case 'restoreSession':
        final restored = await vault.restoreSession(_string(args, 0));
        if (restored) await _opened();
        return restored;
      case 'codes':
        return vault.codes();
      case 'liveCodes':
        final ids = args.isNotEmpty && args[0] is List<Object?> ? (args[0]! as List<Object?>).whereType<String>().toList() : <String>[];
        final now = args.length > 1 && args[1] is num ? (args[1]! as num).toInt() : vault.nowMs;
        return vault.liveCodes(ids, now);
      case 'nextHotp':
        return vault.nextHotp(_string(args, 0));
      case 'logins':
        return vault.logins();
      case 'revealLogin':
        return vault.revealLogin(_string(args, 0));
      case 'saveLogin':
        return vault.saveLogin(_optionalString(args, 0), _object(args, 1));
      case 'deleteLogin':
        await vault.deleteLogin(_string(args, 0));
        return null;
      case 'ignoreHealth':
        await vault.ignoreHealth(_string(args, 0), args.length > 1 && args[1] == true);
        return null;
      case 'backupCodes':
        return vault.backupCodes();
      case 'useBackupCode':
        return vault.useBackupCode(_string(args, 0));
      case 'addCode':
        return vault.addCode(_string(args, 0), _optionalString(args, 1), _optionalString(args, 2));
      case 'previewCode':
        return vault.previewCode(_string(args, 0));
      case 'readQr':
        return vault.readQr(_string(args, 0));
      case 'linkCode':
        await vault.linkCode(_string(args, 0), _optionalString(args, 1));
        return null;
      case 'match':
        vault.requireSession();
        final page = Page.parse(_string(args, 0));
        if (page == null) return const SiteMatches(site: '').toJson();
        return vault.matcher
            .match(page, logins: vault.lists.logins, accounts: vault.lists.accounts, passkeys: vault.lists.passkeys)
            .toJson();
      case 'generate':
        return generate(_object(args, 0), words: CoreDataAccess(vault).wordList);
      case 'health':
        final health = await vault.health(ask: true);
        return {
          'reused': health.idsWith(LoginWarning.reused),
          'weak': health.idsWith(LoginWarning.weak),
          'withoutItsCode': health.idsWith(LoginWarning.noCode),
          'breached': health.idsWith(LoginWarning.breached),
        };
      case 'syncStatus':
        return vault.session == null ? null : sync.status();
      case 'signInKemlock':
        return sync.signInKemlock(_object(args, 0));
      case 'signInKemlockSso':
        return sync.signInKemlockSso(_object(args, 0));
      case 'signInKemlockPasskey':
        return sync.signInKemlockPasskey(_object(args, 0));
      case 'signInWebdav':
        return sync.signInWebdav(_object(args, 0));
      case 'signInVaultwarden':
        return sync.signInVaultwarden(_object(args, 0));
      case 'answerStep':
        return sync.answer(_object(args, 0));
      case 'syncNow':
        return sync.syncNow();
      case 'confirmRemovals':
        return sync.confirmRemovals();
      case 'keepRemovals':
        return sync.keepRemovals();
      case 'signOut':
        await sync.signOut();
        return null;
      case 'settings':
        vault.requireSession();
        return vault.settings();
      case 'saveSettings':
        return vault.saveSettings(_object(args, 0));
      case 'recentPasswords':
        return vault.recentPasswords();
      case 'addRecentPassword':
        await vault.addRecentPassword(_object(args, 0));
        return null;
      case 'rememberPick':
        await vault.rememberPick(_string(args, 0), _string(args, 1));
        return null;
      case 'picks':
        return vault.picks(_string(args, 0));
      case 'pickedHosts':
        return vault.pickedHosts(_string(args, 0));
      case 'forgetPick':
        await vault.forgetPick(_string(args, 0), _string(args, 1));
        return null;
      case 'checkServer':
        return sync.checkServer(_string(args, 0), _string(args, 1));
      case 'securityKeyChallenge':
        vault.requireSession();
        return sync.securityKeyChallenge();
      case 'passkeyUnlockInfo':
        return vault.passkeyUnlock.info();
      case 'passkeyUnlockPrepare':
        _passkeysAllowed();
        vault.requireSession();
        return vault.passkeyUnlock.prepare();
      case 'addPasskeyUnlock':
        _passkeysAllowed();
        final session = vault.requireSession();
        final added = _object(args, 0);
        final transports = added['transports'];
        final rp = added['rpId'];
        // Whoever sits at an open browser doesn't get to make a key of their own: the password is asked, and checked as an unlock does
        final typed = added['password'];
        if (typed is! String || typed.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'the password is missing');
        final credential = _bytes(added, 'credentialId');
        final output = _bytes(added, 'prfOutput');
        await vault.verifyPassword(typed);
        return vault.passkeyUnlock.add(
          secretKey: session.secretKey,
          authenticated: session.authenticated,
          credential: credential,
          prf: output,
          name: added['name'] is String ? added['name']! as String : '',
          rp: rp is String && rp.isNotEmpty ? rp : null,
          attachment: added['attachment'] is String ? added['attachment']! as String : null,
          transports: transports is List<Object?> ? transports.whereType<String>().take(8).toList() : const [],
        );
      case 'renamePasskeyUnlock':
        vault.requireSession();
        return vault.passkeyUnlock.rename(_string(args, 0), _string(args, 1));
      case 'removePasskeyUnlock':
        vault.requireSession();
        return vault.passkeyUnlock.remove(_string(args, 0));
      case 'unlockWithPasskey':
        _passkeysAllowed();
        final answer = _object(args, 0);
        final wasOpen = vault.session != null;
        final result = await vault.unlockWithPasskey(_bytes(answer, 'credentialId'), _bytes(answer, 'prfOutput'));
        if (result.ok && !wasOpen) await _opened();
        return {'ok': result.ok, 'wrongPasswords': result.wrongPasswords, 'reason': ?result.reason};
      // Passkeys (docs/plans/add-passkeys.md)
      case 'passkeys':
        return passkeys.list();
      case 'deletePasskey':
        await passkeys.delete(_string(args, 0));
        return null;
      case 'checkPasskeyRp':
        return passkeys.checkRp(_string(args, 0), _optionalString(args, 1));
      case 'findPasskeys':
        final allowed = args.length > 1 && args[1] is List<Object?> ? (args[1]! as List<Object?>).whereType<String>().toList() : <String>[];
        return passkeys.find(_string(args, 0), allowed);
      case 'createPasskey':
        return passkeys.create(_object(args, 0), _string(args, 1), _optionalString(args, 2));
      case 'signPasskey':
        return passkeys.sign(_string(args, 0), _string(args, 1), _string(args, 2), _optionalString(args, 3));
      case 'account':
        return account.call(_object(args, 0));
      // Custom fields, links, MFA code and backup codes (item_extras.dart, vault_links.dart)
      case 'customFieldDefs':
        vault.requireSession();
        return customFields.read(refresh: args.isNotEmpty && args[0] == true);
      case 'revealField':
        return vault.revealField(_ref(args, 0), _index(args, 1));
      case 'revealFields':
        return vault.revealFields(_ref(args, 0));
      case 'linkedItems':
        return vault.linkedItemViews(_ref(args, 0));
      case 'linkCandidates':
        return vault.linkCandidateViews(args.isEmpty || args[0] == null ? null : _ref(args, 0), _string(args, 1));
      case 'setLinks':
        vault.requireSession();
        final ref = _ref(args, 0);
        return {'linkFailures': await vault.setLinksOf(ref.kind, ref.id, _refs(args, 1))};
      case 'saveCode':
        return vault.saveCode(_string(args, 0), _object(args, 1));
      case 'saveBackupCodes':
        return vault.saveBackupCodes(_string(args, 0), _object(args, 1));
      // Notes, cards and identities (vault_items.dart)
      case 'notes':
        return vault.notes();
      case 'revealNote':
        return vault.revealNote(_string(args, 0));
      case 'saveNote':
        return vault.saveNote(_optionalString(args, 0), _object(args, 1));
      case 'deleteNote':
        await vault.deleteNote(_string(args, 0));
        return null;
      case 'cards':
        return vault.cards();
      case 'revealCard':
        return vault.revealCard(_string(args, 0));
      case 'saveCard':
        return vault.saveCard(_optionalString(args, 0), _object(args, 1));
      case 'deleteCard':
        await vault.deleteCard(_string(args, 0));
        return null;
      case 'identities':
        return vault.identities();
      case 'revealIdentity':
        return vault.revealIdentity(_string(args, 0));
      case 'saveIdentity':
        return vault.saveIdentity(_optionalString(args, 0), _object(args, 1));
      case 'deleteIdentity':
        await vault.deleteIdentity(_string(args, 0));
        return null;
    }
    final spaces = await _spacesCall(method, args);
    if (spaces != _noSpacesMethod) return spaces;
    if (sendsMethods.contains(method)) return sends.call(method, args);
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }
}
