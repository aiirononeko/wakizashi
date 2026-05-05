# ファームウェアの書き込み

書き込み方法は 3 通り。いずれも USB-C ケーブル (データ通信対応) での PC 接続が必要。

## 1. Web Flasher (推奨)

ブラウザだけで最新ファームを書き込める。Chrome / Edge / Opera の最新版に対応。

👉 **[https://e-sp9.github.io/wakizashi/](https://e-sp9.github.io/wakizashi/)**

1. 「最新ファームを取得」— GitHub Releases から最新 DFU パッケージを同一オリジンで読み込む
2. 「キーボードを選択して再起動」— WebHID でキーボードを選ぶと、Vial の `BootloaderJump` コマンドで自動的にブートローダへ再起動
3. 「シリアルポートを選んで書き込み」— WebSerial でブートローダの CDC ポートを選ぶと、Nordic Legacy DFU で書き込みが始まる

ブラウザと仕組みの詳細は [tools/web-flasher/](../tools/web-flasher/) のソースを参照。

## 2. UF2 ドラッグ & ドロップ

Web Flasher が使えない環境でのフォールバック。

1. キーボードのリセットボタンを素早く 2 回押してブートローダモードに入る (PC 上に `XIAO-SENSE` などの USB ドライブが出現)
2. [Releases](https://github.com/e-sp9/wakizashi/releases/latest) から `wakizashi.uf2` をダウンロード
3. ダウンロードした `.uf2` をドライブにコピー — 自動的に書き込まれて再起動する

## 3. ローカルビルドから書き込み

ファームを改造したとき用。

### 環境セットアップ

- Rust toolchain (`rust-toolchain.toml` で固定)
- [`cargo-make`](https://github.com/sagiegurari/cargo-make)
- `cargo-binutils`, [`cargo-hex-to-uf2`](https://github.com/haobogu/cargo-hex-to-uf2) (Makefile.toml の中でインストール / 呼び出し)
- 任意: `adafruit-nrfutil` (`pip install adafruit-nrfutil`)

### UF2 を生成してドラッグ & ドロップ

```sh
cd firmware
cargo make uf2
# 生成された firmware/wakizashi.uf2 を UF2 と同じ手順でドライブにコピー
```

### adafruit-nrfutil で CDC DFU 書き込み

```sh
cd firmware
cargo make hex
adafruit-nrfutil dfu genpkg --dev-type 0x0052 --application wakizashi.hex wakizashi-dfu.zip
# Linux/macOS 例。Windows は COMn を指定
adafruit-nrfutil dfu serial --package wakizashi-dfu.zip -p /dev/ttyACM0 -b 115200
```

## トラブルシュート

| 症状 | 対処 |
|---|---|
| PC に USB デバイスとして見えない | ケーブルがデータ通信対応か確認 (充電専用ケーブルでは不可) |
| ブートローダに入れない | XIAO 本体のリセットボタンを **素早く 2 回** 押す（revB は外付けリセットスイッチを撤廃、ケース開口から XIAO 内蔵ボタンを直接押す）。LED が流れるように点滅したらブートローダ |
| Web Flasher の「シリアルポート選択」ダイアログに候補が出ない | キーボードがブートローダモードになっていない。手動で 2 回リセット |
| 書き込み後にキーボードが動かない | 再びブートローダに入り、[過去のリリース](https://github.com/e-sp9/wakizashi/releases) の `wakizashi.uf2` で復旧できる |
| Web Flasher の書き込みが `START_DFU` で止まる | ブラウザをハードリロード → 別のケーブル / ポートで再試行 |

詳細なログを追うときは、Web Flasher を開いて DevTools → Console を見る。`[dfu]` プレフィックスで TX/RX バイトが出力される。
