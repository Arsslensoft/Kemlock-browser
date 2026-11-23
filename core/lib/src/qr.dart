// Reading a QR code from a screenshot (`CoreApi.readQr`): the extension's Dart entry depends on `zxing2` itself, so the store build of
// the app, which reads QR codes with ML Kit, doesn't gain it (design decision 1). The image is decoded to pixels by the browser
// (js/image.dart), and the code is found here.
import 'package:zxing2/qrcode.dart';

import 'platform.dart';

/// The text of the QR code in [pixels], or null when there is none (or none that reads). The page is tried as it is, with the
/// global histogram when the local one finds nothing, and inverted, as light-on-dark codes are.
String? readQrCode(Pixels pixels) {
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
