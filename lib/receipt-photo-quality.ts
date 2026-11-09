import type {WorkEntry} from './workflow-rules.ts';

export const photoIssueLabels = {
  BLUR: '照片模糊，請靠近並對焦後重拍',
  GLARE: '反光遮住文字，請調整角度重拍',
  CROPPED: '貨單未拍完整，請將四角與明細拍入',
} as const;

export type PhotoIssue = { page: number; reason: keyof typeof photoIssueLabels };

export const photoRetakeReasonLabels = {
  BLUR: '照片模糊',
  GLARE: '反光',
  CROPPED: '未拍完整',
  INCOMPLETE: '資料不全',
} as const;

export type PhotoRetakeReason = keyof typeof photoRetakeReasonLabels;
export const photoRetakeInstructions: Record<PhotoRetakeReason, string> = {
  ...photoIssueLabels,
  INCOMPLETE: '貨單資料不全，請補齊後重拍',
};

// Missing prices, OCR uncertainty and provider errors never imply a bad photo.
// Accept only explicit, high-confidence physical defects on an existing image.
export function receiptPhotoIssues(input: unknown, pages: number[]): PhotoIssue[] {
  if (!Array.isArray(input)) return [];
  const result = new Map<number, PhotoIssue>();
  for (const value of input) {
    if (!value || typeof value !== 'object') continue;
    const { page, reason, confidence } = value;
    if (!Number.isInteger(page) || !pages.includes(page) ||
        !Object.hasOwn(photoIssueLabels, reason) ||
        typeof confidence !== 'number' || confidence < 0.9 || confidence > 1) continue;
    result.set(page, { page, reason });
  }
  return [...result.values()].sort((a, b) => a.page - b.page);
}


export type ReceiptPhotoTask={
  id:string;batch_id:string;batch_number:string;page:number;reason:PhotoRetakeReason;note?:string|null;
  name:string;path:string;mime:string;created_at:string;
};

export function receiptRetakeEntries(tasks:ReceiptPhotoTask[]):WorkEntry[]{
  const groups=new Map<string,ReceiptPhotoTask[]>();
  for(const task of tasks){
    const group=groups.get(task.batch_id);
    if(group)group.push(task);
    else groups.set(task.batch_id,[task]);
  }
  return [...groups.values()].map(group=>{
    const latest=group.reduce((a,b)=>Date.parse(a.created_at)>=Date.parse(b.created_at)?a:b);
    const reasons=[...new Set(group.map(task=>photoRetakeReasonLabels[task.reason]).filter(Boolean))];
    return {key:`receipt-retake:${latest.batch_id}`,category:'receipt-retake',id:latest.batch_id,
      title:'貨單待重拍',copy:[latest.batch_number,`${group.length} 張照片`,...reasons].join('・'),
      at:latest.created_at,pending:true,target:'receiving',page:'retake'};
  }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
