import type { SupportedLocale } from "@openround/contracts";

const english = {
  launch: "Present on another screen",
  setup: "Second-screen setup",
  launcherHelp:
    "Move the audience window to your projector or second monitor, then choose Enter full screen there.",
  stageHelp:
    "Move this window to your projector or second monitor, then enter full screen. Keep the host controls on your own screen.",
  privacy: "Share only the audience window. Presenter notes and controls stay in the host window.",
  focus: "Slide-only view",
  exitFocus: "Exit slide-only view",
  focusHelp: "Move the pointer or press Tab to show controls. Press Escape to return.",
  fallback: "Full screen is unavailable. Slide-only view still fills this window.",
  rejected: "Full screen could not start. Slide-only view is active; use Exit or Escape to return.",
  exitRejected: "Full screen could not close. Use your browser’s Escape control to return.",
};
type Copy = Record<keyof typeof english, string>;

const messages: Record<SupportedLocale, Copy> = {
  "en-CA": english,
  "fr-FR": {
    launch: "Présenter sur un autre écran",
    setup: "Configurer un second écran",
    launcherHelp:
      "Déplacez la fenêtre du public vers le projecteur ou le second écran, puis choisissez Passer en plein écran dans cette fenêtre.",
    stageHelp:
      "Déplacez cette fenêtre vers le projecteur ou le second écran, puis passez en plein écran. Gardez les commandes sur votre propre écran.",
    privacy:
      "Partagez uniquement la fenêtre du public. Les notes et les commandes restent dans la fenêtre de présentation.",
    focus: "Diapositive seule",
    exitFocus: "Quitter la vue diapositive seule",
    focusHelp:
      "Déplacez le pointeur ou appuyez sur Tab pour afficher les commandes. Appuyez sur Échap pour revenir.",
    fallback: "Le plein écran est indisponible. La vue diapositive seule remplit cette fenêtre.",
    rejected:
      "Le plein écran n’a pas pu démarrer. La vue diapositive seule est active ; utilisez Quitter ou Échap pour revenir.",
    exitRejected:
      "Le plein écran n’a pas pu se fermer. Utilisez la commande Échap du navigateur pour revenir.",
  },
  "de-DE": {
    launch: "Auf anderem Bildschirm präsentieren",
    setup: "Zweiten Bildschirm einrichten",
    launcherHelp:
      "Verschieben Sie das Publikumsfenster auf den Projektor oder zweiten Bildschirm und wählen Sie dort Vollbild öffnen.",
    stageHelp:
      "Verschieben Sie dieses Fenster auf den Projektor oder zweiten Bildschirm und öffnen Sie das Vollbild. Die Steuerung bleibt auf Ihrem Bildschirm.",
    privacy:
      "Teilen Sie nur das Publikumsfenster. Notizen und Steuerung bleiben im Moderationsfenster.",
    focus: "Nur Folie anzeigen",
    exitFocus: "Folienansicht verlassen",
    focusHelp:
      "Bewegen Sie den Zeiger oder drücken Sie Tab, um die Steuerung anzuzeigen. Mit Escape kehren Sie zurück.",
    fallback: "Vollbild ist nicht verfügbar. Die Folienansicht füllt weiterhin dieses Fenster.",
    rejected:
      "Vollbild konnte nicht gestartet werden. Die Folienansicht ist aktiv; mit Verlassen oder Escape kehren Sie zurück.",
    exitRejected:
      "Vollbild konnte nicht geschlossen werden. Verwenden Sie die Escape-Steuerung Ihres Browsers.",
  },
  "es-ES": {
    launch: "Presentar en otra pantalla",
    setup: "Configurar una segunda pantalla",
    launcherHelp:
      "Mueve la ventana del público al proyector o segundo monitor y elige Pantalla completa en esa ventana.",
    stageHelp:
      "Mueve esta ventana al proyector o segundo monitor y activa la pantalla completa. Mantén los controles en tu propia pantalla.",
    privacy:
      "Comparte solo la ventana del público. Las notas y los controles permanecen en la ventana del presentador.",
    focus: "Vista de solo diapositiva",
    exitFocus: "Salir de la vista de solo diapositiva",
    focusHelp: "Mueve el puntero o pulsa Tab para mostrar los controles. Pulsa Escape para volver.",
    fallback:
      "La pantalla completa no está disponible. La vista de solo diapositiva ocupa esta ventana.",
    rejected:
      "No se pudo activar la pantalla completa. La vista de solo diapositiva está activa; usa Salir o Escape para volver.",
    exitRejected:
      "No se pudo salir de la pantalla completa. Usa el control Escape del navegador para volver.",
  },
  "it-IT": {
    launch: "Presenta su un altro schermo",
    setup: "Configura un secondo schermo",
    launcherHelp:
      "Sposta la finestra del pubblico sul proiettore o secondo monitor, poi scegli Schermo intero in quella finestra.",
    stageHelp:
      "Sposta questa finestra sul proiettore o secondo monitor, poi attiva lo schermo intero. Mantieni i controlli sul tuo schermo.",
    privacy:
      "Condividi solo la finestra del pubblico. Note e controlli restano nella finestra del relatore.",
    focus: "Vista solo diapositiva",
    exitFocus: "Esci dalla vista solo diapositiva",
    focusHelp:
      "Muovi il puntatore o premi Tab per mostrare i controlli. Premi Esc per tornare indietro.",
    fallback: "Schermo intero non disponibile. La vista solo diapositiva riempie questa finestra.",
    rejected:
      "Impossibile avviare lo schermo intero. La vista solo diapositiva è attiva; usa Esci o Esc per tornare indietro.",
    exitRejected:
      "Impossibile chiudere lo schermo intero. Usa il comando Esc del browser per tornare indietro.",
  },
  "pt-PT": {
    launch: "Apresentar noutro ecrã",
    setup: "Configurar um segundo ecrã",
    launcherHelp:
      "Mova a janela do público para o projetor ou segundo monitor e escolha Ecrã inteiro nessa janela.",
    stageHelp:
      "Mova esta janela para o projetor ou segundo monitor e ative o ecrã inteiro. Mantenha os controlos no seu próprio ecrã.",
    privacy:
      "Partilhe apenas a janela do público. As notas e os controlos ficam na janela do apresentador.",
    focus: "Vista só de diapositivo",
    exitFocus: "Sair da vista só de diapositivo",
    focusHelp: "Mova o ponteiro ou prima Tab para mostrar os controlos. Prima Escape para voltar.",
    fallback: "O ecrã inteiro não está disponível. A vista só de diapositivo preenche esta janela.",
    rejected:
      "Não foi possível iniciar o ecrã inteiro. A vista só de diapositivo está ativa; use Sair ou Escape para voltar.",
    exitRejected:
      "Não foi possível fechar o ecrã inteiro. Use o comando Escape do navegador para voltar.",
  },
  "ja-JP": {
    launch: "別の画面で発表",
    setup: "セカンドスクリーンの設定",
    launcherHelp:
      "参加者用ウィンドウをプロジェクターまたは別のモニターに移動し、そのウィンドウで全画面表示を選んでください。",
    stageHelp:
      "このウィンドウをプロジェクターまたは別のモニターに移動し、全画面表示にしてください。操作用ウィンドウは手元の画面に残してください。",
    privacy:
      "共有するのは参加者用ウィンドウだけです。発表者ノートと操作ボタンはホスト画面に残ります。",
    focus: "スライドのみ表示",
    exitFocus: "スライドのみ表示を終了",
    focusHelp: "ポインターを動かすか Tab キーで操作ボタンを表示します。Esc キーで戻ります。",
    fallback: "全画面表示は利用できません。スライドのみ表示でこのウィンドウ全体を使えます。",
    rejected:
      "全画面表示を開始できませんでした。スライドのみ表示が有効です。終了ボタンまたは Esc キーで戻れます。",
    exitRejected: "全画面表示を終了できませんでした。ブラウザーの Esc 操作で戻ってください。",
  },
  "ko-KR": {
    launch: "다른 화면에서 발표",
    setup: "두 번째 화면 설정",
    launcherHelp:
      "참여자 창을 프로젝터나 두 번째 모니터로 옮긴 다음 그 창에서 전체 화면을 선택하세요.",
    stageHelp:
      "이 창을 프로젝터나 두 번째 모니터로 옮긴 다음 전체 화면으로 전환하세요. 진행 제어는 자신의 화면에 두세요.",
    privacy: "참여자 창만 공유하세요. 발표자 노트와 제어 기능은 진행자 창에 남습니다.",
    focus: "슬라이드만 보기",
    exitFocus: "슬라이드만 보기 종료",
    focusHelp: "포인터를 움직이거나 Tab 키를 누르면 제어가 표시됩니다. Escape 키로 돌아갑니다.",
    fallback: "전체 화면을 사용할 수 없습니다. 슬라이드만 보기로 이 창 전체를 사용할 수 있습니다.",
    rejected:
      "전체 화면을 시작하지 못했습니다. 슬라이드만 보기가 활성화되었습니다. 종료 또는 Escape 키로 돌아가세요.",
    exitRejected: "전체 화면을 종료하지 못했습니다. 브라우저의 Escape 제어로 돌아가세요.",
  },
  "zh-CN": {
    launch: "在另一屏幕上演示",
    setup: "设置第二块屏幕",
    launcherHelp: "将观众窗口移至投影仪或第二台显示器，然后在该窗口中选择进入全屏。",
    stageHelp: "将此窗口移至投影仪或第二台显示器，然后进入全屏。请将主持控制保留在自己的屏幕上。",
    privacy: "仅共享观众窗口。演讲者备注和控制功能保留在主持窗口中。",
    focus: "仅显示幻灯片",
    exitFocus: "退出仅显示幻灯片",
    focusHelp: "移动指针或按 Tab 显示控制按钮。按 Escape 返回。",
    fallback: "无法使用全屏。仅显示幻灯片模式仍会填满此窗口。",
    rejected: "无法启动全屏。仅显示幻灯片模式已启用；使用退出按钮或 Escape 返回。",
    exitRejected: "无法退出全屏。请使用浏览器的 Escape 控制返回。",
  },
  "zh-TW": {
    launch: "在另一個螢幕上簡報",
    setup: "設定第二個螢幕",
    launcherHelp: "將觀眾視窗移至投影機或第二台螢幕，然後在該視窗中選擇進入全螢幕。",
    stageHelp: "將此視窗移至投影機或第二台螢幕，然後進入全螢幕。請將主持控制保留在自己的螢幕上。",
    privacy: "僅分享觀眾視窗。簡報者備忘稿和控制功能保留在主持視窗中。",
    focus: "僅顯示投影片",
    exitFocus: "結束僅顯示投影片",
    focusHelp: "移動指標或按 Tab 顯示控制按鈕。按 Escape 返回。",
    fallback: "無法使用全螢幕。僅顯示投影片模式仍會填滿此視窗。",
    rejected: "無法啟動全螢幕。僅顯示投影片模式已啟用；使用結束按鈕或 Escape 返回。",
    exitRejected: "無法結束全螢幕。請使用瀏覽器的 Escape 控制返回。",
  },
};

export function stageDisplayCopy(locale: SupportedLocale): Copy {
  return messages[locale];
}
