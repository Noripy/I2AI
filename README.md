# I2AI 報連相トレーナー

AI（上司役）と会話しながら **報告・連絡・相談** を練習し、その会話を分析して **スコアとフィードバック** を返すアプリです。

## こんな人のためのアプリ

- 新社会人で、報連相の「型」がまだ身についていない
- タスクを分解できず、何から手を付ければいいか分からなくなる
- 完璧にしてから見せようとして、報告が遅れてしまう
- 過集中・考えすぎで、相手の質問や情報を取りこぼしてしまう
- 説明が苦手で、言いたいことが伝わらない

画面で自分の特性を選ぶと、その悩みに関係する採点軸が重く評価され、ヒントもそれに合わせて変わります。

## できること

1. **AI 上司と会話** — 送った発言を AI が「報告 / 連絡 / 相談 / タスク分解 / その他」に振り分け、実際の上司が聞き返しそうな確認質問を返します
2. **採点** — 「採点する」ボタン、または「採点して」と送ると、6つの軸で 0〜100 点のスコアを出します
3. **フィードバック** — できていること・次に伸ばすこと・言い換え例（結論→理由→詳細→次の行動）・明日からの一歩を表示します
4. **履歴** — スコアを端末内に保存し、伸びを確認できます

採点軸: 結論ファースト / 具体性 / 簡潔さ / 早めの共有 / 受信力（質問に答えているか）/ 相談の質
→ 詳しくは [docs/scoring.md](docs/scoring.md)

## 仕組み（振り分けの流れ）

```
発言 → ルーター ─┬─ キーワードで明確 → そのまま確定（Gemini を呼ばない = 無料枠の節約）
                 └─ あいまい → Gemini が分類（JSON Schema で選択肢を固定）
        ↓
   意図別ハンドラー（報告 / 連絡 / 相談 / タスク分解 / その他）または 採点
```

→ 詳しくは [docs/architecture.md](docs/architecture.md)

## 技術スタック

| | |
|---|---|
| フロント + API | Next.js 16 (App Router) / React 19 / TypeScript |
| LLM | Gemini API（`@google/genai`、既定 `gemini-2.5-flash`） |
| 型検証 | zod（LLM の JSON 出力を検証） |
| 保存 | localStorage（端末内のみ） |
| テスト / CI | Vitest / GitHub Actions |
| ホスティング | Vercel Hobby（無料） |

候補4案（Next.js+Vercel / Cloudflare / Firebase+Genkit / Streamlit）の比較と、この構成に決めた理由は [docs/tech-selection.md](docs/tech-selection.md) にまとめています。

## 始め方

```bash
npm install
cp .env.example .env.local   # GEMINI_API_KEY を設定（空でもモックモードで動きます）
npm run dev                  # http://localhost:3000
```

Gemini の API キーは [Google AI Studio](https://aistudio.google.com/apikey) で無料で発行できます。

| コマンド | 内容 |
|---------|------|
| `npm run dev` | 開発サーバー |
| `npm test` | テスト（API キー不要） |
| `npm run typecheck` | 型チェック |
| `npm run build` | 本番ビルド |

### モックモード

`GEMINI_API_KEY` が未設定のときは、振り分けはキーワードのみ、返答は定型文、採点はルールのみで動きます。
キーを用意する前に画面や採点の動きを確かめたいときに使えます。

## デプロイ（Vercel・無料）

1. Vercel にこのリポジトリをインポート
2. Environment Variables に `GEMINI_API_KEY`（必要なら `GEMINI_MODEL`）を設定
3. Deploy

## 注意

- **Gemini API の無料枠では、入力内容が Google のサービス改善に使われる場合があります。** 実在の顧客名や社外秘の情報は入力しないでください
- Vercel Hobby プランは非商用利用に限られます。商用化する場合は docs/tech-selection.md の案B（Cloudflare）への移行を検討してください
- 無料枠のリクエスト上限に達すると一時的にエラーになります。時間をおいて再度お試しください
