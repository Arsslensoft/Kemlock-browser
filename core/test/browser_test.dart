import 'package:kemlock_extension_core/src/browser.dart';
import 'package:test/test.dart';

void main() {
  test('Chrome, Edge and Firefox are told from the user agent', () {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
    expect(Browser.fromUserAgent(chrome), Browser.chrome);
    expect(Browser.fromUserAgent('$chrome Edg/157.0.0.0'), Browser.edge);
    expect(Browser.fromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0'), Browser.firefox);
    expect(Browser.fromUserAgent(''), Browser.chrome);
  });

  test('each has Bitwarden\'s device type and a device name', () {
    expect(Browser.chrome.deviceType, 2);
    expect(Browser.firefox.deviceType, 3);
    expect(Browser.edge.deviceType, 5);
    expect(Browser.edge.deviceName, 'Kemlock · Edge');
    expect(Browser.named('firefox'), Browser.firefox);
    expect(Browser.named('opera'), isNull);
  });
}
