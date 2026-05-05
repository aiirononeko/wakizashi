# Wakizashi

極限までミニマルな36キーBLE無線キーボード（revB）。メインキーボードとは別に、常に携えるサブキーボードとして設計。

- **キー数**: 36（3行×12列、論理 6×6 マトリクスに折り畳み）
- **配列**: オーソリニア（格子配列）
- **キーピッチ**: 16mm
- **接続**: BLE無線（USB-Cは充電とファーム書き込み用）
- **MCU**: XIAO nRF52840
- **キースイッチ**: Kailh Choc V2（ホットスワップ対応）
- **電源**: LiPoバッテリー（PicoBlade 1.25mm 2ピン）
- **電池監視**: VBAT 分圧 (R2 2.2MΩ + R3 1MΩ) → P0.31 (AIN7)、BLE HID Battery Service でホスト通知
- **ステータス LED**: SK6812MINI × 1（裏面右奥、SPIM3 駆動）。BLE 接続=青常時、ペアリング待機=青点滅、USB 接続=白、電池低下=赤、緊急=赤点滅、充電中=黄点滅、アイドル時は AO3401A PMOS で VDD ごと遮断
- **ファームウェア**: [RMK](https://github.com/HaoboGu/rmk)（Rust）
- **ケース**: revB ケース一式（topplate / side / spacer / bottomplate、3MF と STEP を収録）

## リポジトリ構成

```
wakizashi/
├── firmware/           RMK ファームウェア（nRF52840）
├── case/               ケース出力データ（3MF / STEP）
├── tools/web-flasher/  ブラウザから書き込む Web Flasher
├── build-guide/        組み立てガイド
└── docs/               運用ドキュメント
```

## ドキュメント

- [組み立てガイド](./build-guide/) — 必要部品 / 組み立て手順
- [ファームウェアの書き込み](./docs/flashing.md) — Web Flasher / UF2 / ローカルビルド
- [リリース運用](./docs/releasing.md) — タグ付け / CI / Pages デプロイ

## ファームウェアの書き込み (概要)

ブラウザから 1 クリックで書き込める [Web Flasher](https://e-sp9.github.io/wakizashi/) を公開している。USB-C でつなげば、自動でブートローダに入り最新ファームを書き込む。詳細と代替手順は [docs/flashing.md](./docs/flashing.md) を参照。

## キーマップ

詳細仕様は [firmware/keyboard.toml](./firmware/keyboard.toml) を参照。ホームロウモッドは廃止し、左右外側の Tab/Ctrl/Shift・BS/Enter/MO2 を直接キー化。コンボ（Q+W=Esc / F+V=Space / J+M=Space / Z+X=LGui / F+D=英数 / J+K=かな）と 3 レイヤー構成（base / lower / raise）。`MO(1)` を押しながら右上端（Backspace 位置）で `Minus` を入力できる。RMK そのものは [RMK ドキュメント](https://rmk.rs/main/docs/) を参照。

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照。
