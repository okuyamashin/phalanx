# Phalanx

盾を並べて守り、号令で一斉に突く。古代ギリシャの重装歩兵の密集隊形（ファランクス）が、ペルシャの盾兵と押し合うブラウザゲームです。

**▶ 遊ぶ：https://okuyamashin.github.io/phalanx/**

パソコンでもスマホでも動きます。スマホは横向きがおすすめです。

## 遊び方

| 操作 | 動き |
|---|---|
| スペースキー / タップ | 隊全体で一斉に突く |
| 何もしない | ずっと盾で守る |
| R キー | 最初からやり直す |

- 足元が**赤く光る敵**は攻撃の構え中。スキはあるが、攻撃が来る。
- 足元が**金色に光る敵**は攻撃のあとの戻り中。狙いどき。
- 盾を構えた敵を突くと弾かれ、反撃されることがある。突いている間は無防備。
- 画面上の11個の丸は、手前から奥までの各列の敵の様子（赤・金）。手前の兵に隠れて見えない列もここで分かる。
- 守ってばかりいると敵の増援が増え、じわじわ押し下げられる。
- 敵を崖まで押し切れば **ΝΙΚΗ**（勝利）。崖まで押されるか、隊が尽きれば **ΗΤΤΑ**（敗北）。

### スマホをコントローラーにする

1. パソコンで本編（**https://okuyamashin.github.io/phalanx/**）を開く
2. 右下の QR コードをスマホで読む（スマホに大きな丸いボタンが出る）
3. あとはスマホのボタンがスペースキーと同じ働きをする
4. パソコンの左下に「♪ CLICK」が出ていたら、パソコンの画面を一度クリックすると音が出る（ブラウザは、その画面で一度操作するまで音を出させないため）

**突き出しでも突ける**：スマホの画面を上にして平らに持ち、前に突き出すとボタンと同じく突きます。平らにすると上の ◎ とボタンの縁が金色に光ります（iPhone は最初にボタンを押したときにセンサーの許可を求めます）。反応の強さは `pad.html?debug` で確かめ、`?jab=10` のように変えられます。

**声でも突ける**：スマホに向かって「えい！」と短く強く言うと突きます（言葉は聞き分けず、急に大きな声が入った瞬間を合図にするので遅れません）。最初にボタンを押したときにマイクの許可を求め、使えると上にマイクの印が出ます。反応する声の大きさは `?voice=0.05` のように変えられます。

パソコンとスマホは同じ Wi-Fi につないでください。携帯回線では、つながらないことがあります。スマホの上の点が緑ならつながっています（横の数字は往復の時間）。✕ はつながっていない印で、裏でつなぎ直しを続けます。

画面の数字はギリシャ数字（イオニア式：Αʹ=1、Ιʹ=10、Ρʹ=100）です。左上が味方の残り、右上が敵の残りです。

### Bluetooth のアプリで遊ぶ（Mac × Android）

インターネットを通らず、Bluetooth だけでスマホと Mac をつなぐ版です。Mac アプリ（画面）と Android アプリ（コントローラー）を自分でビルドして使います。どちらも中身は WebView で、`ble.html` と `ble-pad.html` を公開サイトから読み込みます。

1. Android で「Phalanx Pad」を開く（Bluetooth とマイクを許可する）
2. Mac で「Phalanx」を開くと、右下に近くのコントローラーが出る。電波の強い順に並び、近いものには「近い」が付く
3. リストで選ぶとつながり、スマホの上に緑の点と「Bluetooth」が出る。あとは Web 版と同じく、ボタン・突き出し・声で突ける

**つながらないとき**：Mac とスマホが以前に Bluetooth でペアリングしていると、Mac が古い鍵で暗号化しようとして失敗し、つなぎ込みを受け付けなくなることがあります。両方の Bluetooth の設定で、相手のペアリングを解除してください。

## ルールの細かいところ

- 味方は横一列11人。倒れると、後ろの予備兵が前に出て埋める。
- 敵は一人ずつバラバラのタイミングで「守り → 構え → 攻撃 → 戻り」を繰り返す。
- 盾は左手に持つので、自分の盾は左隣を守る。右隣が空くと、守っていても危なくなる。
- 一度突かれた敵はしばらく盾を固めるので、連打は通じない。

## ページ

