# iOS デバイスから始める Bluetooth 制御の業務用サーマルプリンター対応アプリの作り方

<div class="author-info">
江本光晴（株式会社ゆめみ）<BR />
𝕏: @mitsuharu_e<BR />
Bluesky: @mitsuharu.bsky.social
</div>

昨今のペーパーレス化が進む社会でも、サーマル（感熱紙）プリントを見る機会は依然として多いです。iPhone や iPad を利用した POS レジからレシートを受け取った経験があるでしょう。その iPhone からどのようにレシートを印刷しているのか気になったことはありませんか。

印刷といえば iOS には Wi-Fi に接続されたプリンターを制御する AirPrint があります。しかしながら、業務用サーマルプリンターは Wi-Fi 非対応の機種も多く、AirPrint をサポートしていません。サーマルプリンター向けの印刷命令を実行する必要があります。この記事は、iOS デバイスを利用してサーマルプリンターを制御する方法を説明します。Bluetooth で接続可能なサーマルプリンターを対象として、接続や印刷する方法を説明します。また JavaScript で作られたレシート印刷に便利な OSS を iOS アプリで実行する方法も紹介します。この記事を読むことで、業務用サーマルプリンター対応アプリの実装方法を理解し、レシートを印刷できるようになります。今すぐにサーマルプリンターを買い求めたくなるでしょう。

### 免責事項・商標について

本記事は、製造メーカーが提供するドキュメントや私が所有する数台の実機から調査・検証した内容をまとめました。製造時期により実機のバージョンやファームウェアは異なる場合があるため、記載どおりにならない場合があります。また、製品名称は各社の商標または登録商標です。™ や ® の表記は省略します。

## 開発環境

開発環境は MacBook Pro 14 インチ 2021、Apple M1 Pro、macOS Sonoma 14.5 を用いて、Xcode 15.3 で開発しました。検証機として iPhone SE（第３世代）、iOS 17.5 を利用しました。

### 対象のサーマルプリンターについて

本記事で対象するとサーマルプリンターは SUNMI 社が製造する “SUNMI 58mm Cloud Printer” です。58mm 幅の感熱紙を印刷できるサーマルプリンターです。無線のインタフェースとして Wi-Fi 4（2.4GHz）と Bluetooth 4.2 BLE を備えています。この機種の Bluetooth を利用して、サーマルプリンターを制御します。なお、私が所持する機種のモデルおよびソフトウェアバージョンは次のとおりです。

| Model | Firmware version | SUNMI APP version | Partner APP version | MiniApp version |
| :--: | :-: | :-: | :-: | :-: |
| <div class="no-break">NT212_S</div> | 2.1.0 | 2.2.0 | 1.0.10 | 0.0.1 |

その機種の他に、80mm 幅に対応した兄弟機 “SUNMI 80mm Kitchen Cloud Printer”、EPSON 社のレシートプリンター “TM-P20II” を所有しています。これらの機種でも動作確認を行なっています。

## Bluetooth による制御方法

CoreBluetooth を用いて、サーマルプリンターを制御します。私はライブラリ AsyncBluetooth [^AsyncBluetooth] を利用しました。CoreBluetooth が提供する API は Delegate を利用するため、複雑になりがちです。一方、AsyncBluetooth は Swift Concurrency でシンプルに書けるので、採用しました。それを利用して、サーマルプリンターを接続および制御する方法を紹介します。ソースコードは紙面の都合上、簡略表示します。実際にソースコードを書く際は付録を参照してください。なお、Bluetooth を利用するので、Info.plist に許可設定と利用理由を忘れずに追加しましょう。

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Use to connect with thermal printers</string>
```

<!-- textlint-disable -->
[^AsyncBluetooth]: https://github.com/manolofdez/AsyncBluetooth
<!-- textlint-enable -->

まず最初に Bluetooth 機器のスキャンを行い、サーマルプリンターを探します。対象のサーマルプリンターは `CloudPrint_{数字}` という名前が設定されているので、その名前がある機種を選択して接続します。例では直接 if 文で選択しましたが、一般には検出された機種を一覧表示して、目視確認するとよいです。

```swift
import AsyncBluetooth

