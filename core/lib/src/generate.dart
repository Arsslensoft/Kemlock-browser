// New passwords, as the app's generator makes them (`GeneratorOptions` in src/shared/api.ts): random characters, or words from
// EFF's large list, under a site's rules when it names some. The draws are Kemlock-core's, from the platform's secure source.
import 'package:kemlock_core/features/generator/generator.dart';
import 'package:kemlock_core/features/generator/password_rules.dart';

import 'failure.dart';

/// EFF's large word list as served: 7,776 lines of five dice digits, a tab and a word. The words in its order.
List<String> parseWordList(String text) => [
  for (final line in text.split('\n'))
    if (line.split('\t') case [_, final word] when word.trim().isNotEmpty) word.trim(),
];

/// A site's rules as the page gave them: the `passwordrules` language (`minlength: 8; required: lower; …`), or, as an input's
/// attributes would say it, `minlength=8;maxlength=16` joined with semicolons.
PasswordRules? siteRules(String? text) {
  if (text == null || text.trim().isEmpty) return null;
  final rules = PasswordRules.parse(text.replaceAllMapped(RegExp(r'\b(minlength|maxlength)\s*=\s*'), (m) => '${m[1]}: '));
  return rules.isEmpty ? null : rules;
}

/// A password for [options]. A length or a count past what the generator makes is held to its range.
String generate(Map<String, Object?> options, {List<String>? words, ByteSource? source}) {
  final bytes = source ?? SecureByteSource();
  bool flag(String name, bool fallback) => options[name] is bool ? options[name]! as bool : fallback;
  if (options['mode'] == 'passphrase') {
    if (words == null || words.isEmpty) throw const CoreFailure(CoreFailure.unavailable, 'no word list');
    final count = options['words'];
    final separator = options['separator'];
    return generatePassphrase(
      bytes,
      words,
      PassphraseChoices(
        words: count is num ? count.toInt().clamp(minPassphraseWords, maxPassphraseWords) : defaultPassphraseWords,
        separator: separator is String && separator.length <= 1 ? separator : '-',
        capitalise: flag('capitalize', false),
        digit: flag('includeNumber', false),
      ),
    );
  }
  final length = options['length'];
  final rules = options['siteRules'];
  return generatePassword(
    bytes,
    PasswordChoices(
      length: length is num ? length.toInt().clamp(minPasswordLength, maxPasswordLength) : defaultPasswordLength,
      capitals: flag('uppercase', true),
      digits: flag('digits', true),
      symbols: flag('symbols', true),
      avoidLookAlikes: flag('avoidLookAlikes', true),
    ),
    siteRules(rules is String ? rules : null),
  );
}
