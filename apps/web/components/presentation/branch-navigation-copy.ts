import type { PresentationControlCommand, SupportedLocale } from "@openround/contracts";
import {
  companionCopy,
  type CompanionCopySource,
} from "../../lib/i18n/domains/live-delivery/companion-translations";
import { localizeSectionsSpatialMessage } from "../../lib/i18n/sections-spatial-copy";
import { nativeInteractionCopy, type NativeInteractionCopyKey } from "./native-interaction-copy";

const locales = [
  "fr-FR",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-PT",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
] as const;
type TranslationRow = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const sharedKeys = [
  "Choose target",
  "Unavailable target — select another",
] as const satisfies readonly NativeInteractionCopyKey[];

const sharedCompanionKeys = [
  "Waiting for server confirmation…",
  "Action not yet confirmed. Retry to confirm the original action.",
  "Retry return acknowledgement",
  "Retry jump acknowledgement",
  "Retry slide link acknowledgement",
  "Retry branch acknowledgement",
  "Retry broadcast reveal acknowledgement",
  "Retry action acknowledgement",
] as const satisfies readonly CompanionCopySource[];

// UI phrases only. Authored labels, target titles and canonical IDs never enter this catalog.
const messages = {
  "Reacquire a host control pass to confirm the pending action.": [
    "Obtenez à nouveau un accès de contrôle hôte pour confirmer l’action en attente.",
    "Fordern Sie erneut einen Host-Steuerungszugang an, um die ausstehende Aktion zu bestätigen.",
    "Vuelve a obtener un pase de control de anfitrión para confirmar la acción pendiente.",
    "Ottieni di nuovo un pass di controllo host per confermare l’azione in sospeso.",
    "Obtenha novamente um passe de controlo de anfitrião para confirmar a ação pendente.",
    "保留中の操作を確認するには、ホスト操作パスを再取得してください。",
    "대기 중인 작업을 확인하려면 호스트 제어 권한을 다시 받으세요.",
    "请重新获取主持人控制凭证以确认待处理的操作。",
    "請重新取得主持人控制憑證以確認待處理的操作。",
  ],
  "Live navigation and Recovery Pack card actions require a host control pass. You can still advance using compatibility mode.":
    [
      "La navigation en direct et les actions des cartes de remédiation nécessitent un accès de contrôle hôte. Vous pouvez toujours avancer en mode de compatibilité.",
      "Live-Navigation und Aktionen für Wiederholungskarten erfordern einen Host-Steuerungszugang. Im Kompatibilitätsmodus können Sie weiterhin fortfahren.",
      "La navegación en directo y las acciones de las tarjetas de refuerzo requieren un pase de control de anfitrión. Puedes seguir avanzando en modo de compatibilidad.",
      "La navigazione in diretta e le azioni delle schede di recupero richiedono un pass di controllo host. Puoi comunque avanzare in modalità compatibilità.",
      "A navegação em direto e as ações dos cartões de recuperação exigem um passe de controlo de anfitrião. Pode continuar a avançar no modo de compatibilidade.",
      "ライブの移動操作と復習パックのカード操作にはホスト操作パスが必要です。互換モードでは引き続き先に進めます。",
      "실시간 탐색과 복습 팩 카드 작업에는 호스트 제어 권한이 필요합니다. 호환 모드에서는 계속 진행할 수 있습니다.",
      "实时导航和复习包卡片操作需要主持人控制凭证。您仍可使用兼容模式继续前进。",
      "即時導覽和複習套件卡片操作需要主持人控制憑證。您仍可使用相容模式繼續前進。",
    ],
  "Acquiring host control pass…": [
    "Obtention de l’accès de contrôle hôte…",
    "Host-Steuerungszugang wird angefordert…",
    "Obteniendo pase de control de anfitrión…",
    "Acquisizione del pass di controllo host…",
    "A obter passe de controlo de anfitrião…",
    "ホスト操作パスを取得中…",
    "호스트 제어 권한을 받는 중…",
    "正在获取主持人控制凭证…",
    "正在取得主持人控制憑證…",
  ],
  "Retry host control pass": [
    "Réessayer l’obtention de l’accès de contrôle hôte",
    "Host-Steuerungszugang erneut anfordern",
    "Reintentar pase de control de anfitrión",
    "Riprova ad acquisire il pass di controllo host",
    "Tentar novamente obter passe de controlo de anfitrião",
    "ホスト操作パスの取得を再試行",
    "호스트 제어 권한 다시 받기",
    "重试获取主持人控制凭证",
    "重試取得主持人控制憑證",
  ],
  "Answer branches": [
    "Embranchements selon les réponses",
    "Antwortverzweigungen",
    "Ramas según respuestas",
    "Diramazioni in base alle risposte",
    "Ramificações por resposta",
    "回答による分岐",
    "답변 분기",
    "答案分支",
    "答案分支",
  ],
  "After revealing this activity, the facilitator can choose an eligible branch. Next block keeps the numbered path. Branches never submit answers or change scores.":
    [
      "Après avoir révélé cette activité, l’animateur peut choisir un embranchement admissible. Le bloc suivant conserve le parcours numéroté. Les embranchements ne soumettent jamais de réponses et ne modifient pas les scores.",
      "Nach dem Aufdecken dieser Aktivität kann die Moderation eine verfügbare Verzweigung wählen. Nächster Block folgt dem nummerierten Pfad. Verzweigungen senden keine Antworten und ändern keine Punktzahlen.",
      "Tras revelar esta actividad, el facilitador puede elegir una rama disponible. El siguiente bloque mantiene el recorrido numerado. Las ramas nunca envían respuestas ni cambian puntuaciones.",
      "Dopo aver rivelato questa attività, il facilitatore può scegliere una diramazione disponibile. Il blocco successivo mantiene il percorso numerato. Le diramazioni non inviano risposte né modificano i punteggi.",
      "Após revelar esta atividade, o facilitador pode escolher uma ramificação disponível. O bloco seguinte mantém o percurso numerado. As ramificações nunca enviam respostas nem alteram pontuações.",
      "このアクティビティの結果を公開すると、進行役は条件を満たす分岐を選べます。「次のブロック」は番号順の経路を維持します。分岐が回答を送信したり、スコアを変更したりすることはありません。",
      "이 활동의 결과를 공개한 후 진행자가 조건을 충족하는 분기를 선택할 수 있습니다. 다음 블록은 번호 순서 경로를 유지합니다. 분기는 답변을 제출하거나 점수를 변경하지 않습니다.",
      "公布此活动结果后，主持人可以选择符合条件的分支。下一内容块保持编号顺序。分支不会提交答案或更改分数。",
      "公布此活動結果後，主持人可以選擇符合條件的分支。下一內容區塊維持編號順序。分支不會提交答案或變更分數。",
    ],
  "Branches require an unlinked main activity. Remove branches before linking a recheck or changing the delivery role.":
    [
      "Les embranchements nécessitent une activité principale non liée. Supprimez-les avant de lier une vérification ou de modifier le rôle de diffusion.",
      "Verzweigungen erfordern eine unverknüpfte Hauptaktivität. Entfernen Sie sie, bevor Sie eine Nachprüfung verknüpfen oder die Rolle ändern.",
      "Las ramas requieren una actividad principal sin vínculos. Elimina las ramas antes de vincular una comprobación o cambiar el rol de presentación.",
      "Le diramazioni richiedono un’attività principale non collegata. Rimuovile prima di collegare una verifica o modificare il ruolo di erogazione.",
      "As ramificações exigem uma atividade principal sem associação. Remova-as antes de associar uma verificação ou alterar o papel de apresentação.",
      "分岐には連動していないメインアクティビティが必要です。再確認を連動させたり配信の役割を変更したりする前に、分岐を削除してください。",
      "분기에는 연결되지 않은 메인 활동이 필요합니다. 재확인 질문을 연결하거나 전달 역할을 변경하기 전에 분기를 삭제하세요.",
      "分支需要未关联的主要活动。关联复查题或更改展示角色前，请先移除分支。",
      "分支需要未關聯的主要活動。關聯複查題或變更展示角色前，請先移除分支。",
    ],
  "Branch {number}": [
    "Embranchement {number}",
    "Verzweigung {number}",
    "Rama {number}",
    "Diramazione {number}",
    "Ramificação {number}",
    "分岐 {number}",
    "분기 {number}",
    "分支 {number}",
    "分支 {number}",
  ],
  "Branch label": [
    "Libellé de l’embranchement",
    "Verzweigungsbeschriftung",
    "Etiqueta de la rama",
    "Etichetta della diramazione",
    "Etiqueta da ramificação",
    "分岐のラベル",
    "분기 레이블",
    "分支标签",
    "分支標籤",
  ],
  "Branch {number} label": [
    "Libellé de l’embranchement {number}",
    "Beschriftung für Verzweigung {number}",
    "Etiqueta de la rama {number}",
    "Etichetta della diramazione {number}",
    "Etiqueta da ramificação {number}",
    "分岐 {number} のラベル",
    "분기 {number} 레이블",
    "分支 {number} 标签",
    "分支 {number} 標籤",
  ],
  Condition: [
    "Condition",
    "Bedingung",
    "Condición",
    "Condizione",
    "Condição",
    "条件",
    "조건",
    "条件",
    "條件",
  ],
  "Branch {number} condition": [
    "Condition de l’embranchement {number}",
    "Bedingung für Verzweigung {number}",
    "Condición de la rama {number}",
    "Condizione della diramazione {number}",
    "Condição da ramificação {number}",
    "分岐 {number} の条件",
    "분기 {number} 조건",
    "分支 {number} 条件",
    "分支 {number} 條件",
  ],
  "Correct responses": [
    "Réponses correctes",
    "Richtige Antworten",
    "Respuestas correctas",
    "Risposte corrette",
    "Respostas corretas",
    "正解の回答",
    "정답 응답",
    "正确回答",
    "正確回答",
  ],
  "Selected answer choice": [
    "Choix de réponse sélectionné",
    "Ausgewählte Antwortoption",
    "Opción de respuesta seleccionada",
    "Opzione di risposta selezionata",
    "Opção de resposta selecionada",
    "選択された回答の選択肢",
    "선택된 답변 선택지",
    "所选答案选项",
    "所選答案選項",
  ],
  "Answer choice": [
    "Choix de réponse",
    "Antwortoption",
    "Opción de respuesta",
    "Opzione di risposta",
    "Opção de resposta",
    "回答の選択肢",
    "답변 선택지",
    "答案选项",
    "答案選項",
  ],
  "Branch {number} answer choice": [
    "Choix de réponse de l’embranchement {number}",
    "Antwortoption für Verzweigung {number}",
    "Opción de respuesta de la rama {number}",
    "Opzione di risposta della diramazione {number}",
    "Opção de resposta da ramificação {number}",
    "分岐 {number} の回答の選択肢",
    "분기 {number} 답변 선택지",
    "分支 {number} 答案选项",
    "分支 {number} 答案選項",
  ],
  "Unavailable choice — select another": [
    "Choix indisponible — sélectionnez-en un autre",
    "Option nicht verfügbar — andere auswählen",
    "Opción no disponible — selecciona otra",
    "Opzione non disponibile — selezionane un’altra",
    "Opção indisponível — selecione outra",
    "選択肢を利用できません — 別の選択肢を選択",
    "사용할 수 없는 선택지 — 다른 항목을 선택하세요",
    "选项不可用 — 请选择其他选项",
    "選項無法使用 — 請選擇其他選項",
  ],
  "Choice {number}": [
    "Choix {number}",
    "Option {number}",
    "Opción {number}",
    "Opzione {number}",
    "Opção {number}",
    "選択肢 {number}",
    "선택지 {number}",
    "选项 {number}",
    "選項 {number}",
  ],
  "Minimum percent": [
    "Pourcentage minimum",
    "Mindestprozentsatz",
    "Porcentaje mínimo",
    "Percentuale minima",
    "Percentagem mínima",
    "最小割合（%）",
    "최소 백분율",
    "最低百分比",
    "最低百分比",
  ],
  "Branch {number} minimum percent": [
    "Pourcentage minimum de l’embranchement {number}",
    "Mindestprozentsatz für Verzweigung {number}",
    "Porcentaje mínimo de la rama {number}",
    "Percentuale minima della diramazione {number}",
    "Percentagem mínima da ramificação {number}",
    "分岐 {number} の最小割合",
    "분기 {number} 최소 백분율",
    "分支 {number} 最低百分比",
    "分支 {number} 最低百分比",
  ],
  "Minimum responses": [
    "Nombre minimum de réponses",
    "Mindestanzahl an Antworten",
    "Respuestas mínimas",
    "Risposte minime",
    "Respostas mínimas",
    "最小回答数",
    "최소 응답 수",
    "最少回答数",
    "最少回答數",
  ],
  "Branch {number} minimum responses": [
    "Nombre minimum de réponses de l’embranchement {number}",
    "Mindestantwortzahl für Verzweigung {number}",
    "Respuestas mínimas de la rama {number}",
    "Risposte minime della diramazione {number}",
    "Respostas mínimas da ramificação {number}",
    "分岐 {number} の最小回答数",
    "분기 {number} 최소 응답 수",
    "分支 {number} 最少回答数",
    "分支 {number} 最少回答數",
  ],
  "Forward target": [
    "Cible suivante",
    "Nachfolgendes Ziel",
    "Destino posterior",
    "Destinazione successiva",
    "Destino seguinte",
    "先のリンク先",
    "이후 대상",
    "后续目标",
    "後續目標",
  ],
  "Branch {number} target": [
    "Cible de l’embranchement {number}",
    "Ziel für Verzweigung {number}",
    "Destino de la rama {number}",
    "Destinazione della diramazione {number}",
    "Destino da ramificação {number}",
    "分岐 {number} のリンク先",
    "분기 {number} 대상",
    "分支 {number} 目标",
    "分支 {number} 目標",
  ],
  "Remove branch {number}": [
    "Supprimer l’embranchement {number}",
    "Verzweigung {number} entfernen",
    "Eliminar rama {number}",
    "Rimuovi diramazione {number}",
    "Remover ramificação {number}",
    "分岐 {number} を削除",
    "분기 {number} 삭제",
    "移除分支 {number}",
    "移除分支 {number}",
  ],
  "Add answer branch": [
    "Ajouter un embranchement selon les réponses",
    "Antwortverzweigung hinzufügen",
    "Añadir rama según respuestas",
    "Aggiungi diramazione in base alle risposte",
    "Adicionar ramificação por resposta",
    "回答による分岐を追加",
    "답변 분기 추가",
    "添加答案分支",
    "新增答案分支",
  ],
  "Choose an eligible branch after reveal. Next block keeps the numbered path.": [
    "Choisissez un embranchement admissible après la révélation. Le bloc suivant conserve le parcours numéroté.",
    "Wählen Sie nach dem Aufdecken eine verfügbare Verzweigung. Nächster Block folgt dem nummerierten Pfad.",
    "Elige una rama disponible tras revelar. El siguiente bloque mantiene el recorrido numerado.",
    "Scegli una diramazione disponibile dopo la rivelazione. Il blocco successivo mantiene il percorso numerato.",
    "Escolha uma ramificação disponível após revelar. O bloco seguinte mantém o percurso numerado.",
    "結果を公開した後に条件を満たす分岐を選択します。「次のブロック」は番号順の経路を維持します。",
    "결과 공개 후 조건을 충족하는 분기를 선택하세요. 다음 블록은 번호 순서 경로를 유지합니다.",
    "公布结果后选择符合条件的分支。下一内容块保持编号顺序。",
    "公布結果後選擇符合條件的分支。下一內容區塊維持編號順序。",
  ],
  "Presentation navigation": [
    "Navigation de la présentation",
    "Präsentationsnavigation",
    "Navegación de la presentación",
    "Navigazione della presentazione",
    "Navegação da apresentação",
    "プレゼンテーションの移動",
    "프레젠테이션 탐색",
    "演示导航",
    "簡報導覽",
  ],
  "Close navigation": [
    "Fermer la navigation",
    "Navigation schließen",
    "Cerrar navegación",
    "Chiudi navigazione",
    "Fechar navegação",
    "移動メニューを閉じる",
    "탐색 닫기",
    "关闭导航",
    "關閉導覽",
  ],
  "Jump to a slide or activity. Reviewed activities keep their saved results and remain closed.": [
    "Accédez à une diapositive ou une activité. Les activités revues conservent leurs résultats enregistrés et restent fermées.",
    "Springen Sie zu einer Folie oder Aktivität. Bereits überprüfte Aktivitäten behalten ihre gespeicherten Ergebnisse und bleiben geschlossen.",
    "Salta a una diapositiva o actividad. Las actividades revisadas conservan sus resultados guardados y permanecen cerradas.",
    "Passa a una diapositiva o attività. Le attività riviste mantengono i risultati salvati e restano chiuse.",
    "Avance para um diapositivo ou atividade. As atividades revistas mantêm os resultados guardados e permanecem fechadas.",
    "スライドやアクティビティに移動します。確認済みのアクティビティは保存済みの結果を保持し、回答受付は終了したままです。",
    "슬라이드나 활동으로 이동하세요. 검토한 활동은 저장된 결과를 유지하며 닫힌 상태로 남습니다.",
    "跳转到幻灯片或活动。已复习的活动保留已保存的结果，并保持关闭状态。",
    "跳至投影片或活動。已複習的活動保留已儲存的結果，並維持關閉狀態。",
  ],
  Slide: [
    "Diapositive",
    "Folie",
    "Diapositiva",
    "Diapositiva",
    "Diapositivo",
    "スライド",
    "슬라이드",
    "幻灯片",
    "投影片",
  ],
  Activity: [
    "Activité",
    "Aktivität",
    "Actividad",
    "Attività",
    "Atividade",
    "アクティビティ",
    "활동",
    "活动",
    "活動",
  ],
  Current: ["En cours", "Aktuell", "Actual", "Attuale", "Atual", "現在", "현재", "当前", "目前"],
  Visited: [
    "Consulté",
    "Besucht",
    "Visitado",
    "Visitato",
    "Visitado",
    "訪問済み",
    "방문함",
    "已访问",
    "已造訪",
  ],
  "Not visited": [
    "Non consulté",
    "Nicht besucht",
    "Sin visitar",
    "Non visitato",
    "Não visitado",
    "未訪問",
    "방문하지 않음",
    "未访问",
    "未造訪",
  ],
  Review: [
    "Révision",
    "Rückblick",
    "Repaso",
    "Riepilogo",
    "Revisão",
    "振り返り",
    "검토",
    "复习",
    "複習",
  ],
  "Return target:": [
    "Cible de retour :",
    "Rückkehrziel:",
    "Destino de regreso:",
    "Destinazione di ritorno:",
    "Destino de regresso:",
    "戻り先：",
    "복귀 대상:",
    "返回目标：",
    "返回目標：",
  ],
  "Return to path:": [
    "Revenir au parcours :",
    "Zum Pfad zurückkehren:",
    "Volver al recorrido:",
    "Torna al percorso:",
    "Voltar ao percurso:",
    "経路に戻る：",
    "경로로 복귀:",
    "返回路径：",
    "返回路徑：",
  ],
  "Close and reveal this activity before following an answer branch.": [
    "Fermez et révélez cette activité avant de suivre un embranchement selon les réponses.",
    "Schließen Sie diese Aktivität und decken Sie sie auf, bevor Sie einer Antwortverzweigung folgen.",
    "Cierra y revela esta actividad antes de seguir una rama según respuestas.",
    "Chiudi e rivela questa attività prima di seguire una diramazione in base alle risposte.",
    "Feche e revele esta atividade antes de seguir uma ramificação por resposta.",
    "回答による分岐に進む前に、このアクティビティを締め切って結果を公開してください。",
    "답변 분기를 따라가기 전에 이 활동을 닫고 결과를 공개하세요.",
    "进入答案分支前，请关闭此活动并公布结果。",
    "進入答案分支前，請關閉此活動並公布結果。",
  ],
  "This branch target is unavailable.": [
    "La cible de cet embranchement est indisponible.",
    "Das Ziel dieser Verzweigung ist nicht verfügbar.",
    "El destino de esta rama no está disponible.",
    "La destinazione di questa diramazione non è disponibile.",
    "O destino desta ramificação não está disponível.",
    "この分岐のリンク先は利用できません。",
    "이 분기 대상을 사용할 수 없습니다.",
    "此分支目标不可用。",
    "此分支目標無法使用。",
  ],
  "This branch needs at least {count} accepted responses.": [
    "Cet embranchement nécessite au moins {count} réponses acceptées.",
    "Diese Verzweigung benötigt mindestens {count} angenommene Antworten.",
    "Esta rama necesita al menos {count} respuestas aceptadas.",
    "Questa diramazione richiede almeno {count} risposte accettate.",
    "Esta ramificação exige pelo menos {count} respostas aceites.",
    "この分岐には、受理された回答が少なくとも {count} 件必要です。",
    "이 분기에는 최소 {count}개의 수락된 응답이 필요합니다.",
    "此分支至少需要 {count} 个已接受的回答。",
    "此分支至少需要 {count} 個已接受的回答。",
  ],
  "The accepted responses do not meet this branch condition.": [
    "Les réponses acceptées ne remplissent pas la condition de cet embranchement.",
    "Die angenommenen Antworten erfüllen die Bedingung dieser Verzweigung nicht.",
    "Las respuestas aceptadas no cumplen la condición de esta rama.",
    "Le risposte accettate non soddisfano la condizione di questa diramazione.",
    "As respostas aceites não cumprem a condição desta ramificação.",
    "受理された回答は、この分岐の条件を満たしていません。",
    "수락된 응답이 이 분기 조건을 충족하지 않습니다.",
    "已接受的回答不满足此分支条件。",
    "已接受的回答不符合此分支條件。",
  ],
  "Slide navigation is unavailable here.": [
    "La navigation entre diapositives est indisponible ici.",
    "Die Foliennavigation ist hier nicht verfügbar.",
    "La navegación entre diapositivas no está disponible aquí.",
    "La navigazione tra diapositive non è disponibile qui.",
    "A navegação entre diapositivos não está disponível aqui.",
    "ここではスライドの移動を利用できません。",
    "여기서는 슬라이드 탐색을 사용할 수 없습니다.",
    "此处无法使用幻灯片导航。",
    "此處無法使用投影片導覽。",
  ],
  "You are on this block.": [
    "Vous êtes sur ce bloc.",
    "Sie befinden sich auf diesem Block.",
    "Estás en este bloque.",
    "Sei su questo blocco.",
    "Está neste bloco.",
    "現在このブロックを表示しています。",
    "현재 이 블록에 있습니다.",
    "您当前位于此内容块。",
    "您目前位於此內容區塊。",
  ],
} as const satisfies Record<string, TranslationRow>;

