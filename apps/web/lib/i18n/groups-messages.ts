import type { SupportedLocale } from "@openround/contracts";

export const groupsEnglishMessages = {
  eyebrow: "People & collaboration",
  description:
    "Keep the right people, shared content, and plans together across your workspace and organization.",
  allGroups: "All groups",
  workspace: "My workspace",
  organization: "Organization",
  scopes: "Group scope",
  purpose: "Purpose",
  access: "My access",
  status: "Status",
  sort: "Sort by",
  updated: "Recently updated",
  nameSort: "Name A–Z",
  clear: "Reset filters",
  results: "{count} groups",
  resultOne: "{count} group",
  inviteOnly: "Invite-only groups · Membership is managed by group owners",
  content: "Content",
  settings: "Group settings",
  team: "Team",
  department: "Department",
  project: "Project",
  cohort: "Cohort",
  community: "Community",
  other: "Other",
  active: "Active",
  archived: "Archived",
  allPurposes: "All purposes",
  allAccess: "All roles",
  allStatuses: "All statuses",
  save: "Save changes",
  saving: "Saving…",
  archive: "Archive group",
  restore: "Restore group",
  makeOwner: "Make owner",
  makeMember: "Make member",
  removeMember: "Remove member",
  removeMemberConfirm:
    "Remove this member from the group? Their organization and workspace memberships will be kept.",
  memberAccess: "Member",
  ownerAccess: "Owner",
  archivedHelp: "This group is archived. An owner can restore it to resume collaboration.",
  organizationHelp:
    "Curate published content from your organization library. Each publication keeps its existing access permissions and review date.",
  workspaceContentHelp:
    "Share Rounds, Presentations, or Guided workshops from this workspace. Canvas boards shared with this group also appear here.",
  noContent: "No shared content yet",
  addPublication: "Add publication",
  choosePublication: "Choose an organization publication",
  loadMore: "Load more publications",
  memberDirectory: "Organization member",
  addMemberHelp:
    "Only existing members of this organization can be added. Group membership does not grant a workspace role.",
  readOnly: "Your current access allows you to view this group.",
  creationHelp: "Choose who this group brings together. Add members and content after creating it.",
  scopeHelp:
    "Workspace groups bring together workspace members. Organization groups connect members across workspaces.",
  manageHelp: "Owners manage this group and its members.",
  collectionOnly: "Remove from group",
  backToGroups: "Back to groups",
  noMatchHelp: "Try another search or reset your filters.",
  loadFailed: "Groups could not be loaded.",
  retry: "Try again",
  viewGroup: "Group sections",
  contentType: "Content type",
  allContent: "All content",
  canvas: "Canvas boards",
  workshop: "Guided workshops",
  reviewDates: "Review dates appear on each publication.",
  findMember: "Find organization member",
  moreMembers: "More members are available. Refine your search to find a person.",
  collectionHelp:
    "Adding a publication here keeps its organization-wide audience. It does not grant editing access to the original.",
  saved: "Changes saved",
  lastOwner:
    "Keep at least one owner. Make another member an owner before removing or changing the last owner.",
  memberLoadFailed: "Organization members could not be loaded. Try again.",
} as const;

