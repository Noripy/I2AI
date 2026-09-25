# アーキテクチャ

> **この資料の結論**: 発言は「ルール → Jev → Gemini」の順に振り分け、**Jev は判定・Gemini は文章・ルールは保険**という役割で分担する。

## 全体の流れ

### 図1: 振り分けの流れ

```mermaid
flowchart TD
  U["ユーザーの発言"] --> API["POST /api/chat"]
  API --> R{"ルーター<br/>lib/router.ts"}
  R -- "① キーワードで明確" --> I["意図が確定"]
  R -- "② あいまい" --> J["Jev choice<br/>意図 + 確信度"]
  J --> I
  J -. "キー無し・失敗" .-> G["Gemini で分類<br/>enum を JSON Schema で強制"]
  G --> I
  G -. "失敗・キー無し" .-> F["chat にフォールバック"]
  F --> I
  I -- "report / contact / consult / breakdown / chat" --> H["意図別ハンドラー<br/>lib/handlers.ts<br/>AI が上司役で返答 + 確認質問"]
  I -- "analyze" --> S["採点<br/>lib/scoring/analyze.ts"]
  H --> OUT["返答 + ヒント + 質問リスト"]
  S --> OUT2["スコア + フィードバック"]
```

### 図2: 1つの発言が返答になるまで（時系列）

```mermaid
sequenceDiagram
  autonumber
  actor U as ユーザー
  participant C as 画面（Trainer）
  participant A as /api/chat
  participant R as ルーター
  participant J as Jev
  participant G as Gemini
  U->>C: 発言を送信
  C->>A: 会話履歴 + 特性
  A->>R: routeIntent()
  alt キーワードで明確
    R-->>A: 意図（rules）
  else あいまい
    R->>J: choice（6つの意図から選ぶ）
    J-->>R: 意図 + 確信度
    R-->>A: 意図（jev）。確信度60%未満なら ambiguous
  end
  A->>G: 意図別のプロンプトで返答を依頼
  G-->>A: 返答 + ヒント + 質問リスト
  A-->>C: ChatReply
  C-->>U: 返答・ヒント・意図バッジ（確信度つき）
```

## 意図（ルーターの振り分け先）

| intent | 意味 | ハンドラーの動き |
|--------|------|-----------------|
| `report` | 報告 | 結論・現状・見込み・次の行動の抜けを聞き返す |
| `contact` | 連絡 | 5W1H の抜けを聞き返す |
| `consult` | 相談 | すぐ答えず「あなたの案は？期限は？」を引き出す |
| `breakdown` | タスク分解 | 15〜30分単位に分解し、**途中で見せるチェックポイント**を必ず入れる |
| `analyze` | 採点依頼 | 会話全体を採点する |
| `chat` | その他 | 短く応じて報連相の練習に誘導する |

## 役割分担: Jev は判定、Gemini は文章、ルールは保険

### 図3: 3つの判定器と出力の関係

```mermaid
flowchart LR
  T["会話ログ"] --> RU["ルール<br/>即決・保険"]
  T --> JV["Jev<br/>選ぶ・点数・はい/いいえ"]
  T --> GM["Gemini<br/>文章を作る"]
  RU --> N["数値<br/>意図・スコア・答え漏れ"]
  JV --> N
  GM --> W["文章<br/>上司役の返答・フィードバック・言い換え例"]
  GM -. "Jev が無い時だけ" .-> N
```

| | 得意なこと | このアプリでの担当 |
|---|---|---|
| Jev | 選ぶ・点数を付ける・はい/いいえを、**確率つきで・ブレずに・速く安く**返す。文章は作らない | 意図の振り分け、各軸のスコア、質問に答えたかの判定、抱え込みの検出 |
| Gemini | 文脈を読んで**文章を作る** | 上司役の返答、フィードバック文、言い換え例 |
| ルール | 決定的・無料・オフライン | 明確な発言の即決、API 停止時の代替、スコアの安定化（3割） |

LLM に「100点満点で何点？」と聞くと毎回数字が揺れます。Jev は段階評価の**確率分布**を返すので、期待値をそのまま点数にでき、確信度も分かります。

### Jev の確信度を教育に使う

```mermaid
flowchart LR
  M["部下: あの件なんですけど…"] --> J["Jev choice"]
  J --> P["報告 40% / 連絡 35% / 相談 25%"]
  P --> Q{"確信度 60% 以上？"}
  Q -- "はい" --> N["通常のヒント"]
  Q -- "いいえ" --> H["ヒントを差し替え<br/>「最初に『〇〇の報告です』と宣言しよう」"]
```

