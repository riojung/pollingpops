import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "Partilhar resumo",
  "summary.title": "Resumo da sessão",
  "summary.close": "Fechar",
  "summary.description":
    "Pré-visualize o resumo agregado, transfira-o ou crie uma ligação temporária de partilha.",
  "summary.loading": "A carregar resumo…",
  "summary.failed": "Não foi possível atualizar o resumo. Atualize e tente novamente.",
  "summary.unavailable": "Este resumo não está disponível. Peça uma ligação válida ao organizador.",
  "summary.downloads": "Transferir resumo",
  "summary.download.pdf": "Transferir PDF",
  "summary.download.png": "Transferir imagem",
  "summary.download.xlsx": "Transferir folha de cálculo",
  "summary.downloadsUnavailable": "As transferências não estão disponíveis para este resumo.",
  "summary.downloadFailed":
    "A transferência não terminou. Tente novamente ou peça uma ligação válida ao organizador.",
  "summary.downloaded": "Resumo transferido.",
  "summary.imageContent": "Conteúdo da imagem",
  "summary.wholeSummary": "Resumo completo",
  "summary.create": "Criar ligação de partilha",
  "summary.expiryDays": "Duração da ligação em dias (1–30)",
  "summary.allowDownloads": "Permitir que os destinatários transfiram o resumo",
  "summary.bearerNotice":
    "Qualquer pessoa com esta ligação pode ler o resumo agregado até expirar ou ser revogada. As cópias transferidas não podem ser revogadas.",
  "summary.nextSteps": "Próximos passos",
  "summary.nextStepsHint":
    "Notas opcionais do organizador (2000 caracteres). Serão partilhadas; omita nomes e informações pessoais.",
  "summary.expires": "Expira em {date}",
  "summary.retention": "As ligações não podem ultrapassar o prazo de retenção da sessão: {date}.",
  "summary.working": "A processar…",
  "summary.created": "Ligação criada.",
  "summary.replayed":
    "Esta partilha já foi aceite. A ligação original não volta a estar disponível. Reveja as ligações existentes antes de criar outra.",
  "summary.uncertain":
    "Não foi possível confirmar o pedido. A lista foi atualizada; repetir com os mesmos dados utiliza o mesmo pedido.",
  "summary.saveLink":
    "Guarde esta ligação agora. O seu segredo não é armazenado e esta ligação exata não será apresentada novamente.",
  "summary.link": "Ligação de partilha",
  "summary.copy": "Copiar ligação",
  "summary.copied": "Ligação copiada.",
  "summary.copyFailed": "A cópia foi bloqueada. Selecione e copie a ligação manualmente.",
  "summary.links": "Ligações existentes",
  "summary.noLinks": "Ainda não foram criadas ligações de partilha.",
  "summary.refresh": "Atualizar ligações",
  "summary.linkCreated": "Criada em {date}",
  "summary.linkActive": "Ativa",
  "summary.linkExpired": "Expirada",
  "summary.linkRevoked": "Revogada",
  "summary.revoke": "Revogar ligação",
  "summary.revoked": "Ligação revogada.",
  "summary.reason.feature_disabled":
    "A criação de ligações está suspensa. As ligações existentes podem continuar a ser geridas.",
  "summary.reason.role": "A sua função permite ver resumos, mas não criar ou revogar ligações.",
  "summary.reason.exports_entitlement":
    "As exportações e a partilha não estavam incluídas nesta sessão.",
  "summary.participants": "Participantes",
  "summary.responses": "Respostas",
  "summary.questions": "Pontos de verificação",
  "summary.results": "Resultados por pergunta",
  "summary.questionRegion": "Resultados da pergunta {number}: {prompt}",
  "summary.response": "Resposta",
  "summary.value": "Valor",
  "summary.sample": "{count} respondentes",
  "summary.notAssessed": "Diapositivo de conteúdo · Não avaliado",
  "summary.notScored": "Opiniões · Sem pontuação",
  "summary.multiSelect":
    "São permitidas várias seleções. As contagens indicam os respondentes que escolheram cada opção; o total pode exceder o número de respondentes.",
  "summary.accuracyValue": "Exatidão: {percent}% ({correct} de {responses} respostas avaliadas)",
  "summary.initialAccuracy":
    "Exatidão inicial: {percent}% ({correct} de {responses} respostas avaliadas)",
  "summary.recovery": "Evidência de recuperação",
  "summary.recovery.linked": "Verificação associada",
  "summary.recovery.revote": "nova votação",
  "summary.recoveryValue": "{recovered} de {eligible} pares elegíveis melhoraram ({percent}%)",
  "summary.measure.respondents": "Contagens de respondentes",
  "summary.measure.selections": "Contagens de seleções",
  "summary.measure.weighted_points": "Pontos de classificação ponderados",
  "summary.suppression.insufficient_sample":
    "A evidência é ocultada com menos de cinco respondentes.",
  "summary.suppression.participant_text":
    "O texto dos participantes é excluído dos resumos partilhados.",
  "summary.suppression.unavailable": "Esta evidência não está disponível.",
  "summary.note.aggregate_only":
    "Apenas resultados agregados. Nomes, resultados individuais e respostas em bruto são excluídos.",
  "summary.note.insufficient_sample": "A evidência de amostras inferiores a cinco é ocultada.",
  "summary.note.participant_text_excluded":
    "Os textos dos participantes e os termos das nuvens de palavras são excluídos.",
  "summary.note.paired_evidence":
    "A recuperação conta resultados emparelhados das verificações, não pessoas únicas nem um efeito causal comprovado.",
  "summary.note.no_scored_evidence":
    "Não há evidência de aprendizagem pontuada; as opiniões não medem a correção.",
};

export default messages;
