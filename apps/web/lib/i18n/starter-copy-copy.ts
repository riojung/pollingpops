import type { SupportedLocale } from "@openround/contracts";

const english = {
  checkingRecovery: "Checking copy recovery…",
  recoveryError:
    "Copy recovery could not be read or saved. Allow tab storage, then retry recovery before creating a copy.",
  retryRecovery: "Retry copy recovery",
  pendingCopy:
    "A previous copy may already exist. Retry the same copy to confirm the result. Keep this tab open until the copy is confirmed.",
  retryCopy: "Retry same copy",
  creatingCopy: "Creating copy…",
  openCreated: "Open created copy",
  openError: "The copy was created, but it could not be opened. Open the created copy again.",
  cleanupError:
    "The copy was created. Allow tab storage, then retry recovery to finish opening it.",
  createAnother: "Create another copy",
  restartNotice:
    "This request cannot be completed. Create another copy to use the current template content.",
  requestError: "The copy was not confirmed. Retry the same copy to avoid creating a duplicate.",
  conflict:
    "This saved request conflicts with an earlier copy. Check your Library for the existing copy. The request stays saved to prevent duplicates.",
} as const;

export type StarterCopyCopy = { -readonly [Key in keyof typeof english]: string };

// Source-bound editorial preparation; existing locale Preview and human-review gates apply.
const translations: Record<Exclude<SupportedLocale, "en-CA">, StarterCopyCopy> = {
  "fr-FR": {
    checkingRecovery: "Vérification de la récupération de la copie…",
    recoveryError:
      "Impossible de lire ou d’enregistrer les données de récupération de la copie. Autorisez le stockage de l’onglet, puis réessayez la récupération avant de créer une copie.",
    retryRecovery: "Réessayer la récupération de la copie",
    pendingCopy:
      "Une copie précédente existe peut-être déjà. Réessayez la même copie pour confirmer le résultat. Gardez cet onglet ouvert jusqu’à la confirmation de la copie.",
    retryCopy: "Réessayer la même copie",
    creatingCopy: "Création de la copie…",
    openCreated: "Ouvrir la copie créée",
    openError:
      "La copie a été créée, mais n’a pas pu être ouverte. Ouvrez à nouveau la copie créée.",
    cleanupError:
      "La copie a été créée. Autorisez le stockage de l’onglet, puis réessayez la récupération pour terminer son ouverture.",
    createAnother: "Créer une autre copie",
    restartNotice:
      "Cette demande ne peut pas aboutir. Créez une autre copie pour utiliser le contenu actuel du modèle.",
    requestError:
      "La copie n’a pas été confirmée. Réessayez la même copie pour éviter de créer un doublon.",
    conflict:
      "Cette demande enregistrée est en conflit avec une copie précédente. Vérifiez votre bibliothèque pour retrouver la copie existante. La demande reste enregistrée pour éviter les doublons.",
  },
  "de-DE": {
    checkingRecovery: "Wiederherstellung der Kopie wird geprüft…",
    recoveryError:
      "Die Wiederherstellung der Kopie konnte nicht gelesen oder gespeichert werden. Erlauben Sie den Tab-Speicher und versuchen Sie die Wiederherstellung erneut, bevor Sie eine Kopie erstellen.",
    retryRecovery: "Kopie erneut wiederherstellen",
    pendingCopy:
      "Eine frühere Kopie ist möglicherweise bereits vorhanden. Versuchen Sie dieselbe Kopie erneut, um das Ergebnis zu bestätigen. Lassen Sie diesen Tab geöffnet, bis die Kopie bestätigt ist.",
    retryCopy: "Dieselbe Kopie erneut versuchen",
    creatingCopy: "Kopie wird erstellt…",
    openCreated: "Erstellte Kopie öffnen",
    openError:
      "Die Kopie wurde erstellt, konnte aber nicht geöffnet werden. Öffnen Sie die erstellte Kopie erneut.",
    cleanupError:
      "Die Kopie wurde erstellt. Erlauben Sie den Tab-Speicher und versuchen Sie die Wiederherstellung erneut, um sie zu öffnen.",
    createAnother: "Weitere Kopie erstellen",
    restartNotice:
      "Diese Anfrage kann nicht abgeschlossen werden. Erstellen Sie eine weitere Kopie mit dem aktuellen Vorlageninhalt.",
    requestError:
      "Die Kopie wurde nicht bestätigt. Versuchen Sie dieselbe Kopie erneut, um ein Duplikat zu vermeiden.",
    conflict:
      "Diese gespeicherte Anfrage steht im Konflikt mit einer früheren Kopie. Prüfen Sie Ihre Bibliothek auf die vorhandene Kopie. Die Anfrage bleibt gespeichert, um Duplikate zu verhindern.",
  },
  "es-ES": {
    checkingRecovery: "Comprobando la recuperación de la copia…",
    recoveryError:
      "No se ha podido leer o guardar la recuperación de la copia. Permite el almacenamiento de la pestaña y reintenta la recuperación antes de crear una copia.",
    retryRecovery: "Reintentar la recuperación de la copia",
    pendingCopy:
      "Es posible que ya exista una copia anterior. Reintenta la misma copia para confirmar el resultado. Mantén esta pestaña abierta hasta que se confirme la copia.",
    retryCopy: "Reintentar la misma copia",
    creatingCopy: "Creando copia…",
    openCreated: "Abrir la copia creada",
    openError: "La copia se ha creado, pero no se ha podido abrir. Abre de nuevo la copia creada.",
    cleanupError:
      "La copia se ha creado. Permite el almacenamiento de la pestaña y reintenta la recuperación para terminar de abrirla.",
    createAnother: "Crear otra copia",
    restartNotice:
      "No se puede completar esta solicitud. Crea otra copia para usar el contenido actual de la plantilla.",
    requestError:
      "No se ha confirmado la copia. Reintenta la misma copia para evitar crear un duplicado.",
    conflict:
      "Esta solicitud guardada entra en conflicto con una copia anterior. Revisa tu biblioteca para encontrar la copia existente. La solicitud se mantiene guardada para evitar duplicados.",
  },
  "it-IT": {
    checkingRecovery: "Verifica del recupero della copia…",
    recoveryError:
      "Impossibile leggere o salvare il recupero della copia. Consenti l’archiviazione della scheda, poi riprova il recupero prima di creare una copia.",
    retryRecovery: "Riprova il recupero della copia",
    pendingCopy:
      "Una copia precedente potrebbe già esistere. Riprova la stessa copia per confermare il risultato. Tieni aperta questa scheda fino alla conferma della copia.",
    retryCopy: "Riprova la stessa copia",
    creatingCopy: "Creazione della copia…",
    openCreated: "Apri la copia creata",
    openError:
      "La copia è stata creata, ma non è stato possibile aprirla. Apri di nuovo la copia creata.",
    cleanupError:
      "La copia è stata creata. Consenti l’archiviazione della scheda, poi riprova il recupero per completarne l’apertura.",
    createAnother: "Crea un’altra copia",
    restartNotice:
      "Questa richiesta non può essere completata. Crea un’altra copia per usare il contenuto attuale del modello.",
    requestError:
      "La copia non è stata confermata. Riprova la stessa copia per evitare di creare un duplicato.",
    conflict:
      "Questa richiesta salvata è in conflitto con una copia precedente. Controlla nella libreria se la copia esiste già. La richiesta resta salvata per evitare duplicati.",
  },
  "pt-PT": {
    checkingRecovery: "A verificar a recuperação da cópia…",
    recoveryError:
      "Não foi possível ler ou guardar a recuperação da cópia. Permita o armazenamento do separador e tente recuperar novamente antes de criar uma cópia.",
    retryRecovery: "Tentar recuperar a cópia novamente",
    pendingCopy:
      "Uma cópia anterior pode já existir. Repita a mesma cópia para confirmar o resultado. Mantenha este separador aberto até a cópia ser confirmada.",
    retryCopy: "Repetir a mesma cópia",
    creatingCopy: "A criar a cópia…",
    openCreated: "Abrir a cópia criada",
    openError: "A cópia foi criada, mas não foi possível abri-la. Abra novamente a cópia criada.",
    cleanupError:
      "A cópia foi criada. Permita o armazenamento do separador e tente recuperar novamente para terminar a abertura.",
    createAnother: "Criar outra cópia",
    restartNotice:
      "Não é possível concluir este pedido. Crie outra cópia para utilizar o conteúdo atual do modelo.",
    requestError:
      "A cópia não foi confirmada. Repita a mesma cópia para evitar criar um duplicado.",
    conflict:
      "Este pedido guardado entra em conflito com uma cópia anterior. Verifique a sua biblioteca para encontrar a cópia existente. O pedido mantém-se guardado para evitar duplicados.",
  },
  "ja-JP": {
    checkingRecovery: "コピーの復元を確認中…",
    recoveryError:
      "コピーの復元情報を読み取り、または保存できませんでした。タブのストレージを許可し、コピーを作成する前に復元を再試行してください。",
    retryRecovery: "コピーの復元を再試行",
    pendingCopy:
      "以前のコピーがすでに存在する可能性があります。同じコピーを再試行して結果を確認してください。コピーが確認されるまで、このタブを開いたままにしてください。",
    retryCopy: "同じコピーを再試行",
    creatingCopy: "コピーを作成中…",
    openCreated: "作成したコピーを開く",
    openError:
      "コピーは作成されましたが、開けませんでした。作成したコピーをもう一度開いてください。",
    cleanupError:
      "コピーは作成されました。タブのストレージを許可し、復元を再試行してコピーを開いてください。",
    createAnother: "別のコピーを作成",
    restartNotice:
      "このリクエストは完了できません。現在のテンプレート内容を使うには、別のコピーを作成してください。",
    requestError:
      "コピーを確認できませんでした。重複したコピーを作成しないように、同じコピーを再試行してください。",
    conflict:
      "この保存済みリクエストは以前のコピーと競合しています。既存のコピーがないかライブラリを確認してください。重複を防ぐため、このリクエストは保存されたままになります。",
  },
  "ko-KR": {
    checkingRecovery: "복사본 복구를 확인하는 중…",
    recoveryError:
      "복사본 복구 정보를 읽거나 저장하지 못했습니다. 탭 저장소를 허용한 후 복사본을 만들기 전에 복구를 다시 시도해 주세요.",
    retryRecovery: "복사본 복구 다시 시도",
    pendingCopy:
      "이전 복사본이 이미 있을 수 있습니다. 같은 복사를 다시 시도하여 결과를 확인해 주세요. 복사본이 확인될 때까지 이 탭을 열어 두세요.",
    retryCopy: "같은 복사 다시 시도",
    creatingCopy: "복사본을 만드는 중…",
    openCreated: "생성된 복사본 열기",
    openError: "복사본이 생성되었지만 열지 못했습니다. 생성된 복사본을 다시 열어 주세요.",
    cleanupError:
      "복사본이 생성되었습니다. 탭 저장소를 허용한 후 복구를 다시 시도하여 복사본을 열어 주세요.",
    createAnother: "다른 복사본 만들기",
    restartNotice:
      "이 요청을 완료할 수 없습니다. 현재 템플릿 내용으로 다른 복사본을 만들어 주세요.",
    requestError:
      "복사본 생성 여부를 확인하지 못했습니다. 복사본이 중복 생성되지 않도록 같은 복사를 다시 시도해 주세요.",
    conflict:
      "저장된 요청이 이전 복사본과 충돌합니다. 라이브러리에서 기존 복사본을 확인해 주세요. 중복 생성을 방지하기 위해 요청은 저장된 상태로 유지됩니다.",
  },
  "zh-CN": {
    checkingRecovery: "正在检查副本恢复…",
    recoveryError: "无法读取或保存副本恢复信息。请允许标签页存储，然后在创建副本前重试恢复。",
    retryRecovery: "重试恢复副本",
    pendingCopy:
      "之前的副本可能已存在。请重试同一次复制以确认结果。请保持此标签页打开，直到确认副本创建结果。",
    retryCopy: "重试同一次复制",
    creatingCopy: "正在创建副本…",
    openCreated: "打开已创建的副本",
    openError: "副本已创建，但无法打开。请再次打开已创建的副本。",
    cleanupError: "副本已创建。请允许标签页存储，然后重试恢复以完成打开。",
    createAnother: "创建另一个副本",
    restartNotice: "无法完成此请求。请创建另一个副本以使用模板的当前内容。",
    requestError: "未能确认副本是否已创建。请重试同一次复制，以免创建重复副本。",
    conflict:
      "此已保存的请求与之前的副本冲突。请在资料库中查找现有副本。此请求将保留，以防重复创建。",
  },
  "zh-TW": {
    checkingRecovery: "正在檢查副本復原…",
    recoveryError: "無法讀取或儲存副本復原資訊。請允許分頁儲存空間，然後在建立副本前重試復原。",
    retryRecovery: "重試復原副本",
    pendingCopy:
      "先前的副本可能已存在。請重試同一次複製以確認結果。請保持此分頁開啟，直到確認副本建立結果。",
    retryCopy: "重試同一次複製",
    creatingCopy: "正在建立副本…",
    openCreated: "開啟已建立的副本",
    openError: "副本已建立，但無法開啟。請再次開啟已建立的副本。",
    cleanupError: "副本已建立。請允許分頁儲存空間，然後重試復原以完成開啟。",
    createAnother: "建立另一個副本",
    restartNotice: "無法完成此要求。請建立另一個副本以使用範本的目前內容。",
    requestError: "未能確認副本是否已建立。請重試同一次複製，以免建立重複副本。",
    conflict:
      "此已儲存的要求與先前的副本衝突。請在資料庫中尋找現有副本。此要求將保留，以防重複建立。",
  },
};

export function starterCopyCopy(locale: SupportedLocale = "en-CA"): StarterCopyCopy {
  const copy =
    locale !== "en-CA" && Object.hasOwn(translations, locale) ? translations[locale] : english;
  return { ...copy };
}

/** Exact displayed templates, with one source-bound native-review item per string. */
export function starterCopyCopyEntries(locale: SupportedLocale = "en-CA"): Record<string, string> {
  return { ...starterCopyCopy(locale) };
}
