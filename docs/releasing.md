# リリース運用

Wakizashi のファームウェアリリースは `main` への `firmware/` 変更マージを起点に自動化されている。手動で操作が必要になるのはメジャー / マイナーバージョンを上げるときだけ。

## 自動化フロー

```
firmware/ の変更が main にマージ
    │
    ▼  .github/workflows/auto-tag.yml
直近の v* タグから patch を +1 して新しいタグを push
    │
    ▼  .github/workflows/firmware.yml  (on push tags: 'v*')
UF2 / HEX / DFU zip をビルドして GitHub Release を作成
    │
    ▼  .github/workflows/pages.yml  (on release: published)
最新ファームを Web Flasher に同梱して GitHub Pages を再デプロイ
```

`firmware/` に触れない変更 (`tools/`, `case/`, `docs/`, `README.md` 等) は auto-tag の対象外なので、何度マージしてもタグは増えない。

## 日常のリリース: 何もしない

`firmware/` を変更した PR を `main` にマージするだけでよい。上記のフローがすべて走り、数分後には最新ビルドが [Web Flasher](https://e-sp9.github.io/wakizashi/) と [Releases](https://github.com/e-sp9/wakizashi/releases/latest) の両方で配布される。

## メジャー / マイナーを上げる: 手動

セマンティックバージョニングの意図を明示するため、patch 以外のバンプは手動で切る。

```sh
# 例: 破壊的変更で v1.0.0 に上げる
git tag v1.0.0
git push origin v1.0.0
```

タグ push 後は `firmware.yml` と `pages.yml` が自動で走って Release と Pages が更新される。

### auto-tag より先に手動でタグを切ってしまった場合

auto-tag は「HEAD にすでにタグがあれば skip」する判定を入れてあるので、手動タグの後に `firmware/` 変更を含む push が来ても重ねてタグは切られない。

### auto-tag が先に patch を切ってしまった場合

タグは同一コミットに複数付けられる。意図より小さなバンプが先に切られた場合、そのまま意図したバンプのタグを重ねて切れば、新しい Release はそちらで公開される (Release 本体は最新タグに紐づく)。必要であれば古いタグ / Release を削除して整理する。

## 手動実行

Actions タブから各 workflow を `Run workflow` で個別に動かせる。

- **Auto-tag firmware release** — `bump` (patch/minor/major) を選んで手動タグ付けできる。
- **Build firmware** — `workflow_dispatch` でビルド単体 (Release 添付は v* タグ push 時のみ)。
- **Deploy web flasher** — ファームを更新せず Pages だけ再デプロイ。

## ワークフローの責任範囲

| Workflow | トリガ | 仕事 |
|---|---|---|
| `auto-tag.yml` | `push` to main (firmware/ 変更時) / 手動 | 次のタグを決めて push するだけ |
| `firmware.yml` | 全 push / PR / `v*` タグ / 手動 | ビルド + アーティファクト保存。タグ push 時は Release 添付 |
| `pages.yml` | `push` to main (tools/web-flasher/ 変更時) / `release: published` / 手動 | Web Flasher + 最新ファームを Pages にデプロイ |
