import 'package:kemlock_extension_core/src/browser.dart';
import 'package:test/test.dart';

void main() {
  test('Chrome, Edge, Firefox and Safari are told from the user agent', () {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
    expect(Browser.fromUserAgent(chrome), Browser.chrome);
    expect(Browser.fromUserAgent('$chrome Edg/157.0.0.0'), Browser.edge);
    expect(Browser.fromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0'), Browser.firefox);
    expect(Browser.fromUserAgent(''), Browser.chrome);
  });

  test('Safari says Safari and Version and never Chrome, which every Chromium browser says beside its own Safari', () {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
    const iphone =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
    expect(Browser.fromUserAgent(mac), Browser.safari);
    expect(Browser.fromUserAgent(iphone), Browser.safari);
    // Chrome and Edge on a Mac say Safari too, but Chrome as well
    const chromeOnMac =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
    expect(Browser.fromUserAgent(chromeOnMac), Browser.chrome);
    expect(Browser.fromUserAgent('$chromeOnMac Edg/157.0.0.0'), Browser.edge);
    // Chrome on iOS is WebKit with CriOS and no Version
    const chromeOnIphone =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/158.0.0.0 Mobile/15E148 Safari/604.1';
    expect(Browser.fromUserAgent(chromeOnIphone), Browser.chrome);
  });

  test('each has Bitwarden\'s device type and a device name', () {
    expect(Browser.chrome.deviceType, 2);
    expect(Browser.firefox.deviceType, 3);
    expect(Browser.edge.deviceType, 5);
    expect(Browser.safari.deviceType, 20);
    expect(Browser.edge.deviceName, 'Kemlock · Edge');
    expect(Browser.safari.deviceName, 'Kemlock · Safari');
    expect(Browser.named('firefox'), Browser.firefox);
    expect(Browser.named('safari'), Browser.safari);
    expect(Browser.named('opera'), isNull);
  });
}