let manager = CentralManager()

try await manager.waitUntilReady()

let stream = try await manager.scanForPeripherals(withServices: nil)
for await scanData in stream {
    if scanData.peripheral.name.contains("CloudPrint") {
      try await manager.connect(scanData.peripheral, options: nil)
      await manager.stopScan()
    }
}
```

選択した Peripheral から、サービス（serviceUUID）および、そのサービス内のキャラクタリスティック（characteristicUUID）を取得します。今回はデータ送信するため、書き込み可能なキャラクタリスティックを選択します。例では、単純に条件に合う最初の組み合わせを選択してますが、実際は機種のドキュメントを確認して、適切な組み合わせを選択してください。

```swift
try await peripheral.discoverServices(nil)
for service in peripheral.discoveredServices ?? [] {
  try await peripheral.discoverCharacteristics(nil, for: service)
  guard
    let serviceUUID = UUID(uuidString: service.uuid.uuidString),
    let char = service.discoveredCharacteristics?.first(where: {
      $0.properties.contains(.write)
    }),
    let characteristicUUID = UUID(uuidString: char.uuid.uuidString)
  else {
    continue
  }
   return (serviceUUID, characteristicUUID)
}
```

これで準備が揃いました。サーマルプリンターにデータを送信する関数を作成しましょう。印刷するので関数を `print` と命名したいところですが、すでに同名関数があるので、我慢しました。

```swift
func run(data: Data) async throws　{
  try await peripheral.writeValue(
    value,
    forCharacteristicWithUUID: characteristicUUID,
    ofServiceWithUUID: serviceUUID
  )
}
```

## サーマルプリンターのページ記述言語

ページ記述言語はプリンターに対して印刷を指示するためのプログラミング言語です。アドビ社が開発した PostScript が有名です。その他にもページ記述言語はあり、セイコーエプソン社が開発した ESC/P（Epson Standard Code for Printers）があります。かつてドットインパクトプリンタが主流だった時代は、多くのメーカーがサポートしていました。そのバリエーションの１つとして、POS 端末で採用されるサーマルプリンターを制御する ESC/POS があります。この言語は現在も多くのサーマルプリンターでサポートされています。私が所有している３台のサーマルプリンターも ESC/POS をサポートしています。つまり、この ESC/POS コマンドを利用すれば、サーマルプリンターで印刷ができるのです。

### ESC/POS コマンド

ESC/POS は、プリンターに送信されるコマンド（16 進数のバイトコード列）です。そのコマンドを組み合わせて、さまざまな印刷パターンを制御します。たとえば、次のようなコマンドがあります。

| コマンド | 説明 | コード |
| :-- | :-- | :-- |
| ESC @ | プリンターを初期化する | 1b 40 |
| LF | 改行する | 0a |
| <div class="no-break">ESC E n</div> | n=1の場合に太字にする | 太字オン 1b 45 01 <br/> 太字オフ 1b 45 00 |

例として、太字の「**Hello World**」を印刷するコマンドを考えましょう。「Hello World」の ASCII コードは `48 65 6c 6c 6f 20 57 6f 72 6c 64` になるので、次のようなコマンドになります。

```hex
1b 40                             // 初期化
1b 45 01                          // 太字オン
48 65 6c 6c 6f 20 57 6f 72 6c 64  // Hello World
0a                                // 改行
```

このコマンドをサーマルプリンターに渡せば「**Hello World**」が印刷されます。iPhone からコマンドをサーマルプリンターに送信するため、先節で紹介した書き込み関数を利用します。

## iOS アプリでの ESC/POS コマンド実装

- コード例を交えた実装手順
- サンプルコードの解説
- エラーハンドリングとデバッグのポイント

## JavaScript OSSを使ったレシート印刷

- 利用する OSS の紹介（例：escpos-printer）
- OSS のインストールと設定
- サンプルコードと実装手順
- iOS と OSS の連携方法
- 応用編：カスタマイズと高度な機能

## レシートのデザインカスタマイズ

- 画像や QR コードの印刷
- 複数のプリンターへの対応
- まとめと今後の展望

## 記事のまとめ

- 今後の技術の発展と応用例
- 参考資料と追加リソース
