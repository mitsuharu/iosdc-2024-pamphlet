# iOS デバイスから始める Bluetooth 制御の業務用サーマルプリンター対応アプリの作り方

<div class="author-info">
江本光晴（株式会社ゆめみ）<BR />
𝕏: @mitsuharu_e<BR />
Bluesky: @mitsuharu.bsky.social
</div>

昨今のペーパーレス化が進む社会でも、サーマル（感熱紙）プリントを見る機会は依然として多いです。iPhone や iPad を利用した POS レジからレシートを受け取った経験があるでしょう。その iPhone からどのようにレシートを印刷しているのか気になったことはありませんか？

印刷といえば iOS には Wi-Fi に接続されたプリンターを制御する AirPrint があります。しかしながら、業務用サーマルプリンターは Wi-Fi 非対応の機種も多く、AirPrint をサポートしていません。サーマルプリンター向けの印刷命令を実行する必要があります。この記事は、iOS デバイスを利用してサーマルプリンターを制御する方法を取り扱います。Bluetooth が利用可能なサーマルプリンターを対象として、接続や印刷する方法を説明します。また JavaScript で作られたレシート印刷に便利な OSS を iOS アプリで実行する方法も紹介します。この記事を読むことで、業務用サーマルプリンター対応アプリの実装方法を理解し、レシートを印刷できるようになります。今すぐにサーマルプリンターを買い求めたくなるでしょう。

### 免責事項および商標について

本記事は、製造メーカーが提供するドキュメントや私が所有する数台の実機から調査・検証した内容をまとめました。製造時期により実機のバージョンやファームウェアは異なる場合があるため、記載どおりにならない場合があります。また、製品名称は各社の商標または登録商標です。™ や ® の表記は省略します。

## 開発環境

開発環境は MacBook Pro 14 インチ 2021、Apple M1 Pro、macOS Sonoma 14.5 を用いて、Xcode 15.4 (15F31d) で開発しました。検証機として iPhone SE（第３世代）、iOS 17.5.1 を利用しました。

### 対象のサーマルプリンターについて

本記事で対象するとサーマルプリンターは SUNMI が製造する「SUNMI 58mm Cloud Printer」です。58mm 幅の感熱紙を印刷できるサーマルプリンターです。無線のインタフェースとして Wi-Fi 4（2.4GHz）と Bluetooth 4.2 BLE を備えています。この機種の Bluetooth を利用して、サーマルプリンターを制御します。なお、私が所持する機種のモデルおよびソフトウェアバージョンは次のとおりです。

| Model | Firmware version | SUNMI APP version | Partner APP version | MiniApp version |
| :--: | :-: | :-: | :-: | :-: |
| <div class="no-break">NT212_S</div> | 2.1.0 | 2.2.0 | 1.0.10 | 0.0.1 |

その他に、80mm 幅に対応した兄弟機「SUNMI 80mm Kitchen Cloud Printer」、セイコーエプソン（以降、エプソン）のモバイル機「TM-P20II」を所有しています。これらでも動作確認を行なっています。

## サーマルプリンターのページ記述言語

ページ記述言語はプリンターに対して印刷を指示するためのプログラミング言語です。アドビが開発した PostScript が有名です。その他のページ記述言語として、エプソンが開発した ESC/P（Epson Standard Code for Printers）があります。ドットインパクトプリンタが主流だった時代には、多くのメーカーがサポートしていました。その ESC/P のバリエーションの１つとして、POS 端末に採用されたサーマルプリンターを制御する ESC/POS があります。この言語は現在も多くのサーマルプリンターでサポートされています。私が所有している３台のサーマルプリンターも ESC/POS をサポートしています。つまり、この ESC/POS の命令（コマンド）を利用すれば、サーマルプリンターで印刷できます。

### ESC/POS コマンド

ESC/POS は、プリンターに送信されるコマンド（16 進数のバイトコード列）です。そのコマンドを組み合わせて、さまざまな印刷パターンを制御します。たとえば、次のようなコマンドがあります。

| コマンド | 説明 | コード |
| :-- | :-- | :-- |
| ESC @ | プリンターを初期化する | 1b 40 |
| LF | 改行する | 0a |
| <div class="no-break">ESC E n</div> | n=1のとき太字にする | 太字オン 1b 45 01 <br/> 太字オフ 1b 45 00 |

例として、太字の「**Hello World**」を印刷するコマンドを考えましょう。「Hello World」の ASCII コードは `48 65 6c 6c 6f 20 57 6f 72 6c 64` になるので、次のようなコマンドになります。

```hex
1b 40                             // 初期化
1b 45 01                          // 太字オン
48 65 6c 6c 6f 20 57 6f 72 6c 64  // Hello World
0a                                // 改行
```

