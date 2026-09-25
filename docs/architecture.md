# アーキテクチャ

## 全体の流れ

```mermaid
flowchart TD
  U[ユーザーの発言] --> API[/api/chat]
  API --> R{ルーター<br/>lib/router.ts}
  R -- "① キーワードで明確" --> I[意図が確定]
  R -- "② あいまい" --> G[Gemini で分類<br/>enum を JSON Schema で強制]
  G --> I
  G -. "失敗・キー無し" .-> F[chat にフォールバック]
  F --> I
  I -->|report / contact / consult / breakdown / chat| H[意図別ハンドラー<br/>lib/handlers.ts<br/>AI が上司役で返答 + 確認質問]
  I -->|analyze| S[採点<br/>lib/scoring/analyze.ts]
  H --> OUT[返答 + ヒント + 質問リスト]
  S --> OUT2[スコア + フィードバック]
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

## なぜ「ルール → Gemini」の2段なのか

1. **無料枠の節約**: 「報告です」「相談させてください」のように明確な発言は Gemini を呼ばずに振り分ける。1発言あたりの API 呼び出しを1回に抑えられる
2. **止まらない**: Gemini が落ちても、キーが無くても、ルールとモック応答で動き続ける
3. **テストできる**: ルール部分は決定的なので、ユニットテストで品質を守れる

## 受信力（質問への答え漏れ）の仕組み

ハンドラーは返答と一緒に `questions`（AI が聞いた質問の一覧）を返し、クライアントはそれを会話履歴に保存します。
採点時は「AI の質問」と「その直後のユーザー発言」を突き合わせ、質問のキーワードが含まれているか（「いつ」の質問には日時が含まれているか）で答えたかどうかを判定します。
過集中で相手の質問を読み飛ばしがちな人向けの軸です。

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
  scoring/rules.ts       ルールベース採点
  scoring/analyze.ts     ルール + Gemini の統合採点
  storage.ts             localStorage
  types.ts               型・定数
tests/                   Vitest
```
