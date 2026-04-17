# Wakizashi

極限までミニマルな30キーBLE無線キーボード。メインキーボードとは別に、常に携えるサブキーボードとして設計。

- **キー数**: 30（3行×10列）
- **配列**: オーソリニア（格子配列）
- **キーピッチ**: 16mm
- **接続**: BLE無線（USB-Cは充電専用）
- **MCU**: XIAO nRF52840
- **キースイッチ**: Kailh Choc V2（ホットスワップ対応）
- **電源**: LiPoバッテリー（JST-PH 2ピン）
- **ファームウェア**: [RMK](https://github.com/HaoboGu/rmk)（Rust）
- **ケース**: 3Dプリント（3ピース構成）

## リポジトリ構成

```
wakizashi/
├── firmware/       RMK ファームウェア（nRF52840）
├── case/           ケース設計仕様（top / side / bottom）
└── build-guide/    組み立てガイド
```

## ビルドガイド

組み立て手順・必要部品・書き込み手順は [build-guide/](./build-guide/) を参照。

## ファームウェアの書き込み

前提: Rust toolchain、`cargo-make`、`probe-rs` または UF2 書き込み環境。

```sh
cd firmware
cargo make uf2
```

生成された `.uf2` ファイルを、XIAO nRF52840 をブートローダモード（リセット2回押し）で接続したドライブにコピーする。

詳細は [firmware/README](./firmware/) および [RMK ドキュメント](https://haobogu.github.io/rmk/) を参照。

## キーマップ

詳細仕様は [firmware/keyboard.toml](./firmware/keyboard.toml) を参照。ホームロウモッド・コンボ（Space / Backspace）・2レイヤー構成。

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照。
