# City League Analytics v5.0.1

## 主な変更

元の約79MBのCSVを、分析に必要な項目だけを持つ事前計算済みCSVへ変換しました。

- 元テキストを削除
- 取得日時、デッキ名、デッキコードを削除
- 開催都道府県を事前計算
- 獲得CSPを事前計算
- シティ年度を事前計算
- カテゴリを「オープン・シニア・ジュニア」に正規化
- 集計用の重複・一覧行を除外

`data/cityleague_results.csv` は約26MBです。元CSVの約79MBから大幅に縮小しています。
年度別CSVも同梱していますが、v5.0.1の画面は全年度版CSVを使用します。

## GitHubへの更新方法

ZIP内のファイルをすべて上書きしてください。
今回は `data/cityleague_results.csv` もv5用へ置き換える必要があります。

年度別CSV:

- data/cityleague_results_2026.csv
- data/cityleague_results_2025.csv
- data/cityleague_results_2024.csv
- data/cityleague_results_2023.csv
- data/manifest.json

## 今後データを更新する場合

元データをそのままサイトへ置かず、`convert_v5.py` を実行してv5用CSVを生成してください。
