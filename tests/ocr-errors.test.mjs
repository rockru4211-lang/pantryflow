import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptOcrErrorCode, receiptOcrFailureMessage } from '../supabase/functions/_shared/ocr-errors.ts';

test('provider failures become actionable public codes without exposing provider details', () => {
  for (const [error, code, hint] of [
    [new Error('GEMINI_429: secret quota project'), 'OCR_RATE_LIMIT', /用量或請求上限/],
    [new Error('GEMINI_503: secret provider body'), 'OCR_SERVICE_BUSY', /暫時忙碌/],
    [new Error('GEMINI_API_KEY_MISSING'), 'OCR_CONFIGURATION_ERROR', /修復後/],
    [new Error('GEMINI_403: secret key'), 'OCR_CONFIGURATION_ERROR', /修復後/],
    [new SyntaxError('secret malformed response'), 'OCR_UNREADABLE_RESULT', /清楚、完整/],
    [new Error('OCR_NO_LINES'), 'OCR_UNREADABLE_RESULT', /品項資料/],
    [new Error('secret database failure'), 'OCR_PROCESSING_FAILED', /貨單編號/],
  ]) {
    assert.equal(receiptOcrErrorCode(error), code);
    const message = receiptOcrFailureMessage(code);
    assert.match(message, hint);
    assert.match(message, /請勿重複上傳/);
    assert.doesNotMatch(message, /secret|GEMINI_|成功|\d+ 秒/);
  }
});

test('old and unknown error codes remain recoverable without echoing server values', () => {
  for (const code of [null, undefined, 'OCR_PROCESSING_FAILED', 'secret']) {
    assert.match(receiptOcrFailureMessage(code), /貨單編號/);
    assert.doesNotMatch(receiptOcrFailureMessage(code), /secret/);
  }
});