このコマンドをサーマルプリンターに渡せば「**Hello World**」が印刷されます。これを実現するため、iPhone でサーマルプリンターを制御する方法を紹介していきます。

## Bluetooth による制御方法

CoreBluetooth を用いて、サーマルプリンターを制御します。私はライブラリ AsyncBluetooth [^AsyncBluetooth] を採用しました。CoreBluetooth が提供する API は Delegate を多用するため、コードは複雑になります。一方、AsyncBluetooth は Swift Concurrency でシンプルに書けます。それを利用して、サーマルプリンターを接続および制御する方法を紹介します。ソースコードは紙面の都合上、簡略表示します。実際にソースコードを書く際は付録する GitHub リポジトリを参照してください。なお、Bluetooth を利用するので、Info.plist に許可設定と利用理由を忘れずに追加しましょう。

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Use to connect with thermal printers</string>
```

<!-- textlint-disable -->
[^AsyncBluetooth]: https://github.com/manolofdez/AsyncBluetooth
<!-- textlint-enable -->

まず最初に Bluetooth 機器のスキャンを行い、サーマルプリンターを探します。対象のサーマルプリンターは `CloudPrint_{数字}` という名前が設定されているので、その名前が付けられた機種を選択して接続します。例ではスキャンされた機器の名前を逐次確認して選択しましたが、一般には検出された機種を一覧表示して、目視確認してから選択するとよいでしょう。

```swift
import AsyncBluetooth

let manager = CentralManager()

try await manager.waitUntilReady()

let stream = try await manager.scanForPeripherals(withServices: nil)
for await scanData in stream {
    if let name = scanData.peripheral.name, name.contains("CloudPrint") {
      try await manager.connect(scanData.peripheral, options: nil)
      await manager.stopScan()
    }
}
```

接続した Peripheral から、印刷に関するサービス（serviceUUID）および、そのサービスのデータ構造のキャラクタリスティック（characteristicUUID）を取得します。今回はデータ送信するため、書き込み可能なキャラクタリスティックを選択します。例では、単純に条件に合う最初の組み合わせを選択してますが、実際は機種のドキュメントを確認して、適切な組み合わせを選択してください。

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
func send(data: Data) async throws {
  try await peripheral.writeValue(
    data,
    forCharacteristicWithUUID: characteristicUUID,
    ofServiceWithUUID: serviceUUID
  )
}
```

## iOS アプリで ESC/POS コマンドを実装する

先例で挙げた「**Hello World**」を印刷するコマンドを、前節の Bluetooth の制御関数で実行させましょう。

```swift
var command = Data()
command.append(contentsOf: [0x1b, 0x40]) // 初期化
command.append(contentsOf: [0x1b, 0x45, 0x01]) // 太字オン
command.append(contentsOf: [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 
                            0x57, 0x6f, 0x72, 0x6c, 0x64]) // Hello World
command.append(contentsOf: [0x0a]) // 改行

try send(data: command)
```

印刷用コマンドを直接送ると聞くと、難しい印象がありますが、簡単なコードで印刷できます。なお、一度に書き込めるデータのサイズに上限があるので、その上限サイズを調べて、データを分割して書き込みます。

```swift
// これで上限値が取得できるが、値は適切ではない（値が大きく、印刷失敗する）
// 実際のアプリでは、適当な固定値を設定しました
let mtuSize = peripheral.maximumWriteValueLength(for: .withResponse)
```

上記の例は直接コマンドを書いているため、可読性は悪いです。一例ですが、実際にコーディングする際は enum で印刷命令を定義して、それに対応するコマンドを返すと可読性は保たれるでしょう。

```swift
enum PrintOrder {
  case bold(isBold: Bool)

  func command() -> Data {
    switch self {
    case .bold(let isBold):
      return Data([0x1b, 0x45, isBold ? 0x01 : 0x00])
    }
  }
}
```

先例で挙げたコマンド以外に、レシートを印刷する際に便利な ESC/POS コマンドのいくつかを Swift のコード実装と共に紹介していきます。なお、今回はコマンドを簡単に説明します。詳細はメーカーが提供するドキュメント [^sunmi-esc-pos-command] を確認してください。

[^sunmi-esc-pos-command]: https://developer.sunmi.com/docs/en-US/xeghjk491/ciqeghjk513

### 日本語

例では英字を印刷しましたが、日本語も印刷できます。私が保持しているサーマルプリンターは ShiftJIS でエンコードしたものを指定します。

```swift
var command = Data()
if let textData = text.data(using: .shiftJIS) {
  command.append(textData)
}
return command
```

### フィード（紙送り）

印刷した直後の用紙位置はサーマルヘッドの位置のままなので、適度に紙送りをします。改行コードの `0a` で代用できますが、複数行分の紙送りをするので専用のコマンドを利用するとよいです。