振り分けで Jev の確信度が 60% 未満だった発言は、「AI でも何の話か迷った＝上司も迷う発言」とみなし、
「最初に『〇〇の報告です』と宣言しましょう」というヒントに差し替えます。

### Jev への問い合わせ内容（採点時・1リクエスト）

| 質問名 | 種類 | 内容 |
|--------|------|------|
| `conclusionFirst` 等5軸 | score（5段階） | 軸ごとのルーブリック（`lib/scoring/jev.ts`）。期待値 ×25 で 0〜100 に換算 |
| `answered_0..n` | noul | 上司の質問と部下の返答の組ごとに「答えているか」。確率の平均が受信力 |
| `hoarding` | noul | 完璧主義・抱え込みのサインがあるか |

相談の発言が無いときは `consultQuality` を聞かない（聞かない軸は「対象外」）。

### 図4: 採点のシーケンス（API 呼び出しは Jev 1回 + Gemini 1回）

```mermaid
sequenceDiagram
  participant A as analyze
  participant RU as ルール
  participant J as Jev
  participant G as Gemini
  A->>RU: scoreByRules()
  RU-->>A: 仮スコア・答え漏れ候補
  A->>J: score×5軸 + noul×質問数 + noul（抱え込み）をまとめて1回
  J-->>A: 確率つきの答え
  Note over A: ルール3 : Jev7 でブレンド<br/>特性の重みで総合点
  A->>G: 確定スコア + 会話（点数は付け直させない）
  G-->>A: できていること・次に伸ばすこと・言い換え例
```

## なぜルールを先に置くのか

### 図5: どこかが止まっても、下の段で必ず受け止める

```mermaid
flowchart TD
  R["ルール（キーワード）"] -- "決まらない" --> J["Jev"]
  J -- "キー無し・障害" --> G["Gemini"]
  G -- "キー無し・障害" --> F["フォールバック<br/>chat 扱い + 定型文"]
  R -- "決まった" --> OK["処理へ"]
  J -- "判定できた" --> OK
  G -- "判定できた" --> OK
  F --> OK
```

1. **API 呼び出しの節約**: 「報告です」「相談させてください」のように明確な発言は API を呼ばずに振り分ける
2. **止まらない**: Jev や Gemini が落ちても、キーが無くても、ルールとモック応答で動き続ける
3. **テストできる**: ルール部分は決定的なので、ユニットテストで品質を守れる

## 受信力（質問への答え漏れ）の仕組み

ハンドラーは返答と一緒に `questions`（AI が聞いた質問の一覧）を返し、クライアントはそれを会話履歴に保存します。
採点時は「AI の質問」と「その直後のユーザー発言」を組にして、Jev の noul で「答えているか」を確率で判定します。
Jev が無いときは、質問のキーワードが含まれているか（「いつ」の質問には日時が含まれているか）で代替します。
過集中で相手の質問を読み飛ばしがちな人向けの軸です。

### 図6: 質問と返答の組で「答えたか」を判定する

```mermaid
flowchart LR
  Q["上司: 締め切りは変わっていない？"] --> P["Q&A の組"]
  A["部下: がんばります"] --> P
  P --> J{"Jev noul<br/>答えている？"}
  J -- "0.1（いいえ寄り）" --> M["答え漏れ<br/>「次に伸ばすこと」に表示"]
  J -- "0.9（はい寄り）" --> OK["答えた"]
  M --> S["受信力 = 各組の確率の平均"]
  OK --> S
```

## ディレクトリ

```
app/
  api/chat/route.ts      入口: ルーター → ハンドラー
  api/analyze/route.ts   「採点する」ボタン用
  page.tsx, layout.tsx
components/
  Trainer.tsx            チャット画面・特性設定・履歴
  ScorePanel.tsx         採点結果
lib/
  router.ts              意図ルーター
  handlers.ts            意図別の処理（プロンプト + モック）
  gemini.ts              Gemini ラッパー（JSON Schema + zod 検証）
  jev.ts                 Jev ラッパー（@typesafe-ai/sdk）
  scoring/rules.ts       ルールベース採点
  scoring/jev.ts         Jev 採点（score / noul を1リクエストで）
  scoring/analyze.ts     ルール + Jev + Gemini の統合採点
  storage.ts             localStorage
  types.ts               型・定数
tests/                   Vitest
```
