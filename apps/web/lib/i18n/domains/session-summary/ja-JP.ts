import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "要約を共有",
  "summary.title": "セッションの要約",
  "summary.close": "閉じる",
  "summary.description":
    "集計した要約を確認してダウンロードするか、有効期限付きの共有リンクを作成できます。",
  "summary.loading": "要約を読み込み中…",
  "summary.failed": "要約を更新できませんでした。更新してもう一度お試しください。",
  "summary.unavailable": "この要約は利用できません。主催者に有効な共有リンクを依頼してください。",
  "summary.downloads": "要約をダウンロード",
  "summary.download.pdf": "PDFをダウンロード",
  "summary.download.png": "画像をダウンロード",
  "summary.download.xlsx": "スプレッドシートをダウンロード",
  "summary.downloadsUnavailable": "この要約はダウンロードできません。",
  "summary.downloadFailed":
    "ダウンロードを完了できませんでした。再試行するか、主催者に有効なリンクを依頼してください。",
  "summary.downloaded": "要約をダウンロードしました。",
  "summary.imageContent": "画像の内容",
  "summary.wholeSummary": "要約全体",
  "summary.create": "共有リンクを作成",
  "summary.expiryDays": "リンクの有効日数（1～30日）",
  "summary.allowDownloads": "受信者による要約のダウンロードを許可",
  "summary.bearerNotice":
    "このリンクを持つ人は、有効期限が切れるか無効化されるまで集計した要約を読めます。ダウンロード済みのコピーは無効化できません。",
  "summary.nextSteps": "次のステップ",
  "summary.nextStepsHint":
    "主催者の任意のメモ（2,000文字まで）。共有されるため、氏名や個人情報は含めないでください。",
  "summary.expires": "有効期限：{date}",
  "summary.retention": "リンクの有効期限は、このセッションの保存期限を超えられません：{date}。",
  "summary.working": "処理中…",
  "summary.created": "共有リンクを作成しました。",
  "summary.replayed":
    "この共有はすでに受け付けられています。元のリンクは再表示できません。別のリンクを作成する前に既存のリンクを確認してください。",
  "summary.uncertain":
    "リクエストを確認できませんでした。リンク一覧を更新しました。同じ内容で再試行すると同じリクエストを使用します。",
  "summary.saveLink":
    "今すぐリンクを保存してください。秘密の値は保存されず、このリンクを再表示することはできません。",
  "summary.link": "共有リンク",
  "summary.copy": "リンクをコピー",
  "summary.copied": "リンクをコピーしました。",
  "summary.copyFailed": "コピーがブロックされました。リンクを選択して手動でコピーしてください。",
  "summary.links": "既存の共有リンク",
  "summary.noLinks": "共有リンクはまだ作成されていません。",
  "summary.refresh": "リンクを更新",
  "summary.linkCreated": "作成日：{date}",
  "summary.linkActive": "有効",
  "summary.linkExpired": "期限切れ",
  "summary.linkRevoked": "無効化済み",
  "summary.revoke": "リンクを無効化",
  "summary.revoked": "共有リンクを無効化しました。",
  "summary.reason.feature_disabled":
    "新しい要約の共有は停止中です。既存のリンクは引き続き管理できます。",
  "summary.reason.role":
    "ワークスペースの役割では要約の閲覧はできますが、リンクの作成や無効化はできません。",
  "summary.reason.exports_entitlement":
    "このセッションには要約の書き出しと共有が含まれていませんでした。",
  "summary.participants": "参加者",
  "summary.responses": "回答",
  "summary.questions": "確認項目",
  "summary.results": "質問ごとの結果",
  "summary.questionRegion": "質問{number}の結果：{prompt}",
  "summary.response": "回答",
  "summary.value": "値",
  "summary.sample": "回答者{count}人",
  "summary.notAssessed": "コンテンツスライド · 評価対象外",
  "summary.notScored": "意見の回答 · 採点なし",
  "summary.multiSelect":
    "複数選択が可能です。各選択肢を選んだ回答者数を表示するため、合計が回答者数を超える場合があります。",
  "summary.accuracyValue": "正答率：{percent}%（評価対象の{responses}回答中{correct}回答が正解）",
  "summary.initialAccuracy":
    "初回正答率：{percent}%（評価対象の{responses}回答中{correct}回答が正解）",
  "summary.recovery": "理解改善の証拠",
  "summary.recovery.linked": "関連する再確認",
  "summary.recovery.revote": "再投票",
  "summary.recoveryValue": "対象の{eligible}組中{recovered}組が改善（{percent}%）",
  "summary.measure.respondents": "回答者数",
  "summary.measure.selections": "選択数",
  "summary.measure.weighted_points": "重み付き順位点",
  "summary.suppression.insufficient_sample": "回答者が5人未満の場合、証拠は表示されません。",
  "summary.suppression.participant_text":
    "参加者が記述したテキストは共有する要約から除外されます。",
  "summary.suppression.unavailable": "この証拠は利用できません。",
  "summary.note.aggregate_only":
    "集計結果のみです。参加者名、個人別の結果、個別の投稿内容は除外されます。",
  "summary.note.insufficient_sample": "標本が5未満の証拠は表示されません。",
  "summary.note.participant_text_excluded": "参加者の記述とワードクラウドの語句は除外されます。",
  "summary.note.paired_evidence":
    "改善は対応付けた再確認の結果を数えます。重複のない人数や、証明された因果効果を示すものではありません。",
  "summary.note.no_scored_evidence":
    "採点された学習の証拠はありません。意見の回答は正誤を測るものではありません。",
};

export default messages;
