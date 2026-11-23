// Reading a QR code from a screenshot: the code is found at the size the screen shows it, whatever the page's scaling.
import 'dart:typed_data';

import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/qr.dart';
import 'package:test/test.dart';
import 'package:zxing2/qrcode.dart';

const link = 'otpauth://totp/Harbor%20Notes:alex@harbornotes.app?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Harbor%20Notes';

/// A page of [width] by [height] with the code for [text] on it, its modules [module] pixels wide (a fraction is a page scaled).
Pixels page(String text, {required double module, int width = 1600, int height = 1000}) {
  final matrix = Encoder.encode(text, ErrorCorrectionLevel.m).matrix!;
  final size = (matrix.width * module).round();
  final left = (width - size) ~/ 2;
  final top = (height - size) ~/ 2;
  final argb = Int32List(width * height)..fillRange(0, width * height, 0xFFF6F7F9);
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      final dark = matrix.get((x / module).floor(), (y / module).floor()) == 1;
      argb[(top + y) * width + left + x] = dark ? 0xFF000000 : 0xFFFFFFFF;
    }
  }
  return (width: width, height: height, argb: argb);
}

void main() {
  test('a code is read whatever the width of its modules', () {
    for (final module in [2.0, 3.0, 4.5, 6.0, 7.5, 10.0]) {
      expect(readQrCode(page(link, module: module)), link, reason: 'modules of $module pixels');
    }
  });

  test('a page with no code reads as none', () {
    final blank = (width: 400, height: 300, argb: Int32List(400 * 300)..fillRange(0, 400 * 300, 0xFFFFFFFF));
    expect(readQrCode(blank), isNull);
  });
}
