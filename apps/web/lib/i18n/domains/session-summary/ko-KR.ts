import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "요약 공유",
  "summary.title": "세션 요약",
  "summary.close": "닫기",
  "summary.description": "집계 요약을 미리 보고 다운로드하거나 만료되는 공유 링크를 만드세요.",
  "summary.loading": "요약 불러오는 중…",
  "summary.failed": "요약을 업데이트하지 못했습니다. 새로고침하고 다시 시도하세요.",
  "summary.unavailable": "이 요약을 사용할 수 없습니다. 진행자에게 유효한 공유 링크를 요청하세요.",
  "summary.downloads": "요약 다운로드",
  "summary.download.pdf": "PDF 다운로드",
  "summary.download.png": "이미지 다운로드",
  "summary.download.xlsx": "스프레드시트 다운로드",
  "summary.downloadsUnavailable": "이 요약은 다운로드할 수 없습니다.",
  "summary.downloadFailed":
    "다운로드를 완료하지 못했습니다. 다시 시도하거나 진행자에게 유효한 링크를 요청하세요.",
  "summary.downloaded": "요약을 다운로드했습니다.",
  "summary.imageContent": "이미지 내용",
  "summary.wholeSummary": "전체 요약",
  "summary.create": "공유 링크 만들기",
  "summary.expiryDays": "링크 유효 기간(1~30일)",
  "summary.allowDownloads": "수신자가 요약을 다운로드하도록 허용",
  "summary.bearerNotice":
    "링크가 있는 누구나 만료되거나 취소될 때까지 집계 요약을 읽을 수 있습니다. 다운로드한 사본은 취소할 수 없습니다.",
  "summary.nextSteps": "다음 단계",
  "summary.nextStepsHint":
    "진행자의 선택 메모(최대 2,000자). 공유되는 내용이므로 이름과 개인정보를 제외하세요.",
  "summary.expires": "만료: {date}",
  "summary.retention": "링크는 이 세션의 보존 기한을 넘길 수 없습니다: {date}.",
  "summary.working": "처리 중…",
  "summary.created": "공유 링크를 만들었습니다.",
  "summary.replayed":
    "이 공유 요청은 이미 승인되었습니다. 원래 링크를 다시 표시할 수 없습니다. 다른 링크를 만들기 전에 기존 링크를 확인하세요.",
  "summary.uncertain":
    "요청을 확인하지 못했습니다. 링크 목록을 새로고침했습니다. 내용을 바꾸지 않고 재시도하면 같은 요청을 사용합니다.",
  "summary.saveLink":
    "지금 링크를 저장하세요. 비밀 값은 저장되지 않으며 이 링크를 다시 표시할 수 없습니다.",
  "summary.link": "공유 링크",
  "summary.copy": "링크 복사",
  "summary.copied": "링크를 복사했습니다.",
  "summary.copyFailed": "복사가 차단되었습니다. 링크를 선택하여 직접 복사하세요.",
  "summary.links": "기존 공유 링크",
  "summary.noLinks": "아직 만든 공유 링크가 없습니다.",
  "summary.refresh": "링크 새로고침",
  "summary.linkCreated": "생성: {date}",
  "summary.linkActive": "사용 중",
  "summary.linkExpired": "만료됨",
  "summary.linkRevoked": "취소됨",
  "summary.revoke": "링크 취소",
  "summary.revoked": "공유 링크를 취소했습니다.",
  "summary.reason.feature_disabled":
    "새 요약 공유가 일시 중지되었습니다. 기존 링크는 계속 관리할 수 있습니다.",
  "summary.reason.role":
    "워크스페이스 역할상 요약을 볼 수 있지만 링크를 만들거나 취소할 수는 없습니다.",
  "summary.reason.exports_entitlement": "이 세션에는 요약 내보내기와 공유가 포함되지 않았습니다.",
  "summary.participants": "참가자",
  "summary.responses": "응답",
  "summary.questions": "체크포인트",
  "summary.results": "질문별 결과",
  "summary.questionRegion": "질문 {number} 결과: {prompt}",
  "summary.response": "응답",
  "summary.value": "값",
  "summary.sample": "응답자 {count}명",
  "summary.notAssessed": "콘텐츠 슬라이드 · 평가하지 않음",
  "summary.notScored": "의견 피드백 · 점수 없음",
  "summary.multiSelect":
    "복수 선택이 가능합니다. 각 선택지를 선택한 응답자 수를 표시하므로 합계가 응답자 수를 넘을 수 있습니다.",
  "summary.accuracyValue": "정답률: {percent}% (평가한 응답 {responses}개 중 {correct}개 정답)",
  "summary.initialAccuracy":
    "초기 정답률: {percent}% (평가한 응답 {responses}개 중 {correct}개 정답)",
  "summary.recovery": "이해 개선 근거",
  "summary.recovery.linked": "연결된 재확인",
  "summary.recovery.revote": "재투표",
  "summary.recoveryValue": "해당 응답 쌍 {eligible}개 중 {recovered}개 개선 ({percent}%)",
  "summary.measure.respondents": "응답자 수",
  "summary.measure.selections": "선택 수",
  "summary.measure.weighted_points": "가중 순위 점수",
  "summary.suppression.insufficient_sample": "응답자가 5명 미만이면 근거를 숨깁니다.",
  "summary.suppression.participant_text": "참가자가 작성한 텍스트는 공유 요약에서 제외됩니다.",
  "summary.suppression.unavailable": "이 근거를 사용할 수 없습니다.",
  "summary.note.aggregate_only":
    "집계 결과만 제공합니다. 참가자 이름, 개인별 결과 및 개별 제출 내용은 제외됩니다.",
  "summary.note.insufficient_sample": "표본이 5개 미만인 근거는 숨깁니다.",
  "summary.note.participant_text_excluded":
    "참가자가 작성한 텍스트와 워드 클라우드 단어는 제외됩니다.",
  "summary.note.paired_evidence":
    "개선 수는 짝지은 재확인 결과이며, 중복 없는 인원이나 입증된 인과 효과를 의미하지 않습니다.",
  "summary.note.no_scored_evidence":
    "채점된 학습 근거가 없습니다. 의견 피드백은 정답 여부를 측정하지 않습니다.",
};

export default messages;
