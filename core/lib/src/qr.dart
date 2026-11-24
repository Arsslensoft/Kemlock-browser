// Reading a QR code from a screenshot (`CoreApi.readQr`): the extension's Dart entry depends on `zxing2` itself, so the store build of
// the app, which reads QR codes with ML Kit, doesn't gain it (design decision 1). The image is decoded to pixels by the browser
// (js/image.dart), and the code is found here.
import 'dart:typed_data';

import 'package:zxing2/qrcode.dart';

import 'platform.dart';

/// The text of the QR code in [pixels], or null when there is none (or none that reads). The page is tried as it is and then
/// shrunk to a half, a third and a quarter (the reader finds the squares of a code whose modules are a few pixels wide, and a
/// screen's scaling or a large code makes them wider and blurred); each size with the local histogram, the global one when that
/// finds nothing, and inverted, as light-on-dark codes are.
String? readQrCode(Pixels pixels) {
  for (final factor in const [1, 2, 3, 4]) {
    final scaled = factor == 1 ? pixels : _shrunk(pixels, factor);
    if (scaled.width < 21 || scaled.height < 21) break;
    final found = _readOne(scaled);
    if (found != null) return found;
  }
  return null;
}

String? _readOne(Pixels pixels) {
  final source = RGBLuminanceSource(pixels.width, pixels.height, pixels.argb);
  final hints = DecodeHints()..put(DecodeHintType.tryHarder);
  final tries = <BinaryBitmap Function()>[
    () => BinaryBitmap(HybridBinarizer(source)),
    () => BinaryBitmap(GlobalHistogramBinarizer(source)),
    () => BinaryBitmap(HybridBinarizer(InvertedLuminanceSource(source))),
  ];
  for (final bitmap in tries) {
    try {
      return QRCodeReader().decode(bitmap(), hints: hints).text;
    } on ReaderException {
      // Nothing there by this way of reading it
    }
  }
  return null;
}

/// [pixels] with each [factor] by [factor] square of them averaged into one.
Pixels _shrunk(Pixels pixels, int factor) {
  final width = pixels.width ~/ factor;
  final height = pixels.height ~/ factor;
  final argb = Int32List(width * height);
  final area = factor * factor;
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var red = 0, green = 0, blue = 0;
      for (var dy = 0; dy < factor; dy++) {
        final row = (y * factor + dy) * pixels.width + x * factor;
        for (var dx = 0; dx < factor; dx++) {
          final value = pixels.argb[row + dx];
          red += (value >> 16) & 0xFF;
          green += (value >> 8) & 0xFF;
          blue += value & 0xFF;
        }
      }
      argb[y * width + x] = (0xFF << 24) | ((red ~/ area) << 16) | ((green ~/ area) << 8) | (blue ~/ area);
    }
  }
  return (width: width, height: height, argb: argb);
}
