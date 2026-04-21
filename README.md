# Wakizashi

極限までミニマルな30キーBLE無線キーボード。メインキーボードとは別に、常に携えるサブキーボードとして設計。

- **キー数**: 30（3行×10列）
- **配列**: オーソリニア（格子配列）
- **キーピッチ**: 16mm
- **接続**: BLE無線（USB-Cは充電とファーム書き込み用）
- **MCU**: XIAO nRF52840
- **キースイッチ**: Kailh Choc V2（ホットスワップ対応）
- **電源**: LiPoバッテリー（JST-PH 2ピン）
- **ファームウェア**: [RMK](https://github.com/HaoboGu/rmk)（Rust）
- **ケース**: 3Dプリント（3ピース構成）

## リポジトリ構成

```
wakizashi/
├── firmware/           RMK ファームウェア（nRF52840）
├── case/               ケース設計仕様（top / side / bottom）
├── tools/web-flasher/  ブラウザから書き込む Web Flasher
├── build-guide/        組み立てガイド
└── docs/               運用ドキュメント
```

## ドキュメント

- [組み立てガイド](./build-guide/) — 必要部品 / 組み立て手順
- [ファームウェアの書き込み](./docs/flashing.md) — Web Flasher / UF2 / ローカルビルド
- [リリース運用](./docs/releasing.md) — タグ付け / CI / Pages デプロイ

## ファームウェアの書き込み (概要)

ブラウザから 1 クリックで書き込める [Web Flasher](https://aiirononeko.github.io/wakizashi/) を公開している。USB-C でつなげば、自動でブートローダに入り最新ファームを書き込む。詳細と代替手順は [docs/flashing.md](./docs/flashing.md) を参照。

## キーマップ

詳細仕様は [firmware/keyboard.toml](./firmware/keyboard.toml) を参照。ホームロウモッド・コンボ（Space / Backspace）・2レイヤー構成。RMK そのものは [RMK ドキュメント](https://haobogu.github.io/rmk/) を参照。

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照。