type Copy = Record<keyof typeof groupsEnglishMessages, string>;
const rows: Record<Exclude<SupportedLocale, "en-CA">, string> = {
  "fr-FR": `Personnes et collaboration|Réunissez les bonnes personnes, les contenus partagés et les projets de votre espace et de votre organisation.|Tous les groupes|Mon espace|Organisation|Portée du groupe|Objectif|Mon accès|Statut|Trier par|Mise à jour récente|Nom A–Z|Réinitialiser les filtres|{count} groupes|{count} groupe|Groupes sur invitation · Les propriétaires gèrent les membres|Contenu|Paramètres du groupe|Équipe|Service|Projet|Cohorte|Communauté|Autre|Actif|Archivé|Tous les objectifs|Tous les rôles|Tous les statuts|Enregistrer|Enregistrement…|Archiver le groupe|Restaurer le groupe|Nommer propriétaire|Nommer membre|Retirer le membre|Retirer ce membre du groupe ? Ses appartenances à l’organisation et à l’espace seront conservées.|Membre|Propriétaire|Ce groupe est archivé. Un propriétaire peut le restaurer pour reprendre la collaboration.|Sélectionnez des publications de la bibliothèque de votre organisation. Chaque publication conserve ses autorisations et sa date de consultation.|Partagez des rounds, des présentations ou des ateliers guidés de cet espace. Les tableaux canevas partagés avec ce groupe apparaissent aussi ici.|Aucun contenu partagé|Ajouter une publication|Choisir une publication de l’organisation|Charger plus de publications|Membre de l’organisation|Seuls les membres actuels de cette organisation peuvent être ajoutés. Le groupe n’accorde aucun rôle dans un espace.|Votre accès actuel vous permet de consulter ce groupe.|Choisissez les personnes à réunir. Ajoutez des membres et du contenu après la création.|Les groupes d’espace réunissent ses membres. Les groupes d’organisation relient les membres de plusieurs espaces.|Les propriétaires gèrent ce groupe et ses membres.|Retirer du groupe|Retour aux groupes|Essayez une autre recherche ou réinitialisez les filtres.|Impossible de charger les groupes.|Réessayer|Sections du groupe|Type de contenu|Tout le contenu|Tableaux canevas|Ateliers guidés|Les dates de consultation figurent sur chaque publication.|Rechercher un membre de l’organisation|D’autres membres sont disponibles. Précisez votre recherche.|Ajouter une publication ici conserve son audience dans toute l’organisation. Cela n’accorde aucun droit de modification de l’original.|Modifications enregistrées|Conservez au moins un propriétaire. Nommez un autre membre propriétaire avant de retirer le dernier propriétaire ou de changer son rôle.|Impossible de charger les membres de l’organisation. Réessayez.`,
  "de-DE": `Personen und Zusammenarbeit|Verbinden Sie Personen, geteilte Inhalte und Pläne in Ihrem Arbeitsbereich und Ihrer Organisation.|Alle Gruppen|Mein Arbeitsbereich|Organisation|Gruppenbereich|Zweck|Mein Zugriff|Status|Sortieren nach|Zuletzt aktualisiert|Name A–Z|Filter zurücksetzen|{count} Gruppen|{count} Gruppe|Gruppen auf Einladung · Eigentümer verwalten die Mitgliedschaft|Inhalte|Gruppeneinstellungen|Team|Abteilung|Projekt|Lerngruppe|Community|Sonstiges|Aktiv|Archiviert|Alle Zwecke|Alle Rollen|Alle Status|Änderungen speichern|Wird gespeichert…|Gruppe archivieren|Gruppe wiederherstellen|Zum Eigentümer machen|Zum Mitglied machen|Mitglied entfernen|Dieses Mitglied aus der Gruppe entfernen? Die Organisations- und Arbeitsbereichsmitgliedschaft bleibt bestehen.|Mitglied|Eigentümer|Diese Gruppe ist archiviert. Ein Eigentümer kann sie wiederherstellen.|Stellen Sie Veröffentlichungen aus der Organisationsbibliothek zusammen. Berechtigungen und Prüftermine bleiben erhalten.|Teilen Sie Runden, Präsentationen oder geführte Workshops aus diesem Arbeitsbereich. Geteilte Canvas-Boards erscheinen ebenfalls hier.|Noch keine geteilten Inhalte|Veröffentlichung hinzufügen|Organisationsveröffentlichung auswählen|Weitere Veröffentlichungen laden|Organisationsmitglied|Nur bestehende Mitglieder dieser Organisation können hinzugefügt werden. Die Gruppe vergibt keine Arbeitsbereichsrolle.|Ihr aktueller Zugriff erlaubt das Ansehen dieser Gruppe.|Wählen Sie, wen diese Gruppe verbindet. Fügen Sie danach Mitglieder und Inhalte hinzu.|Arbeitsbereichsgruppen verbinden dessen Mitglieder. Organisationsgruppen verbinden Mitglieder mehrerer Arbeitsbereiche.|Eigentümer verwalten diese Gruppe und ihre Mitglieder.|Aus Gruppe entfernen|Zurück zu Gruppen|Versuchen Sie eine andere Suche oder setzen Sie die Filter zurück.|Gruppen konnten nicht geladen werden.|Erneut versuchen|Gruppenbereiche|Inhaltstyp|Alle Inhalte|Canvas-Boards|Geführte Workshops|Prüftermine stehen bei jeder Veröffentlichung.|Organisationsmitglied suchen|Weitere Mitglieder sind verfügbar. Grenzen Sie die Suche ein.|Eine hier hinzugefügte Veröffentlichung bleibt für die gesamte Organisation freigegeben. Das Original kann dadurch nicht bearbeitet werden.|Änderungen gespeichert|Mindestens ein Eigentümer muss bleiben. Ernennen Sie ein anderes Mitglied zum Eigentümer, bevor Sie den letzten entfernen oder dessen Rolle ändern.|Organisationsmitglieder konnten nicht geladen werden. Versuchen Sie es erneut.`,
  "es-ES": `Personas y colaboración|Reúne a las personas, el contenido compartido y los planes de tu espacio y organización.|Todos los grupos|Mi espacio|Organización|Ámbito del grupo|Propósito|Mi acceso|Estado|Ordenar por|Actualizados recientemente|Nombre A–Z|Restablecer filtros|{count} grupos|{count} grupo|Grupos por invitación · Los propietarios gestionan los miembros|Contenido|Configuración del grupo|Equipo|Departamento|Proyecto|Cohorte|Comunidad|Otro|Activo|Archivado|Todos los propósitos|Todos los roles|Todos los estados|Guardar cambios|Guardando…|Archivar grupo|Restaurar grupo|Hacer propietario|Hacer miembro|Eliminar miembro|¿Eliminar a este miembro del grupo? Se conservarán sus membresías en la organización y el espacio.|Miembro|Propietario|Este grupo está archivado. Un propietario puede restaurarlo para retomar la colaboración.|Selecciona publicaciones de la biblioteca de tu organización. Cada publicación conserva sus permisos y fecha de revisión.|Comparte rondas, presentaciones o talleres guiados de este espacio. Los tableros de lienzo compartidos con el grupo también aparecen aquí.|Aún no hay contenido compartido|Añadir publicación|Elegir una publicación de la organización|Cargar más publicaciones|Miembro de la organización|Solo se pueden añadir miembros actuales de esta organización. El grupo no otorga ningún rol en un espacio.|Tu acceso actual permite ver este grupo.|Elige a quién reúne este grupo. Añade miembros y contenido después de crearlo.|Los grupos de espacio reúnen a sus miembros. Los grupos de organización conectan miembros de distintos espacios.|Los propietarios gestionan este grupo y sus miembros.|Quitar del grupo|Volver a los grupos|Prueba otra búsqueda o restablece los filtros.|No se pudieron cargar los grupos.|Reintentar|Secciones del grupo|Tipo de contenido|Todo el contenido|Tableros de lienzo|Talleres guiados|Las fechas de revisión aparecen en cada publicación.|Buscar miembro de la organización|Hay más miembros disponibles. Refina la búsqueda.|Añadir una publicación aquí mantiene su audiencia en toda la organización. No concede permiso para editar el original.|Cambios guardados|Debe quedar al menos un propietario. Haz propietario a otro miembro antes de eliminar al último o cambiar su rol.|No se pudieron cargar los miembros de la organización. Inténtalo de nuevo.`,
  "it-IT": `Persone e collaborazione|Riunisci persone, contenuti condivisi e programmi del tuo spazio e della tua organizzazione.|Tutti i gruppi|Il mio spazio|Organizzazione|Ambito del gruppo|Scopo|Il mio accesso|Stato|Ordina per|Aggiornati di recente|Nome A–Z|Reimposta filtri|{count} gruppi|{count} gruppo|Gruppi su invito · I proprietari gestiscono i membri|Contenuti|Impostazioni gruppo|Team|Reparto|Progetto|Coorte|Comunità|Altro|Attivo|Archiviato|Tutti gli scopi|Tutti i ruoli|Tutti gli stati|Salva modifiche|Salvataggio…|Archivia gruppo|Ripristina gruppo|Rendi proprietario|Rendi membro|Rimuovi membro|Rimuovere questo membro dal gruppo? Le sue appartenenze all’organizzazione e allo spazio saranno mantenute.|Membro|Proprietario|Questo gruppo è archiviato. Un proprietario può ripristinarlo per riprendere la collaborazione.|Seleziona pubblicazioni dalla biblioteca della tua organizzazione. Ogni pubblicazione mantiene permessi e data di revisione.|Condividi round, presentazioni o workshop guidati da questo spazio. Qui compaiono anche le lavagne canvas condivise con il gruppo.|Nessun contenuto condiviso|Aggiungi pubblicazione|Scegli una pubblicazione dell’organizzazione|Carica altre pubblicazioni|Membro dell’organizzazione|Si possono aggiungere solo membri attuali dell’organizzazione. Il gruppo non assegna un ruolo nello spazio.|Il tuo accesso attuale consente di visualizzare questo gruppo.|Scegli chi riunire. Aggiungi membri e contenuti dopo la creazione.|I gruppi dello spazio riuniscono i suoi membri. I gruppi dell’organizzazione collegano membri di spazi diversi.|I proprietari gestiscono questo gruppo e i suoi membri.|Rimuovi dal gruppo|Torna ai gruppi|Prova un’altra ricerca o reimposta i filtri.|Impossibile caricare i gruppi.|Riprova|Sezioni del gruppo|Tipo di contenuto|Tutti i contenuti|Lavagne canvas|Workshop guidati|Le date di revisione sono riportate su ogni pubblicazione.|Cerca membro dell’organizzazione|Sono disponibili altri membri. Affina la ricerca.|Aggiungere qui una pubblicazione mantiene il pubblico dell’intera organizzazione. Non concede accesso alla modifica dell’originale.|Modifiche salvate|Mantieni almeno un proprietario. Nomina un altro membro proprietario prima di rimuovere l’ultimo o cambiarne il ruolo.|Impossibile caricare i membri dell’organizzazione. Riprova.`,
  "pt-PT": `Pessoas e colaboração|Reúna pessoas, conteúdos partilhados e planos do seu espaço e da sua organização.|Todos os grupos|O meu espaço|Organização|Âmbito do grupo|Objetivo|O meu acesso|Estado|Ordenar por|Atualizados recentemente|Nome A–Z|Repor filtros|{count} grupos|{count} grupo|Grupos por convite · Os proprietários gerem os membros|Conteúdo|Definições do grupo|Equipa|Departamento|Projeto|Coorte|Comunidade|Outro|Ativo|Arquivado|Todos os objetivos|Todas as funções|Todos os estados|Guardar alterações|A guardar…|Arquivar grupo|Restaurar grupo|Tornar proprietário|Tornar membro|Remover membro|Remover este membro do grupo? As suas associações à organização e ao espaço serão mantidas.|Membro|Proprietário|Este grupo está arquivado. Um proprietário pode restaurá-lo para retomar a colaboração.|Selecione publicações da biblioteca da organização. Cada publicação mantém as permissões e a data de revisão.|Partilhe rondas, apresentações ou workshops guiados deste espaço. Os quadros de tela partilhados com o grupo também aparecem aqui.|Ainda não há conteúdo partilhado|Adicionar publicação|Escolher uma publicação da organização|Carregar mais publicações|Membro da organização|Apenas os membros atuais desta organização podem ser adicionados. O grupo não atribui uma função no espaço.|O seu acesso atual permite ver este grupo.|Escolha quem reunir. Adicione membros e conteúdo depois de criar o grupo.|Os grupos do espaço reúnem os seus membros. Os grupos da organização ligam membros de vários espaços.|Os proprietários gerem este grupo e os seus membros.|Remover do grupo|Voltar aos grupos|Tente outra pesquisa ou reponha os filtros.|Não foi possível carregar os grupos.|Tentar novamente|Secções do grupo|Tipo de conteúdo|Todo o conteúdo|Quadros de tela|Workshops guiados|As datas de revisão aparecem em cada publicação.|Encontrar membro da organização|Existem mais membros disponíveis. Refine a pesquisa.|Adicionar aqui uma publicação mantém o público de toda a organização. Não permite editar o original.|Alterações guardadas|Mantenha pelo menos um proprietário. Torne outro membro proprietário antes de remover o último ou alterar a sua função.|Não foi possível carregar os membros da organização. Tente novamente.`,
  "ja-JP": `メンバーとコラボレーション|ワークスペースや組織のメンバー、共有コンテンツ、予定をひとつにまとめます。|すべてのグループ|マイワークスペース|組織|グループの範囲|目的|自分の権限|状態|並び順|更新が新しい順|名前順|フィルターをリセット|{count} グループ|{count} グループ|招待制グループ · オーナーがメンバーを管理します|コンテンツ|グループ設定|チーム|部署|プロジェクト|コホート|コミュニティ|その他|有効|アーカイブ済み|すべての目的|すべての役割|すべての状態|変更を保存|保存中…|グループをアーカイブ|グループを復元|オーナーにする|メンバーにする|メンバーを削除|このメンバーをグループから削除しますか？組織とワークスペースの所属は維持されます。|メンバー|オーナー|このグループはアーカイブ済みです。オーナーが復元すると共同作業を再開できます。|組織ライブラリの公開コンテンツをまとめます。各公開物のアクセス権限と確認期限は維持されます。|このワークスペースのラウンド、プレゼンテーション、ガイド付きワークショップを共有できます。グループと共有されたキャンバスボードも表示されます。|共有コンテンツはまだありません|公開物を追加|組織の公開物を選択|公開物をさらに読み込む|組織メンバー|追加できるのはこの組織の既存メンバーのみです。グループへの所属ではワークスペースの役割は付与されません。|現在の権限でこのグループを閲覧できます。|このグループに集める人を選びます。作成後にメンバーとコンテンツを追加できます。|ワークスペースグループはそのメンバーをまとめます。組織グループは複数のワークスペースのメンバーをつなぎます。|オーナーはグループとメンバーを管理します。|グループから削除|グループに戻る|別のキーワードで検索するか、フィルターをリセットしてください。|グループを読み込めませんでした。|再試行|グループのセクション|コンテンツの種類|すべてのコンテンツ|キャンバスボード|ガイド付きワークショップ|各公開物に確認期限が表示されます。|組織メンバーを検索|さらにメンバーがいます。検索条件を絞り込んでください。|ここに公開物を追加しても、組織全体への公開は維持されます。元のコンテンツの編集権限は付与されません。|変更を保存しました|少なくとも1人のオーナーが必要です。最後のオーナーの削除や役割変更の前に、別のメンバーをオーナーにしてください。|組織メンバーを読み込めませんでした。もう一度お試しください。`,
  "ko-KR": `사람과 협업|워크스페이스와 조직의 구성원, 공유 콘텐츠, 계획을 한곳에서 관리하세요.|모든 그룹|내 워크스페이스|조직|그룹 범위|목적|내 권한|상태|정렬 기준|최근 업데이트순|이름순|필터 초기화|그룹 {count}개|그룹 {count}개|초대 전용 그룹 · 소유자가 구성원을 관리합니다|콘텐츠|그룹 설정|팀|부서|프로젝트|코호트|커뮤니티|기타|활성|보관됨|모든 목적|모든 역할|모든 상태|변경 사항 저장|저장 중…|그룹 보관|그룹 복원|소유자로 지정|구성원으로 지정|구성원 제거|이 구성원을 그룹에서 제거할까요? 조직 및 워크스페이스 소속은 유지됩니다.|구성원|소유자|보관된 그룹입니다. 소유자가 복원하면 협업을 다시 시작할 수 있습니다.|조직 라이브러리의 게시된 콘텐츠를 모아 보세요. 각 게시물의 접근 권한과 검토 기한은 유지됩니다.|이 워크스페이스의 라운드, 프레젠테이션, 가이드 워크숍을 공유하세요. 그룹에 공유된 캔버스 보드도 여기에 표시됩니다.|아직 공유된 콘텐츠가 없습니다|게시물 추가|조직 게시물 선택|게시물 더 불러오기|조직 구성원|현재 이 조직에 속한 구성원만 추가할 수 있습니다. 그룹 가입으로 워크스페이스 역할이 부여되지는 않습니다.|현재 권한으로 이 그룹을 볼 수 있습니다.|함께할 대상을 선택하세요. 그룹을 만든 후 구성원과 콘텐츠를 추가할 수 있습니다.|워크스페이스 그룹은 해당 구성원을 모읍니다. 조직 그룹은 여러 워크스페이스의 구성원을 연결합니다.|소유자는 그룹과 구성원을 관리합니다.|그룹에서 제거|그룹 목록으로|다른 검색어를 사용하거나 필터를 초기화하세요.|그룹을 불러오지 못했습니다.|다시 시도|그룹 섹션|콘텐츠 유형|모든 콘텐츠|캔버스 보드|가이드 워크숍|각 게시물에 검토 기한이 표시됩니다.|조직 구성원 찾기|더 많은 구성원이 있습니다. 검색 조건을 좁혀 보세요.|여기에 게시물을 추가해도 조직 전체 공개 범위는 유지됩니다. 원본 편집 권한이 부여되지는 않습니다.|변경 사항을 저장했습니다|소유자를 최소 한 명 유지하세요. 마지막 소유자를 제거하거나 역할을 변경하기 전에 다른 구성원을 소유자로 지정하세요.|조직 구성원을 불러오지 못했습니다. 다시 시도하세요.`,
  "zh-CN": `成员与协作|集中管理工作区和组织的成员、共享内容与计划。|所有群组|我的工作区|组织|群组范围|用途|我的权限|状态|排序方式|最近更新|名称顺序|重置筛选|{count} 个群组|{count} 个群组|邀请制群组 · 所有者管理成员资格|内容|群组设置|团队|部门|项目|学习小组|社区|其他|活跃|已归档|所有用途|所有角色|所有状态|保存更改|正在保存…|归档群组|恢复群组|设为所有者|设为成员|移除成员|要将此成员从群组中移除吗？其组织和工作区成员资格将保留。|成员|所有者|此群组已归档。所有者可恢复群组以继续协作。|整理组织资料库中已发布的内容。每项发布内容保留原有访问权限和审阅日期。|共享此工作区的轮次、演示文稿或引导式工作坊。与群组共享的画布也会在此显示。|尚无共享内容|添加发布内容|选择组织发布内容|加载更多发布内容|组织成员|只能添加此组织的现有成员。加入群组不会授予工作区角色。|您当前的权限允许查看此群组。|选择此群组要汇集的成员。创建后可添加成员和内容。|工作区群组汇集该工作区的成员。组织群组连接不同工作区的成员。|所有者管理此群组及其成员。|从群组移除|返回群组|请尝试其他搜索词或重置筛选条件。|无法加载群组。|重试|群组栏目|内容类型|所有内容|画布|引导式工作坊|每项发布内容均显示审阅日期。|查找组织成员|还有更多成员。请缩小搜索范围。|在此添加发布内容会保留其组织范围的受众，不会授予原始内容的编辑权限。|更改已保存|请保留至少一位所有者。在移除最后一位所有者或更改其角色之前，请先将其他成员设为所有者。|无法加载组织成员。请重试。`,
  "zh-TW": `成員與協作|集中管理工作區和組織的成員、共用內容與計畫。|所有群組|我的工作區|組織|群組範圍|用途|我的權限|狀態|排序方式|最近更新|名稱順序|重設篩選|{count} 個群組|{count} 個群組|邀請制群組 · 擁有者管理成員資格|內容|群組設定|團隊|部門|專案|學習小組|社群|其他|使用中|已封存|所有用途|所有角色|所有狀態|儲存變更|正在儲存…|封存群組|還原群組|設為擁有者|設為成員|移除成員|要將此成員從群組中移除嗎？其組織和工作區成員資格將保留。|成員|擁有者|此群組已封存。擁有者可還原群組以繼續協作。|整理組織資料庫中已發佈的內容。每項發佈內容保留原有存取權限和審閱日期。|共用此工作區的回合、簡報或引導式工作坊。與群組共用的畫布也會在此顯示。|尚無共用內容|新增發佈內容|選擇組織發佈內容|載入更多發佈內容|組織成員|只能新增此組織的現有成員。加入群組不會授予工作區角色。|您目前的權限允許檢視此群組。|選擇此群組要匯集的成員。建立後可新增成員和內容。|工作區群組匯集該工作區的成員。組織群組連結不同工作區的成員。|擁有者管理此群組及其成員。|從群組移除|返回群組|請嘗試其他搜尋詞或重設篩選條件。|無法載入群組。|重試|群組區段|內容類型|所有內容|畫布|引導式工作坊|每項發佈內容均顯示審閱日期。|尋找組織成員|還有更多成員。請縮小搜尋範圍。|在此新增發佈內容會保留其組織範圍的對象，不會授予原始內容的編輯權限。|變更已儲存|請保留至少一位擁有者。在移除最後一位擁有者或變更其角色之前，請先將其他成員設為擁有者。|無法載入組織成員。請重試。`,
};
export function groupsMessages(locale: SupportedLocale): Copy {
  if (locale === "en-CA") return groupsEnglishMessages;
  const values = rows[locale].split("|");
  return Object.fromEntries(
    Object.keys(groupsEnglishMessages).map((key, index) => [key, values[index]]),
  ) as Copy;
}
