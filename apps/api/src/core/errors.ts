import fp from 'fastify-plugin';
import { DomainError } from '@nexo/domain';
import { ZodError } from 'zod';

/** Erros 4xx do próprio Fastify (parser de corpo, limite, content-type) -> resposta padrão sem detalhes internos. */
const CLIENT_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'Requisição inválida.' },
  404: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' },
  408: { code: 'REQUEST_TIMEOUT', message: 'Tempo da requisição esgotado.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'O conteúdo enviado excede o tamanho máximo permitido.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de conteúdo não suportado.' },
  429: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde e tente novamente.' }
};
const JSON_INVALID = { code: 'INVALID_JSON', message: 'O corpo da requisição não é um JSON válido.' };

function fastifyClientStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500 ? status : undefined;
}

export default fp(async app => {
  app.setErrorHandler((error, request, reply) => {
    const clientStatus = error instanceof DomainError || error instanceof ZodError ? undefined : fastifyClientStatus(error);
    const status = error instanceof DomainError ? error.status : error instanceof ZodError ? 422 : clientStatus ?? 500;
    (status >= 500 ? request.log.error : request.log.warn).call(request.log, { err: error, requestId: request.id, status, code: (error as { code?: string }).code }, 'request failed');
    if (error instanceof DomainError) return reply.status(error.status).send({ code: error.code, message: error.message, details: error.details, requestId: request.id });
    if (error instanceof ZodError) return reply.status(422).send({ code: 'VALIDATION_ERROR', message: 'Os dados enviados são inválidos.', details: error.flatten(), requestId: request.id });
    if (clientStatus) {
      const fastifyCode = String((error as { code?: unknown }).code ?? '');
      const body = clientStatus === 400 && (/JSON|EMPTY_JSON/i.test(fastifyCode) || error instanceof SyntaxError) ? JSON_INVALID : CLIENT_ERRORS[clientStatus] ?? CLIENT_ERRORS[400]!;
      return reply.status(clientStatus).send({ code: body.code, message: body.message, requestId: request.id });
    }
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a solicitação.', requestId: request.id });
  });
});