type LocalKey = keyof typeof messages;
export type BranchNavigationCopyKey =
  LocalKey | (typeof sharedKeys)[number] | (typeof sharedCompanionKeys)[number];
export const branchNavigationCopyKeys: readonly BranchNavigationCopyKey[] = [
  ...sharedKeys,
  ...sharedCompanionKeys,
  ...(Object.keys(messages) as LocalKey[]),
];

export function branchNavigationCopy(locale: SupportedLocale = "en-CA") {
  const column = locales.indexOf(locale as (typeof locales)[number]);
  return (key: BranchNavigationCopyKey, values: Record<string, string | number> = {}): string => {
    const message: string = Object.hasOwn(messages, key)
      ? column < 0
        ? key
        : messages[key as LocalKey][column]!
      : sharedCompanionKeys.some((candidate) => candidate === key)
        ? companionCopy(locale)(key as (typeof sharedCompanionKeys)[number])
        : nativeInteractionCopy(locale)(key as (typeof sharedKeys)[number]);
    return message.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
  };
}

const feedbackKeys = [
  "Close and reveal this activity before following an answer branch.",
  "This branch target is unavailable.",
  "The accepted responses do not meet this branch condition.",
  "Slide navigation is unavailable here.",
  "You are on this block.",
] as const satisfies readonly BranchNavigationCopyKey[];

