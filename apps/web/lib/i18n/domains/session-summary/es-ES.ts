import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "Compartir resumen",
  "summary.title": "Resumen de la sesión",
  "summary.close": "Cerrar",
  "summary.description":
    "Revisa el resumen agregado, descárgalo o crea un enlace temporal para compartirlo.",
  "summary.loading": "Cargando resumen…",
  "summary.failed": "No se pudo actualizar el resumen. Actualiza y vuelve a intentarlo.",
  "summary.unavailable": "Este resumen no está disponible. Pide al organizador un enlace válido.",
  "summary.downloads": "Descargar resumen",
  "summary.download.pdf": "Descargar PDF",
  "summary.download.png": "Descargar imagen",
  "summary.download.xlsx": "Descargar hoja de cálculo",
  "summary.downloadsUnavailable": "Las descargas no están disponibles para este resumen.",
  "summary.downloadFailed":
    "No se pudo completar la descarga. Reinténtalo o pide al organizador un enlace válido.",
  "summary.downloaded": "Resumen descargado.",
  "summary.imageContent": "Contenido de la imagen",
  "summary.wholeSummary": "Resumen completo",
  "summary.create": "Crear enlace para compartir",
  "summary.expiryDays": "Duración del enlace en días (1–30)",
  "summary.allowDownloads": "Permitir que los destinatarios descarguen el resumen",
  "summary.bearerNotice":
    "Cualquiera con el enlace puede leer el resumen agregado hasta que caduque o lo revoques. Las copias descargadas no pueden revocarse.",
  "summary.nextSteps": "Próximos pasos",
  "summary.nextStepsHint":
    "Notas opcionales del organizador (2000 caracteres). Se compartirán; omite nombres e información personal.",
  "summary.expires": "Caduca el {date}",
  "summary.retention":
    "Los enlaces no pueden superar el plazo de conservación de esta sesión: {date}.",
  "summary.working": "Procesando…",
  "summary.created": "Enlace creado.",
  "summary.replayed":
    "Este enlace ya se aceptó. El enlace original no vuelve a estar disponible. Revisa los enlaces existentes antes de crear otro.",
  "summary.uncertain":
    "No se pudo confirmar la solicitud. La lista se ha actualizado; reintentar sin cambiar los datos usa la misma solicitud.",
  "summary.saveLink":
    "Guarda este enlace ahora. Su secreto no se almacena y este enlace exacto no volverá a mostrarse.",
  "summary.link": "Enlace para compartir",
  "summary.copy": "Copiar enlace",
  "summary.copied": "Enlace copiado.",
  "summary.copyFailed": "La copia se bloqueó. Selecciona y copia el enlace manualmente.",
  "summary.links": "Enlaces existentes",
  "summary.noLinks": "No se ha creado ningún enlace.",
  "summary.refresh": "Actualizar enlaces",
  "summary.linkCreated": "Creado el {date}",
  "summary.linkActive": "Activo",
  "summary.linkExpired": "Caducado",
  "summary.linkRevoked": "Revocado",
  "summary.revoke": "Revocar enlace",
  "summary.revoked": "Enlace revocado.",
  "summary.reason.feature_disabled":
    "La creación de enlaces está pausada. Los enlaces existentes siguen disponibles para gestionar.",
  "summary.reason.role": "Tu rol permite ver resúmenes, pero no crear ni revocar enlaces.",
  "summary.reason.exports_entitlement":
    "Las exportaciones y el uso compartido no estaban incluidos para esta sesión.",
  "summary.participants": "Participantes",
  "summary.responses": "Respuestas",
  "summary.questions": "Puntos de control",
  "summary.results": "Resultados por pregunta",
  "summary.questionRegion": "Resultados de la pregunta {number}: {prompt}",
  "summary.response": "Respuesta",
  "summary.value": "Valor",
  "summary.sample": "{count} personas respondieron",
  "summary.notAssessed": "Diapositiva de contenido · No evaluada",
  "summary.notScored": "Opiniones · Sin puntuación",
  "summary.multiSelect":
    "Se permiten varias selecciones. Los recuentos indican quién eligió cada opción; el total puede superar el número de personas que respondieron.",
  "summary.accuracyValue": "Exactitud: {percent}% ({correct} de {responses} respuestas evaluadas)",
  "summary.initialAccuracy":
    "Exactitud inicial: {percent}% ({correct} de {responses} respuestas evaluadas)",
  "summary.recovery": "Evidencia de recuperación",
  "summary.recovery.linked": "Comprobación vinculada",
  "summary.recovery.revote": "Nueva votación",
  "summary.recoveryValue": "{recovered} de {eligible} pares elegibles mejoraron ({percent}%)",
  "summary.measure.respondents": "Recuento de personas que respondieron",
  "summary.measure.selections": "Recuento de selecciones",
  "summary.measure.weighted_points": "Puntos ponderados de clasificación",
  "summary.suppression.insufficient_sample":
    "La evidencia se oculta con menos de cinco personas que respondieron.",
  "summary.suppression.participant_text":
    "El texto escrito por participantes se excluye de los resúmenes compartidos.",
  "summary.suppression.unavailable": "Esta evidencia no está disponible.",
  "summary.note.aggregate_only":
    "Solo resultados agregados. Se excluyen nombres, resultados individuales y respuestas sin procesar.",
  "summary.note.insufficient_sample": "Se oculta la evidencia de muestras inferiores a cinco.",
  "summary.note.participant_text_excluded":
    "Se excluyen los textos de participantes y los términos de nubes de palabras.",
  "summary.note.paired_evidence":
    "La recuperación cuenta resultados emparejados de comprobaciones, no personas únicas ni un efecto causal demostrado.",
  "summary.note.no_scored_evidence":
    "No hay evidencia de aprendizaje puntuada; las opiniones no miden la exactitud.",
};

export default messages;
