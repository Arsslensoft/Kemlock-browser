import 'package:kemlock_core/features/generator/generator.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/generate.dart';
import 'package:test/test.dart';

void main() {
  test('a random password has the length asked, held to the generator\'s range', () {
    expect(generate({'mode': 'random', 'length': 24}), hasLength(24));
    expect(generate({'mode': 'random', 'length': 3}), hasLength(minPasswordLength));
    expect(generate({'mode': 'random', 'length': 500}), hasLength(maxPasswordLength));
  });

  test('the classes asked for are the ones used', () {
    final plain = generate({'mode': 'random', 'length': 64, 'uppercase': false, 'digits': false, 'symbols': false});
    expect(plain, matches(RegExp(r'^[a-z]+$')));
  });

  test('look-alikes are left out unless asked for', () {
    for (var i = 0; i < 20; i++) {
      expect(generate({'mode': 'random', 'length': 64}), isNot(matches(RegExp('[0O1lI]'))));
    }
  });

  test('a site\'s rules shape the password', () {
    final password = generate({
      'mode': 'random',
      'length': 20,
      'siteRules': 'minlength: 8; maxlength: 12; required: lower; required: digit',
    });
    expect(password.length, inInclusiveRange(8, 12));
    expect(password, matches(RegExp('[a-z]')));
    expect(password, matches(RegExp('[0-9]')));
  });

  test('an input\'s attributes read as rules too', () {
    expect(siteRules('minlength=10;maxlength=10')!.maxLength, 10);
    expect(siteRules(''), isNull);
    expect(siteRules(null), isNull);
  });

  test('a passphrase takes words from the list', () {
    final words = parseWordList('11111\tabacus\n11112\tabdomen\n\n11113\tabdominal\n');
    expect(words, ['abacus', 'abdomen', 'abdominal']);
    final phrase = generate({'mode': 'passphrase', 'words': 4, 'separator': '.', 'capitalize': true}, words: words);
    expect(phrase.split('.'), hasLength(4));
    for (final word in phrase.split('.')) {
      expect(word, matches(RegExp('^A')));
    }
  });

  test('a passphrase without the word list is not made', () {
    expect(() => generate({'mode': 'passphrase'}), throwsA(isA<CoreFailure>().having((e) => e.code, 'code', CoreFailure.unavailable)));
  });
}
