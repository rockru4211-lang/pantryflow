import type {ReceiptField} from './receipt-workflow';
export type RecognitionDetail={run?:{id:string;provider:string;status:string;error_code?:string}|null;job?:{status:string;ocr_wait_reason?:string|null}|null;fields?:ReceiptField[]};
export function recognitionState(detail:RecognitionDetail){
 const job=detail.job;
 if(job?.status==='RUNNING')return {label:'辨識中',active:true,ready:false,retry:false};
 if(job?.status==='QUEUED')return {label:job.ocr_wait_reason==='DAILY_QUOTA'?'等待每日辨識額度恢復':job.ocr_wait_reason?'辨識服務忙碌，稍後自動重試':'排隊辨識中',active:true,ready:false,retry:false};
 if(detail.run?.status==='SUCCEEDED'&&detail.run.provider!=='manual')return {label:'辨識完成',active:false,ready:true,retry:false};
 return {label:detail.run?.provider==='manual'?'人工建檔，尚無辨識明細':job?.status==='FAILED'||detail.run?.status==='FAILED'?'辨識未完成，原圖已保留':'尚未辨識',active:false,ready:false,retry:true};
}
export function recognitionError(error:unknown){const m=error&&typeof error==='object'&&'message'in error?String(error.message):String(error);
 if(/RETRY_HAS_EDITS|RETRY_HAS_RESULTS|MANUAL_REVIEW_ACTIVE/.test(m))return '已有建檔資料或辨識結果，已保留原內容，未重新辨識。';
 if(/ORIGINAL_UPLOAD_INCOMPLETE/.test(m))return '原圖尚未完整上傳，請先確認原始檔案。';
 if(/REQUIRED|DENIED|NOT_LIVE|42501/.test(m))return '此身分或貨單狀態無法重新辨識。';
 return '尚未確認是否排入辨識，請重新查看狀態；原圖及輸入仍保留。';
}
