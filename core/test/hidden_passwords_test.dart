// A password a shared space hides from this account (docs/plans/add-spaces.md): its login view says nothing of its strength, and the
// duplicate cleaner neither compares it nor shows it. The tests say which login hides its password through `passwordHides`, as the
// spaces' chain does for a login of a space.
import 'dart:convert';

import 'package:kemlock_core/models/login.dart' show PreviousPassword;
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const readable = 'Aaaa-1111-bbbb-Cc';
const secretOne = 'Bbbb-2222-cccc-Dd';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Future<String> addLogin(CoreService core, String name, String secret) async =>
    (await object(core, 'saveLogin', [
          null,
          {
            'name': name,
            'username': 'sam',
            'password': secret,
            'websites': ['orbit-cloud.com'],
          },
        ]))['id']!
        as String;

void main() {
  late CoreService core;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
  });

  group('the view of a login whose password is hidden', () {
    test('leaves its strength out, and the other logins keep theirs', () async {
      final hidden = await addLogin(core, 'Orbit', secretOne);
      final open = await addLogin(core, 'Docs', readable);
      core.vault.passwordHides = (space, id) => id == hidden;
      final views = {for (final view in await list(core, 'logins')) view['id']: view};
      expect(views[hidden]!.containsKey('strength'), isFalse);
      expect(views[hidden], containsPair('hasPassword', true));
      expect(views[open], containsPair('strength', isA<int>()));
      // A save answers with the same view
      final saved = await object(core, 'saveLogin', [
        hidden,
        {'name': 'Orbit', 'username': 'sam', 'password': '', 'keepPassword': true, 'websites': <String>[]},
      ]);
      expect(saved.containsKey('strength'), isFalse);
    });
  });

  group('the duplicate cleaner and a hidden password', () {
    Future<List<Map<String, Object?>>> groups() async =>
        ((await object(core, 'duplicates'))['groups']! as List<Object?>).cast<Map<String, Object?>>();

    test('does not match it as the same sign-in with a login that holds the same password', () async {
      final a = await addLogin(core, 'Orbit', readable);
      final b = await addLogin(core, 'Orbit again', readable);
      expect((await groups()).single['reason'], 'sameSignIn');
      core.vault.passwordHides = (space, id) => id == b;
      final found = await groups();
      expect(found.single['reason'], 'sameAccount');
      expect({for (final item in found.single['items']! as List<Object?>) (item! as Map<String, Object?>)['id']}, {a, b});
    });

    test('shows no password in the review, and offers no choice of one', () async {
      final a = await addLogin(core, 'Orbit', readable);
      final b = await addLogin(core, 'Orbit again', secretOne);
      core.vault.passwordHides = (space, id) => id == b;
      final key = (await groups()).single['key']! as String;
      final plan = await object(core, 'duplicateReview', [key]);
      final fields = [for (final field in plan['fields']! as List<Object?>) (field! as Map<String, Object?>)['id']];
      expect(fields, isNot(contains('password')));
      final text = jsonEncode(plan);
      expect(text, isNot(contains(readable)));
      expect(text, isNot(contains(secretOne)));
      expect(plan['items'], hasLength(2));
      expect(a, isNotEmpty);
    });

    test('merges into a login without making the hidden password one of its previous passwords', () async {
      final a = await addLogin(core, 'Orbit', readable);
      final b = await addLogin(core, 'Orbit again', secretOne);
      core.vault.passwordHides = (space, id) => id == b;
      final key = (await groups()).single['key']! as String;
      final done = await object(core, 'duplicateMerge', [key, a, <String, Object?>{}]);
      expect(done['removed'], 1);
      final kept = core.vault.lists.logins.single;
      expect(kept.password, readable);
      expect(kept.previousPasswords ?? const [], isEmpty);
    });

    test('keeps the password of a hidden login that stays, as it is and never blanked', () async {
      final a = await addLogin(core, 'Orbit', readable);
      final b = await addLogin(core, 'Orbit again', secretOne);
      core.vault.passwordHides = (space, id) => id == b;
      final key = (await groups()).single['key']! as String;
      await core.call('duplicateMerge', [key, b, <String, Object?>{}]);
      final kept = core.vault.lists.logins.single;
      expect(kept.id, b);
      expect(kept.password, secretOne);
      expect([for (final previous in kept.previousPasswords ?? const <PreviousPassword>[]) previous.password], isNot(contains(secretOne)));
      expect(a, isNotEmpty);
    });
  });
}