/** Canonical policy diagnostics only; unknown service diagnostics remain verbatim English. */
export function localizeBranchNavigationFeedback(locale: SupportedLocale, original: string) {
  const key = feedbackKeys.find((candidate) => candidate === original);
  if (key) return { text: branchNavigationCopy(locale)(key), lang: locale };
  const minimum = /^This branch needs at least ([1-9]\d{0,3}|10000) accepted responses\.$/.exec(
    original,
  );
  if (minimum)
    return {
      text: branchNavigationCopy(locale)("This branch needs at least {count} accepted responses.", {
        count: minimum[1]!,
      }),
      lang: locale,
    };
  const shared = localizeSectionsSpatialMessage(locale, original);
  return { text: shared.text, lang: shared.language };
}

/** Display only: the original command and acknowledgement identity are never changed. */
export function branchNavigationRetryLabel(
  locale: SupportedLocale,
  command: PresentationControlCommand,
) {
  const key: BranchNavigationCopyKey =
    command.action === "return_to_path"
      ? "Retry return acknowledgement"
      : command.action === "jump_to_block"
        ? "Retry jump acknowledgement"
        : command.action === "navigate_scene"
          ? "Retry slide link acknowledgement"
          : command.action === "follow_branch"
            ? "Retry branch acknowledgement"
            : command.action === "set_reveal"
              ? "Retry broadcast reveal acknowledgement"
              : "Retry action acknowledgement";
  return branchNavigationCopy(locale)(key);
}