| ファイル | 内容 |
|---|---|
| `index.html` | **本編**。AIで描いた兵士の絵をコマ送りで動かす疑似3D版。描画は [PixiJS](https://pixijs.com/) 7.4.2（WebGL、MIT ライセンス、CDN から読み込み）。右下の QR コードからスマホをコントローラーにできる |
| `remote.html` | 以前のスマホ操作版の URL。トップページへ移動する |
| `pad.html` | スマホで開くコントローラー（ボタン1つ。平らにして突き出しても、声でも突ける） |
| `ble.html` | 本編のコピーで、Mac アプリの中で動く版（Bluetooth の合図を受ける） |
| `ble-pad.html` | `pad.html` のコピーで、Android アプリの中で動くコントローラー |
| `proto2d.html` | 最初に作った2Dの試作（上から見た図） |
| `game.html` | 以前の本編のURL。トップページへ移動する |
| `3d.html` | Three.js で作った3Dの試作 |
| `sprites.html` | 兵士の絵の動きを確認するページ（スペース：突く、D／E：味方／敵が倒れる、A：自動） |

## 手元で動かす

`index.html` などは ES モジュールと素材ファイルを読み込むので、ファイルを直接開くのではなく、ローカルサーバー経由で開いてください。

```bash
python3 -m http.server 8000
```

そのあと `http://localhost:8000/` を開きます。

## ファイル構成

```
src/game.js          ゲームのルール（描画や入力から独立）
src/link.js          スマホとパソコンをつなぐ部品（WebRTC、PeerJS）
src/motion.js        スマホの動きのセンサーで「平らにして突き出す」を見分ける部品
src/voice.js         スマホのマイクで、短く強い声を見分ける部品
index.html           本編の描画・演出・入力（スマホとは WebRTC でつなぐ）
pad.html             スマホで開くコントローラー（WebRTC）
ble.html, ble-pad.html アプリ版のゲーム画面とコントローラー（Bluetooth）
apps/
  mac/               Mac アプリ（SwiftUI、CoreBluetooth）
  android/           Android アプリ（Kotlin、外部ライブラリなし）
assets/
  sprites/           兵士のコマ（hoplite = 味方、persian = 敵）と、元の緑背景のシート（raw/）
  screens/           タイトル・勝敗の絵（raw/ に元のPNG）
  textures/          地面のテクスチャ
  sounds/            効果音
  music/             タイトル・勝敗の曲
  concept/           設定画・キービジュアル
tools/make_sprites.py  緑背景のシートを切り分けてスプライトを作るスクリプト
```

スプライトを作り直すとき：

```bash
python3 tools/make_sprites.py            # すべて
python3 tools/make_sprites.py persian    # 敵だけ
```

## アプリをビルドする

**Mac アプリ**（Xcode が必要。自分の Mac で動かすための署名だけを使うので、開発者登録は要りません）

```bash
cd apps/mac
xcodebuild -project Phalanx.xcodeproj -scheme Phalanx -configuration Debug -derivedDataPath build build
open build/Build/Products/Debug/Phalanx.app
```

開発中に手元のサーバーのページを読むときは `open … --args -url http://localhost:8000/ble.html`。`-autoconnect "Pixel 4 XL"` を足すと、その名前のコントローラーに自動でつなぎます。動きの記録は `~/Library/Containers/jp.engawa.phalanx/Data/Library/Application Support/phalanx.log` に残ります。

**Android アプリ**（Android 12 以上。JDK 17 以上と Android SDK が必要。スマホは USB デバッグを有効にしてつなぐ）

```bash
cd apps/android
./gradlew installDebug
```

開発中に手元のサーバーのページを読むときは、`adb reverse tcp:8000 tcp:8000` のあと `adb shell am start -n jp.engawa.phalanx/.MainActivity --es url http://localhost:8000/ble-pad.html`。

Bluetooth の約束事（サービスと特性の UUID）は、`apps/android/.../PadServer.kt` と `apps/mac/Phalanx/Central.swift` の両方に同じ値で書いています。

ゲームのルールは `src/game.js` にまとめ、見た目（2D・3D・スプライト）や入力（キーボード・タップ）と分けています。将来スマホのセンサーで操作するときも、ルールはそのまま使えます。

## 素材と出典

| 素材 | 出典 | ライセンス |
|---|---|---|
| 兵士のスプライト、タイトル・勝敗の絵、設定画 | 作者が ChatGPT と Gemini で生成し、加工したもの | 各サービスの利用規約に従う |
| 地面（`assets/textures/`） | [Poly Haven: Rocky Terrain 02](https://polyhaven.com/a/rocky_terrain_02)（Amal Kumar）を色調整 | CC0 |
| 効果音（`assets/sounds/`） | [Kenney](https://kenney.nl) の Impact Sounds・RPG Audio | CC0 |
| タイトル・勝敗の曲（`assets/music/`） | 作者が Suno（有料プラン）で作曲 | 作者に帰属 |
| 通信（`src/link.js`） | [PeerJS](https://peerjs.com/) 1.5.5（CDN から読み込み）。最初のつなぎ込みに無料の PeerJS Cloud を使う | MIT |
| QR コード | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4（Kazuhiko Arase、CDN から読み込み） | MIT |
| 太鼓などの一部の音 | ブラウザ上でプログラムで合成 | MIT（コードの一部） |

素材ごとの詳しい出典は、各フォルダの README に書いています。

## 今後の予定

- スマホの加速度センサーで、守りと無防備も表す（立てる＝守り、その中間＝無防備）。今は「平らにして突き出す＝突き」だけ

## ライセンス

コードは [MIT](LICENSE) です。素材のライセンスは上の「素材と出典」のとおりです。