| コマンド | 説明 | コード |
| :-- | :-- | :-- |
| <div class="no-break">ESC d n</div> | n行の紙送りをする | 1b 64 n |

```swift
return Data([0x1b, 0x64, UInt8(n)]) // n は自然数
```

### 文字サイズ

文字のサイズを指定します。絶対値ではなく倍率（1 ~ 8 倍）を指定します。縦横それぞれの倍率はビットマクスを利用して、１つの値でそれぞれの倍率を指定します。分かりにくい指定方法が出てきましたね…。

| コマンド | 説明 | コード |
| :-- | :-- | :-- |
| <div class="no-break">GS ! n</div> | 縦横最大8倍<br/>n のビットの0-3が横、4-7が縦の倍率 | 1d 21 n |

```swift
let widthScale = UInt8(16 * (width - 1))  // width は 1 ~ 8 の範囲
let heightScale = UInt8(height - 1)       // height は 1 ~ 8 の範囲
return Data([0x1d, 0x21, widthScale + heightScale])
```

### 画像

二値画像を印刷します。コマンドで、画像印刷用の命令、横と縦のサイズ、そして画像情報のバイトコード列を指定していきます。

| コマンド | 説明 | コード |
| :-- | :-- | :-- |
| <div class="no-break">GS v 0 m xL xH yL yH d1....dk</div> | 二値画像を印刷する | 1d 76 30 m xL xH yL yH d1....dk |

m は印刷モードを指定します。xL、xH、yL、yH は画像サイズで、次の式を満たす値です。横サイズは 1byte で 8 つ分の画像情報を表現するので、実際の横サイズとは異なります。

```swift
width = (xL + xH * 256) * 8
height = (xL + xH * 256)
```

d は画像データです。1bit ごとに画像情報（0 or 1）を表現する 1bit Bitmap です。たとえば、n 番目の画像情報を `c(n)` とすると、i 番目の d は次のように設定します。i は `0 ~ (width * height)/8` の自然数です。なお、横サイズが 8 の倍数でなければ 0 を埋めておきます。

```swift
d[i] = c(i*8+0) << 7 | c(i*8+1) << 6 | c(i*8+2) << 5 | c(i*8+3) << 4
       | c(i*8+4)<< 3 | c(i*8+5) << 2 | c(i*8+6) << 1 | c(i*8+7)
```

以上からコマンドを作成します。紙面の都合上、画像変換の関数の実装紹介は省略します（付録を参照してください）。なお、私はビットマクスを日常的には使わない、画像変換も久々にやったので、なかなか上手くいかず試行錯誤しました。難しいです…。誤って画像じゃなくて画像データを延々と印刷しちゃった。わァ…

```swift
let m = UInt8(0)  // 標準モード
let xL = UInt8((width / 8) % 256)
let xH = UInt8((width / 8) / 256)
let yL = UInt8(height % 256)
let yL = UInt8(height / 256)
let imageData: [UInt8] = convert1BitBitmap(image)
return Data([0x1d, 0x76, 0x30, m, xL, xH, yL, yH] + imageData)
```

### 他プラットフォームにおける ESC/POS コマンド

ESC/POS はページ記述言語なので、iOS には依存していません。もちろん他プラットフォームでも利用できます。Bluetooth の制御関数を用意できれば Kotlin や JavaScript でも利用できます。好きな言語や環境で試してみてください。

```kotlin
// Kotlin
val bold = byteArrayOf(0x1b, 0x45, if (isBold) 0x01 else 0x00)
send(bold)
```

```javascript
// JavaScript
const bold = new Uint8Array([0x1B, 0x45, isBold ? 0x01 : 0x00]);
send(bold);
```

## ESC/POS コマンドの問題と対応

前節で ESC/POS コマンドを利用した印刷方法を紹介しました。一部で難しいコマンド設定がありましたが、一度作ってしまえば、他プラットフォームでも利用できるということで、移植性も容易です。とてもよいですね…といいたいところですが、重大な問題があります。ESC/POS コマンドはメーカーごとに一部のコマンドが異なっています。いわゆる方言がメーカーそれぞれにあります。たとえば、先ほど紹介した画像印刷ですが、エプソンのサーマルプリンターでは利用できません。エプソン版では、まず画像データをプリンターにキャッシュするコマンドを実行してから、そのキャッシュを印刷するという二段階で画像を印刷します。

我々 iOS アプリエンジニアは（バージョンで差異はありますが）１つの Swift で開発しているので、環境それぞれでコマンドが異なるのは衝撃的です。それを知ると、バイトコードは低レイヤーで複雑だし書きづらい、ESC/POS コマンドは書きたくない！と手のひらを返します。しかし、捨てる神あれば拾う神あり、この問題を解決するレシート印刷に便利な OSS が存在します。

### ReceiptLine

ReceiptLine は、小型ロール紙の出力イメージを表現するレシート記述言語の OSS です [^receiptline-web] 。マークダウンでレシートを書いて、そのマークダウンを ESC/POS コマンドに変換してくれます。コマンドの記述は複雑なのでマークダウンで書けるのは便利ですね。また、先ほどメーカーごとに異なると書きましたが、この ReceiptLine は ESC/POS コマンドの他に、SVG でも出力できます。SVG はアプリ内で画像に変換できるので、画像印刷さえコマンドで準備したら印刷できます。よかったね！といいたいところですが、今回も問題があります。この ReceiptLine は JavaScript で作られており、Swift への移植はありません。

[^receiptline-web]: https://www.ofsc.or.jp/receiptline_/
[^receiptline-github]: https://github.com/receiptline/receiptline

### JavaScript のライブラリを iOS で動かす

Swift 移植版を作りたいが難しいと詰んだところに、一筋の光明が差す。iOS は JavaScriptCore を持っているので、JavaScript のライブラリを実行できます。準備として、その ReceiptLine を手元に用意します。

```bash
mkdir js-packages
cd js-packages
yarn init
yarn add receiptline
```

この用意した Receiptline をすぐに読み込みたいところですが、JavaScript のファイル構成や他ライブラリ依存性の問題で簡単には読み込めません。そこで、webpack [^webpack] を利用して、読み込みやすい形に作成します。まず、JavaScript のブリッヂとなるクラスで ReceiptLine を関数定義します。

[^webpack]: https://webpack.js.org/

```javascript
import { transform } from "receiptline"

export class Bridge {
    static transformSvg(doc) {
        const display = {
            cpl: 42,
            encoding: 'multilingual'
        }
        const svg = transform(doc, display)
        return svg
    }
}
```

このブリッヂファイルから webpack の設定ファイルに基づいて、バンドルファイルを生成します。設定ファイルの記述に関しては省略します。サンプルリポジトリ [^UseJavaScriptPackages-github] を参照してください。生成されたバンドルファイルを `bundle.js` とします。

```bash
yarn add -D webpack webpack-cli
yarn webpack
```

バンドルファイルを iOS アプリのプロジェクトに追加します。フレームワーク JavaScriptCore を import して、JSContext でそのファイルを読み込みます。

```swift
import JavaScriptCore

guard
    let path = Bundle.main.path(forResource: "bundle.js", ofType: nil),
    let contents = try? String(contentsOfFile: path)
else {
    throw Error()
}

let context: JSContext = JSContext(virtualMachine: JSVirtualMachine())
context.evaluateScript(contents)
```

この context に対して webpack で設定したモジュール名や関数名を頼りに関数を取得して、実行します。これらの詳細は先日の勉強会で発表したので、そのスライド [^UseJavaScriptPackages-slide] を参照してください。

```swift
let module = context.objectForKeyedSubscript("Module")
let bridge = module?.objectForKeyedSubscript("Bridge")
let transformSvg = bridge?.objectForKeyedSubscript("transformSvg")
let svg = transformSvg?.call(withArguments: [markdownText])
```

[^UseJavaScriptPackages-github]: https://github.com/mitsuharu/UseJavaScriptPackages
[^UseJavaScriptPackages-slide]: https://speakerdeck.com/mitsuharu/2024-05-17-javascript-multiplatform

### （おまけ）SVG を画像化する

WKWebView の `takeSnapshot(with:completionHandler:)` を利用すれば SVG を簡単に画像化できます。その生成した画像を ESC/POS コマンドで印刷しましょう。

## まとめ

ESC/POS コマンドを利用して、iPhone でサーマルプリンターを制御する方法を紹介しました。正直なところ、もしメーカーが SDK を公開していたら、その SDK を利用する方がよいです。私が所有している SUNMI のサーマルプリンターには SDK がありますが、ファームウェアのバージョンが動作要件を満たしてないため非対応でした。ESC/POS コマンドを利用するしかありませんでした。なお、エプソンのサーマルプリンターには SDK があります。SDK の有無で開発を比べると、エプソンの方が開発体験は圧倒的によかったです。では「どうして今回 ESC/POS コマンドを取り上げたの？」ですが、単純に面白いからです。

今回紹介した内容をもとに開発している印刷アプリの GitHub リポジトリを付録します。現在も開発中のため、ソースコードは変更される場合があります。ご了承ください。よいサーマルプリンターライフを！ [^iosdc-2024-pamphlet]

```url
https://github.com/mitsuharu/Calliope
```

[^iosdc-2024-pamphlet]: この記事は https://github.com/mitsuharu/iosdc-2024-pamphlet でも公開しています
